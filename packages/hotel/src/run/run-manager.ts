import type { RoomId } from "@perfectman/shared";
import type { Clock, TimerHandle } from "../clock/clock.js";
import { sleepOn } from "../clock/clock.js";
import type { HotelConfig } from "../config.js";
import { DirectorClient } from "../director/director-client.js";
import type { FrameRecorder } from "../director/director-client.js";
import type { HotelHttpClient } from "../director/http-client.js";
import type { HotelFrame, SidecarMsg } from "../director/index.js";
import type { SocketFactory } from "../director/transport.js";
import { LlmGovernor } from "../llm/governor.js";
import { HotelSpaceMirror } from "../space/space-mirror.js";
import type { Logger } from "../util/log.js";
import type { WrittenArtifacts } from "./artifacts.js";
import { Run } from "./run.js";
import type { RunLink, RunStartParams, RunTiming } from "./run.js";

export const STATUS_INTERVAL_MS = 5000;
const STALE_CHECK_MS = 1000;
const SHUTDOWN_BOUND_MS = 10_000;
/** A refused or unanswered resnapshot is retried after 1, 2, 4 ... up to 30 s. */
export const RESNAPSHOT_BACKOFF_MS = { base: 1000, max: 30_000 } as const;

export type ManagerOptions = {
  config: HotelConfig;
  clock: Clock;
  rng: () => number;
  logger: Logger;
  socketFactory: SocketFactory;
  http?: HotelHttpClient;
  timing?: RunTiming;
  statusIntervalMs?: number;
  sidecar?: { version: string; build: string; schema_sha256?: string };
  recorder?: FrameRecorder;
  governor?: LlmGovernor;
};

type Pending = { resolve(f: HotelFrame): void; reject(e: Error): void; timer: TimerHandle };

/**
 * Owns up to `PERFECTMAN_MAX_RUNS` runs, one per room, on one Director
 * connection (hotel-package.md 6): applies leases and the hello reconcile,
 * routes frames to runs, drives the mirror's gap and staleness recovery, and
 * reports `run_status` every 5 s. The hotel is the authority on run state; the
 * manager never decides idle pause or the 30 min end.
 */
export class RunManager implements RunLink {
  readonly mirror: HotelSpaceMirror;
  readonly director: DirectorClient;
  private readonly runs = new Map<number, Run>();
  private readonly roomWaiters = new Map<RoomId, Array<() => void>>();
  private readonly cidWaiters = new Map<number, Pending>();
  private readonly cidOwner = new Map<number, number>();
  private readonly driftNoticed = new Set<number>();
  /** Per room: resnapshot attempts since the last good snapshot and when the next one may go out. */
  private readonly resnap = new Map<RoomId, { attempts: number; nextAt: number }>();
  private readonly log: Logger;
  private readonly governor: LlmGovernor;
  private timers: TimerHandle[] = [];
  private loopLagMs = 0;
  private accepting = true;
  private stopped = false;

  constructor(private readonly o: ManagerOptions) {
    this.log = o.logger;
    this.governor = o.governor ?? new LlmGovernor(o.clock, o.rng);
    this.mirror = new HotelSpaceMirror({
      listener: {
        onMoved: (ref) => this.runs.forEach((r) => r.mirrorMoved(ref)),
        onLeft: (ref) => this.runs.forEach((r) => r.mirrorLeft(ref)),
        onHumanTyping: (room, _ref, on, at) => this.runs.forEach((r) => r.humanTyping(room, on, at)),
      },
    });
    this.director = new DirectorClient({
      url: o.config.directorUrl,
      secret: o.config.secret,
      clock: o.clock,
      socketFactory: o.socketFactory,
      rng: o.rng,
      logger: o.logger,
      sidecar: o.sidecar ?? { version: "0.0.0", build: "dev" },
      ...(o.recorder ? { recorder: o.recorder } : {}),
      handlers: {
        onHello: (hello) => this.onHello(hello),
        onFrame: (frame) => this.onFrame(frame),
        onConnectionChange: (up) => this.onConnection(up),
      },
    });
  }

  get runCount(): number {
    return this.runs.size;
  }

  get connected(): boolean {
    return this.director.connected;
  }

  getRun(id: number): Run | undefined {
    return this.runs.get(id);
  }

  start(): void {
    this.director.start();
    const every = (ms: number, fn: () => void): void => {
      const tick = (): void => {
        if (this.stopped) return;
        fn();
        this.timers.push(this.o.clock.setTimer(tick, ms));
      };
      this.timers.push(this.o.clock.setTimer(tick, ms));
    };
    // `lag_ms`: how late the status timer itself fires, i.e. the sidecar's event-loop lag.
    const statusEvery = this.o.statusIntervalMs ?? STATUS_INTERVAL_MS;
    let due = this.o.clock.now() + statusEvery;
    every(statusEvery, () => {
      const now = this.o.clock.now();
      this.loopLagMs = Math.max(0, now - due);
      due = now + statusEvery;
      this.reportStatus();
    });
    every(STALE_CHECK_MS, () => this.checkStale());
  }

  /** SIGTERM: stop taking runs, walk every actor out (bounded), close the socket. */
  async shutdown(): Promise<void> {
    this.accepting = false;
    const all = Promise.all([...this.runs.values()].map((r) => r.stop("stopped", "sidecar shutting down").catch(() => undefined)));
    await Promise.race([all, sleepOn(this.o.clock, SHUTDOWN_BOUND_MS)]);
    this.stopped = true;
    this.timers.forEach((t) => t.cancel());
    this.director.stop(1000);
  }

  // ---- RunLink ----------------------------------------------------------------

  send(msg: SidecarMsg): boolean {
    return this.director.send(msg);
  }

  nextCid(run: number): number {
    const cid = this.director.nextCid();
    this.cidOwner.set(cid, run);
    if (this.cidOwner.size > 2048) this.cidOwner.delete(this.cidOwner.keys().next().value as number);
    return cid;
  }

  leaseOf(run: number): number | undefined {
    return this.director.leaseOf(run);
  }

  trackRun(run: number): void {
    this.director.trackRun(run);
  }

  untrackRun(run: number): void {
    this.director.untrackRun(run);
  }

  subscribe(room: RoomId, resnapshot = false): void {
    this.director.send({ t: "subscribe_room", room: Number(room), resnapshot });
  }

  waitForRoom(room: RoomId, timeoutMs: number): Promise<boolean> {
    const r = this.mirror.model().rooms.get(room);
    if (r && !r.degraded) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean): void => {
        if (done) return;
        done = true;
        timer.cancel();
        resolve(ok);
      };
      const timer = this.o.clock.setTimer(() => finish(false), timeoutMs);
      this.roomWaiters.set(room, [...(this.roomWaiters.get(room) ?? []), () => finish(true)]);
    });
  }

  expectCid(cid: number, timeoutMs: number): Promise<HotelFrame> {
    return new Promise((resolve, reject) => {
      const timer = this.o.clock.setTimer(() => {
        this.cidWaiters.delete(cid);
        reject(new Error(`no answer to command ${cid} in ${timeoutMs} ms`));
      }, timeoutMs);
      this.cidWaiters.set(cid, { resolve, reject, timer });
    });
  }

  async fetchScenarioVersion(id: number): Promise<unknown> {
    if (!this.o.http) throw new Error("no internal HTTP client configured");
    return this.o.http.getScenarioVersion(id);
  }

  async registerArtifacts(run: number, written: WrittenArtifacts): Promise<void> {
    await this.o.http?.registerArtifacts(run, { events: written.files["events"], director: written.files["director"], replay: written.files["replay"] });
  }

  // ---- connection -------------------------------------------------------------

  private onHello(hello: Extract<HotelFrame, { t: "hello" }>): number[] {
    this.mirror.noteKnownRooms([
      ...hello.runs.map((r) => ({ id: String(r.room), name: r.room_name })),
      ...hello.actors.map((a) => ({ id: String(a.room) })),
      ...((hello as { rooms?: Array<{ id: number; name?: string }> }).rooms ?? []).map((r) => ({ id: String(r.id), ...(r.name ? { name: r.name } : {}) })),
    ]);
    const live = new Set(hello.runs.map((r) => r.run));
    const resume: number[] = [];
    for (const [id, run] of this.runs) {
      if ((run.state === "running" || run.state === "paused") && live.has(id)) resume.push(id);
      else void run.abandon();
    }
    this.log.info("hello", { runs: hello.runs.length, actors: hello.actors.length, resume });
    // Anything else the hotel lists, it removes itself (orphan rule, director-protocol.md 4).
    return resume;
  }

  private onConnection(up: boolean): void {
    if (!up) {
      this.mirror.markAllDegraded();
      this.runs.forEach((r) => r.setLinkDown(true));
      for (const [cid, p] of this.cidWaiters) {
        p.timer.cancel();
        p.reject(new Error("the Director link dropped"));
        this.cidWaiters.delete(cid);
      }
      return;
    }
    for (const run of this.runs.values()) {
      if (run.state !== "running" && run.state !== "paused") continue;
      for (const room of run.roomsInUse()) {
        this.subscribe(room, false);
        // The subscribe above is the first attempt; the retry loop only steps in if it goes unanswered.
        this.resnap.set(room, { attempts: 1, nextAt: this.o.clock.now() + RESNAPSHOT_BACKOFF_MS.base });
      }
      run.setLinkDown(false);
    }
  }

  // ---- frames -----------------------------------------------------------------

  private onFrame(frame: HotelFrame): void {
    const now = this.o.clock.now();
    switch (frame.t) {
      case "run_start":
        void this.startRun(frame);
        return;
      case "run_end": {
        const run = this.runs.get(frame.run);
        // The hotel ended it (idle timeout, killall, lease expiry): stop the runtime, write artifacts, drop the run.
        if (run) void run.stop(frame.reason === "hotel_shutdown" || frame.reason === "lease_expired" ? "failed" : "stopped", frame.reason, { byHotel: true });
        return;
      }
      case "pm_command":
        void this.command(frame);
        return;
      case "room_snapshot": {
        this.mirror.applySnapshot(frame, now);
        const id = String(frame.room);
        this.resnap.delete(id);
        for (const wake of this.roomWaiters.get(id) ?? []) wake();
        this.roomWaiters.delete(id);
        return;
      }
      case "delta": {
        const res = this.mirror.applyDelta(frame, now);
        if (!res.ok) {
          if (res.reason === "gap") this.log.warn("rev gap", { room: res.room });
          if (res.reason === "unknown_room") this.log.warn("delta for an unsubscribed room dropped", { room: res.room });
          if (res.reason === "gap") this.resnapshot(res.room);
        } else if (res.resnapshot) this.resnapshot(String(frame.room));
        return;
      }
      case "room_ping": {
        const res = this.mirror.applyPing(frame, now);
        if (!res.ok && res.reason === "gap") this.resnapshot(res.room);
        return;
      }
      case "room_closed":
        this.mirror.applyRoomClosed(frame.room);
        this.resnap.delete(String(frame.room));
        return;
      case "human_chat": {
        const room = String(frame.room);
        for (const run of this.runs.values()) if (run.holdsActorIn(room)) void run.handleHumanChat(frame);
        return;
      }
      case "actor_spawned": {
        const w = this.cidWaiters.get(frame.cid);
        if (w) this.settle(frame.cid, w, frame);
        else this.log.warn("actor_spawned without a waiter", { cid: frame.cid });
        return;
      }
      case "actor_error": {
        const cid = frame.cid ?? undefined;
        const w = cid !== undefined ? this.cidWaiters.get(cid) : undefined;
        if (cid !== undefined && w) return this.settle(cid, w, frame);
        const owner = cid !== undefined ? this.cidOwner.get(cid) : undefined;
        const run = (owner !== undefined ? this.runs.get(owner) : undefined) ?? this.runOfActor(frame.actor ?? undefined);
        if (run) run.handleFrame(frame);
        else this.log.warn("actor_error for no run", { code: frame.code });
        return;
      }
      case "actor_gone":
      case "pair_reaction": {
        this.runs.get(frame.run)?.handleFrame(frame);
        return;
      }
      case "arrived":
      case "walk_started":
      case "moved_room": {
        const run = this.runOfActor(frame.actor);
        if (run) run.handleFrame(frame);
        else this.log.warn("frame for an actor no run owns, dropped", { t: frame.t });
        // An actor that went through a door needs its new room mirrored, or it is in transit for good.
        if (frame.t === "moved_room" && run && !this.mirror.model().rooms.has(String(frame.to))) this.subscribe(String(frame.to));
        return;
      }
      default:
        return; // lease is handled by the client; unknown frames are ignored (protocol 2)
    }
  }

  private settle(cid: number, w: Pending, frame: HotelFrame): void {
    w.timer.cancel();
    this.cidWaiters.delete(cid);
    w.resolve(frame);
  }

  private runOfActor(actor: number | undefined): Run | undefined {
    const id = actor === undefined ? undefined : this.mirror.runOfAvatar(actor);
    return id === undefined ? undefined : this.runs.get(id);
  }

  // ---- runs -------------------------------------------------------------------

  private async startRun(f: Extract<HotelFrame, { t: "run_start" }>): Promise<void> {
    const params: RunStartParams = {
      run: f.run,
      lease: f.lease,
      mode: f.mode,
      room: f.room,
      scenarioVersion: f.scenario_version,
      admin: f.admin,
      capActors: f.cap_actors,
    };
    const ack = (ok: boolean, code?: string, message?: string): void => {
      this.send({ t: "run_ack", run: f.run, ok, ...(ok ? {} : { error: { code: code ?? "failed", message: message ?? "" } }) });
    };
    if (!this.accepting) return ack(false, "shutting_down", "the sidecar is stopping");
    if (this.runs.size >= this.o.config.maxRuns) return ack(false, "run_limit", `at most ${this.o.config.maxRuns} runs`);
    if ([...this.runs.values()].some((r) => r.params.room === f.room)) return ack(false, "run_limit", "one run per room");
    if (this.runs.has(f.run)) return ack(false, "run_limit", "run already started");

    const run = new Run(params, {
      hotel: this.o.config,
      clock: this.o.clock,
      rng: this.o.rng,
      logger: this.log,
      mirror: this.mirror,
      link: this,
      governor: this.governor,
      ...(this.o.timing ? { timing: this.o.timing } : {}),
      onEnded: (r) => {
        this.runs.delete(r.id);
        this.driftNoticed.delete(r.id);
      },
    });
    this.runs.set(f.run, run);
    this.trackRun(f.run);
    const prep = await run.prepare();
    // The hotel may have ended the run while it was validating (run_end): nothing was built, so there is nothing to launch.
    if (this.runs.get(f.run) !== run || run.state !== "starting") {
      this.log.info("run ended during prepare, not launched", { run: f.run });
      if (this.runs.get(f.run) === run) {
        this.runs.delete(f.run);
        this.untrackRun(f.run);
      }
      return;
    }
    if (!prep.ok) {
      this.runs.delete(f.run);
      this.untrackRun(f.run);
      this.log.warn("run refused", { run: f.run, code: prep.code, message: prep.message });
      return ack(false, prep.code, prep.message);
    }
    ack(true);
    try {
      await run.launch();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error("run failed to start", { run: f.run, error: message });
      run.notice("run_failed", "error", message.slice(0, 180));
      await run.stop("failed", message.slice(0, 180));
    }
  }

  private async command(f: Extract<HotelFrame, { t: "pm_command" }>): Promise<void> {
    const run = this.runs.get(f.run);
    if (!run) return;
    const args = f.args ?? "";
    switch (f.cmd) {
      case "stop":
        await run.stop("stopped");
        return;
      case "pause":
        run.pause(f.source === "auto" ? "idle" : "admin");
        return;
      case "resume":
        run.resume(f.source === "auto" ? "auto" : "admin");
        return;
      case "inject":
        if (args.trim() && (await run.steer(args.trim()))) run.notice("inject_ok", "info");
        else run.notice("inject_failed", "warn");
        return;
      case "whisper": {
        const target = run.resolveWhisperTarget(args);
        if (target && (await run.steer(target.text, target.agentId))) run.notice("whisper_ok", "info");
        else run.notice("whisper_bad_target", "warn", "Use: whisper \"Name\" text");
        return;
      }
      case "status":
        run.notice("status", "info", run.statusText().slice(0, 190));
        return;
      case "replay":
        run.notice("replay_unavailable", "info");
        return;
      case "wipe_memory":
        run.notice("wipe_memory_ok", "info"); // nothing cached in Phase 2; player memory is Phase 3
        return;
    }
  }

  private reportStatus(): void {
    if (!this.director.connected) return;
    for (const run of this.runs.values()) {
      if (run.state === "ended" || run.state === "failed") continue;
      this.send(run.status(this.loopLagMs));
      if (run.p95Drift && !this.driftNoticed.has(run.id)) {
        this.driftNoticed.add(run.id);
        run.notice("llm_p95_drift", "warn");
      }
    }
  }

  private checkStale(): void {
    if (!this.director.connected) return;
    const now = this.o.clock.now();
    for (const room of this.mirror.staleRooms(now)) this.resnapshot(room);
    // A resnapshot the hotel refused or never answered leaves the room degraded: ask again, with backoff.
    const wanted = new Set<RoomId>();
    for (const run of this.runs.values()) for (const room of run.roomsInUse()) wanted.add(room);
    for (const room of this.mirror.degradedRooms()) if (wanted.has(room)) this.resnapshot(room);
  }

  /** Asks the hotel for a fresh snapshot of `room`, at most once per backoff window. */
  private resnapshot(room: RoomId): void {
    const now = this.o.clock.now();
    const prior = this.resnap.get(room);
    if (prior && now < prior.nextAt) return;
    const attempts = prior?.attempts ?? 0;
    const delay = Math.min(RESNAPSHOT_BACKOFF_MS.base * 2 ** attempts, RESNAPSHOT_BACKOFF_MS.max);
    this.resnap.set(room, { attempts: attempts + 1, nextAt: now + delay });
    this.subscribe(room, true);
  }
}
