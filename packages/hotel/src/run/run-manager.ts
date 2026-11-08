import type { RoomId } from "@perfectman/shared";
import type { Clock, TimerHandle } from "../clock/clock.js";
import { sleepOn } from "../clock/clock.js";
import type { HotelConfig } from "../config.js";
import type { NarratorLlm } from "../director/cine/index.js";
import { DirectorClient } from "../director/director-client.js";
import type { FrameRecorder } from "../director/director-client.js";
import type { HotelHttpClient } from "../director/http-client.js";
import type { HotelFrame, SidecarMsg } from "../director/index.js";
import type { SocketFactory } from "../director/transport.js";
import { LlmGovernor } from "../llm/governor.js";
import { parseScopedRef } from "../space/scoped-ref.js";
import { HotelSpaceMirror } from "../space/space-mirror.js";
import type { Logger } from "../util/log.js";
import type { WrittenArtifacts } from "./artifacts.js";
import type { MemoryStore } from "./player-memory.js";
import { ReplayRun, parseReplayArgs } from "./replay-run.js";
import type { ReplaySpec } from "./replay-run.js";
import { ReplayError } from "./replay-plan.js";
import type { RunLike } from "./run-like.js";
import { Run } from "./run.js";
import type { RunLink, RunStartParams, RunTiming } from "./run.js";

export const STATUS_INTERVAL_MS = 5000;
const STALE_CHECK_MS = 1000;
const SHUTDOWN_BOUND_MS = 10_000;
const SUBSCRIBE_AGAIN_MS = 5000;
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
  /** Overrides the narrator's model call (D19); without it each cinematic run builds its own from the provider chain. */
  narratorLlm?: NarratorLlm;
};

/** The mirror's key for an actor as a run reads it: the run's own actors by their plain ref, everyone else's as they are. */
function asSeenBy(run: number, key: string): string {
  const scoped = parseScopedRef(key);
  return scoped && scoped.run === run ? scoped.ref : key;
}

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
  private readonly runs = new Map<number, RunLike>();
  /** `pm_command replay` that came for a run the hotel had just started: it is a replay, not a live run (director-protocol.md 6.1). */
  private readonly replayClaims = new Map<number, ReplaySpec>();
  /** Runs past the point where a late `replay` command can still turn them into a replay. */
  private readonly launched = new Set<number>();
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
        onMoved: (ref) => this.runs.forEach((r) => r.mirrorMoved(asSeenBy(r.id, ref))),
        onLeft: (ref) => this.runs.forEach((r) => r.mirrorLeft(asSeenBy(r.id, ref))),
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

  /** A live run; a replay is `getReplay`. */
  getRun(id: number): Run | undefined {
    const r = this.runs.get(id);
    return r instanceof Run ? r : undefined;
  }

  getReplay(id: number): ReplayRun | undefined {
    const r = this.runs.get(id);
    return r instanceof ReplayRun ? r : undefined;
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

  /**
   * SIGTERM: stop taking runs, walk every actor out (bounded), close the socket. The runs are not reported ended: a
   * restart is not a deliberate stop, so the hotel marks them `interrupted` (D41) when the socket closes or the next
   * sidecar's `hello_ack` does not resume them, and an admin can tell the two apart.
   */
  async shutdown(): Promise<void> {
    this.accepting = false;
    const all = Promise.all([...this.runs.values()].map((r) => {
      r.notice("shutting_down", "warn", "the sidecar is restarting");
      return r.stop("stopped", "sidecar shutting down", { interrupted: true }).catch(() => undefined);
    }));
    await Promise.race([all, sleepOn(this.o.clock, SHUTDOWN_BOUND_MS)]);
    this.stopped = true;
    this.timers.forEach((t) => t.cancel());
    this.director.stop(1000);
  }

  // ---- RunLink ----------------------------------------------------------------

  send(msg: SidecarMsg): boolean {
    // The hotel refuses a `move_room` into a room this connection has not subscribed (`not_subscribed`), and a room only gets
    // subscribed after an actor arrives in it: so the first door to a new room would always fail. Subscribe on the same
    // ordered socket, just ahead of the move.
    if (msg.t === "actor_cmd" && msg.cmd.k === "move_room") {
      const room = String(msg.cmd.room);
      const asked = this.subAsked.get(room);
      if (!this.mirror.model().rooms.has(room) && (asked === undefined || this.o.clock.now() - asked > SUBSCRIBE_AGAIN_MS)) {
        this.subAsked.set(room, this.o.clock.now());
        this.subscribe(room);
      }
    }
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

  /** When a room was last subscribed for a door (`send`), so a burst of hops does not subscribe it again and again. */
  private readonly subAsked = new Map<string, number>();

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

  get memoryStore(): MemoryStore | undefined {
    return this.o.http;
  }

  async registerArtifacts(run: number, written: WrittenArtifacts): Promise<void> {
    await this.o.http?.registerArtifacts(run, { events: written.files["events"], director: written.files["director"], replay: written.files["replay"] });
  }

  // ---- connection -------------------------------------------------------------

  private onHello(hello: Extract<HotelFrame, { t: "hello" }>): number[] {
    this.mirror.noteKnownRooms([
      ...hello.runs.map((r) => ({ id: String(r.room), name: r.room_name })),
      ...hello.actors.map((a) => ({ id: String(a.room) })),
      // D24: every room the hotel lists (official ones, the Perfectman wing included, and the rooms live runs are in) is a door away.
      // A guest room's name is its owner's text; the mirror sanitizes every name it keeps.
      ...(hello.rooms ?? []).map((r) => ({ id: String(r.id), ...(r.name ? { name: r.name } : {}) })),
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

  private runOfActor(actor: number | undefined): RunLike | undefined {
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
      ...(f.model ? { model: f.model } : {}),
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
      ...(this.o.narratorLlm ? { narratorLlm: this.o.narratorLlm } : {}),
      ...(this.o.timing ? { timing: this.o.timing } : {}),
      onEnded: (r) => {
        this.runs.delete(r.id);
        this.driftNoticed.delete(r.id);
        this.launched.delete(r.id);
      },
    });
    this.runs.set(f.run, run);
    this.trackRun(f.run);
    // A replay is asked for as a `pm_command` right behind the run's start: give a command that is already on
    // the wire the chance to claim the run before anything is validated or built for a live one.
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (this.claimReplay(f.run, run, params, true)) return;
    const prep = await run.prepare();
    if (this.claimReplay(f.run, run, params, true)) return;
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
    this.launched.add(f.run);
    try {
      await run.launch();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error("run failed to start", { run: f.run, error: message });
      run.notice("run_failed", "error", message.slice(0, 180));
      await run.stop("failed", message.slice(0, 180));
    }
  }

  // ---- replays (D39) ----------------------------------------------------------

  /** A pending replay claim turns the just-started live run into a replay of the recorded one. */
  private claimReplay(run: number, live: RunLike, params: RunStartParams, ackIt: boolean): boolean {
    const spec = this.replayClaims.get(run);
    if (!spec) return false;
    this.replayClaims.delete(run);
    if (this.runs.get(run) === live) this.runs.delete(run);
    void this.startReplay({ ...params, mode: spec.mode }, spec, ackIt);
    return true;
  }

  /**
   * `pm_command{run: R', cmd: "replay", args: "<recorded> <default|cinematic>"}`. The hotel has made R' for the
   * replay with a normal lease; if it also sent `run_start` for it, that start is claimed here instead of being
   * built as a live run. The recorded run's artifacts are read from the data volume.
   */
  private async onReplayCommand(f: Extract<HotelFrame, { t: "pm_command" }>): Promise<void> {
    const existing = this.runs.get(f.run);
    const tell = (code: string, kind: "info" | "warn" | "error", text?: string): void => {
      if (existing) existing.notice(code, kind, text);
      else if (f.admin) this.send({ t: "ui_push", run: f.run, to: { admin: f.admin.id }, ui: { k: "notice", code, kind, ...(text ? { text: text.slice(0, 190) } : {}) } });
    };
    let spec: ReplaySpec;
    try {
      spec = parseReplayArgs(f.args ?? "", "default");
    } catch (err) {
      return tell(err instanceof ReplayError ? err.code : "replay_bad_args", "warn", (err as Error).message);
    }
    if (existing) {
      // R' was started by the hotel a moment ago and nothing has been built for it yet: it is the replay.
      if (!this.launched.has(f.run) && existing.state === "starting" && existing instanceof Run) {
        this.replayClaims.set(f.run, spec);
        return;
      }
      return tell("replay_busy", "warn", "this run is already going; replay needs a run of its own");
    }
    const params: RunStartParams = { run: f.run, lease: this.director.leaseOf(f.run) ?? 0, mode: spec.mode, room: f.room, scenarioVersion: 0, admin: f.admin ?? { id: 0, name: "auto" }, capActors: 12 };
    await this.startReplay(params, spec, false);
  }

  private async startReplay(params: RunStartParams, spec: ReplaySpec, ackIt: boolean): Promise<void> {
    const refuse = (code: string, message: string): void => {
      this.runs.delete(params.run);
      this.untrackRun(params.run);
      this.log.warn("replay refused", { run: params.run, code, message });
      if (ackIt) this.send({ t: "run_ack", run: params.run, ok: false, error: { code, message } });
      else {
        this.send({ t: "ui_push", run: params.run, to: { admin: params.admin.id }, ui: { k: "notice", code, kind: "warn", text: message.slice(0, 190) } });
        this.send({ t: "run_end", run: params.run, reason: "failed", summary: message.slice(0, 180) });
      }
    };
    if (!this.accepting) return refuse("shutting_down", "the sidecar is stopping");
    if (this.runs.size >= this.o.config.maxRuns) return refuse("run_limit", `at most ${this.o.config.maxRuns} runs`);
    if ([...this.runs.values()].some((r) => r.params.room === params.room)) return refuse("run_limit", "one run per room");
    const replay = new ReplayRun(params, {
      hotel: this.o.config,
      clock: this.o.clock,
      rng: this.o.rng,
      logger: this.log,
      mirror: this.mirror,
      link: this,
      ...(this.o.timing ? { timing: this.o.timing } : {}),
      onEnded: (r) => {
        this.runs.delete(r.id);
        this.launched.delete(r.id);
      },
    });
    this.runs.set(params.run, replay);
    this.trackRun(params.run);
    try {
      await replay.prepare(spec);
    } catch (err) {
      return refuse(err instanceof ReplayError ? err.code : "replay_failed", (err as Error).message);
    }
    // A replay run has no lease until the hotel's `lease` (or `run_start`) arrives: a few seconds are allowed.
    for (let i = 0; i < 60 && this.director.leaseOf(params.run) === undefined; i++) await sleepOn(this.o.clock, 50);
    if (this.director.leaseOf(params.run) === undefined) return refuse("lease_missing", "the hotel never gave this replay a lease");
    this.launched.add(params.run);
    // The hotel waits for an ack on every run it starts, including one made for a pm_command replay (it ends it as
    // start_failed after 20 s), so the replay is acked once its lease is in, however it was started.
    this.send({ t: "run_ack", run: params.run, ok: true });
    replay.notice("replay_started", "info", `${spec.source} ${spec.mode}`);
    void replay.launch().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error("replay failed", { run: params.run, error: message });
      replay.notice("run_failed", "error", message.slice(0, 180));
      void replay.stop("failed", message.slice(0, 180));
    });
  }

  private async command(f: Extract<HotelFrame, { t: "pm_command" }>): Promise<void> {
    if (f.cmd === "replay") return this.onReplayCommand(f);
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
      case "wipe_memory":
        // The hotel already deleted the rows; this drops the run's cache and stops it writing them back (D21).
        run.notice((await run.wipeMemory(args)) ? "wipe_memory_ok" : "wipe_memory_none", "info");
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
