/**
 * A replay run (D39): a finished run's artifacts shown again, into a target room, with no model.
 *
 * The hotel makes a new run row R' for it (a normal lease, `run_status`, `run_end`, the idle pause and the
 * cinematic audience all work as for a live run) and sends `pm_command{run: R', room, cmd: "replay",
 * args: "<recorded run> <default|cinematic>"}`. This class loads the recorded run's artifacts, spawns fresh
 * actors under R' just before each one first did something, and plays the recorded moves, lines, thoughts and
 * (cinematic) cues on their original timing. Nothing here builds a simulation or calls a provider.
 */
import type { RoomId } from "@perfectman/shared";
import type { Clock, TimerHandle } from "../clock/clock.js";
import { sleepOn } from "../clock/clock.js";
import type { HotelConfig } from "../config.js";
import type { ActorCmd, HotelFrame, PauseCause, PerfectmanUi, RunMode, RunState, SidecarEndReason, SidecarMsg } from "../director/index.js";
import { pickTile } from "../embodiment/tiles.js";
import type { HotelSpaceMirror } from "../space/space-mirror.js";
import { scopeRef } from "../space/scoped-ref.js";
import type { Logger } from "../util/log.js";
import { silentLogger } from "../util/log.js";
import { ActorPacer } from "./replay-pacing.js";
import { parseScenarioBody } from "./scenario-body.js";
import { ReplayError, buildReplayPlan, loadReplayArtifacts } from "./replay-plan.js";
import type { ReplayPlan, ReplayStep } from "./replay-plan.js";
import type { RunLink, RunStartParams, StopOptions } from "./run.js";

export type ReplaySpec = {
  /** The recorded run to show. */
  source: number;
  /** How to show it: `cinematic` also plays the director track's cues for the audience. */
  mode: RunMode;
  /** 1 is the recorded pace. */
  speed: number;
};

/** `"<run> [default|cinematic] [<n>x]"`. The mode falls back to the replay run's own. */
export function parseReplayArgs(args: string, fallback: RunMode): ReplaySpec {
  const [id, ...rest] = args.trim().split(/\s+/);
  const source = Number(id);
  if (!Number.isInteger(source) || source <= 0) throw new ReplayError("replay_bad_args", "usage: replay <run id> [default|cinematic] [2x]");
  let mode = fallback;
  let speed = 1;
  for (const t of rest) {
    if (t === "default" || t === "cinematic") mode = t;
    else if (/^\d+(?:\.\d+)?x$/.test(t)) speed = Math.min(8, Math.max(0.25, Number.parseFloat(t)));
    else throw new ReplayError("replay_bad_args", `unknown replay option "${t}"`);
  }
  return { source, mode, speed };
}

export type ReplayTiming = {
  spawnIntervalMs?: number;
  spawnTimeoutMs?: number;
  walkOutTimeoutMs?: number;
  /** How long the picture stays after the last recorded thing; 1.5 s. */
  replayTailMs?: number;
  /** Overrides the `<n>x` of the command (tests). */
  replaySpeed?: number;
};

export type ReplayDeps = {
  hotel: HotelConfig;
  clock: Clock;
  rng: () => number;
  logger?: Logger;
  mirror: HotelSpaceMirror;
  link: RunLink;
  timing?: ReplayTiming;
  onEnded(run: ReplayRun, reason: SidecarEndReason): void;
};

/** Spawn this long before an actor's first recorded act, so it is at the door when it starts. */
const SPAWN_LEAD_MS = 300;
const SLICE_MS = 100;

export class ReplayRun {
  state: RunState = "starting";
  pauseCause: PauseCause | undefined;
  readonly id: number;
  readonly home: RoomId;
  spec!: ReplaySpec;
  plan: ReplayPlan | undefined;
  private readonly log: Logger;
  private names = new Map<string, { name: string; figure: string; effect?: string }>();
  /** Cast ref to the avatar the hotel gave it for this replay. */
  private readonly avatars = new Map<string, number>();
  private readonly gone = new Set<string>();
  private readonly chains = new Map<string, Promise<void>>();
  /** Per actor: when its commands went out, so a fast replay stays inside the hotel's per-actor budgets. */
  private readonly pacers = new Map<string, ActorPacer>();
  private readonly timers = new Set<TimerHandle>();
  private abort = new AbortController();
  private paused = false;
  private linkDown = false;
  private wake: (() => void) | undefined;
  private stopping: Promise<void> | undefined;
  private executed = 0;
  /** The film's bars are up (a cinematic replay that is stopped early closes them). */
  private letterbox = false;
  private goneWaiters = new Set<string>();
  private goneResolve: (() => void) | undefined;
  private readonly speaking = { lines: 0, moves: 0, cues: 0 };

  constructor(readonly params: RunStartParams, private readonly d: ReplayDeps) {
    this.id = params.run;
    this.home = String(params.room);
    this.log = d.logger ?? silentLogger;
  }

  /** Same shape as a live run, so the manager treats them alike. */
  get agentIds(): string[] {
    return [...this.avatars.keys()].map((r) => this.refOf(r));
  }

  get stats() {
    return { ...this.speaking, steps: this.executed };
  }

  private refOf(ref: string): string {
    return scopeRef(this.id, ref);
  }

  roomsInUse(): RoomId[] {
    const rooms = new Set<RoomId>([this.home]);
    for (const ref of this.avatars.keys()) {
      const r = this.d.mirror.roomOfRef(this.refOf(ref));
      if (r) rooms.add(r);
    }
    return [...rooms];
  }

  /** Human chat is never read by a replay: nobody is listening. */
  holdsActorIn(_room: RoomId): boolean {
    return false;
  }

  // ---- load -------------------------------------------------------------------

  /** Reads the recorded run and works out who is in it. Throws `ReplayError` with a code the admin can be told. */
  async prepare(spec: ReplaySpec): Promise<void> {
    this.spec = { ...spec, speed: this.d.timing?.replaySpeed ?? spec.speed };
    const artifacts = await loadReplayArtifacts(this.d.hotel.dataDir, spec.source);
    this.plan = buildReplayPlan(artifacts, { cinematic: spec.mode === "cinematic" });
    for (const w of this.plan.warnings) this.log.warn("replay", { run: this.id, source: spec.source, warning: w });
    if (this.plan.cast.length > this.params.capActors) throw new ReplayError("replay_corrupt", `the recording has ${this.plan.cast.length} actors, the cap is ${this.params.capActors}`);
    // Names and outfits come from the scenario version the run used (immutable).
    let raw: unknown;
    try {
      raw = await this.d.link.fetchScenarioVersion(artifacts.manifest.scenarioVersion);
    } catch (err) {
      throw new ReplayError("replay_not_found", `scenario version ${artifacts.manifest.scenarioVersion} is not available: ${(err as Error).message}`);
    }
    const parsed = parseScenarioBody(raw !== null && typeof raw === "object" && "body" in raw ? (raw as { body: unknown }).body : raw);
    if (!parsed.ok) throw new ReplayError("replay_corrupt", "the recorded scenario version no longer parses");
    for (const a of parsed.body.config.agents) {
      const look = parsed.body.looks?.[a.id];
      this.names.set(a.id, { name: a.promptProfile.displayName, figure: look?.figure ?? "", ...(look?.effect ? { effect: look.effect } : {}) });
    }
  }

  // ---- play -------------------------------------------------------------------

  async launch(): Promise<void> {
    const { link, clock } = this.d;
    const plan = this.plan;
    if (!plan) throw new Error("prepare() first");
    link.trackRun(this.id);
    link.subscribe(this.home);
    if (!(await link.waitForRoom(this.home, 10_000))) throw new Error("the target room did not sync");
    if (this.stopping) return;
    this.state = "running";
    this.log.info("replay running", { run: this.id, source: this.spec.source, mode: this.spec.mode, steps: plan.steps.length, actors: plan.cast.length });

    // Spawns are steps of their own, a beat before each actor first acts.
    type Item = { at: number; spawn?: string; step?: ReplayStep };
    const timeline: Item[] = [
      ...plan.cast.map((c): Item => ({ at: Math.max(0, c.firstAt - SPAWN_LEAD_MS), spawn: c.ref })),
      ...plan.steps.map((step): Item => ({ at: step.at, step })),
    ].sort((a, b) => a.at - b.at || (a.spawn ? -1 : 1) - (b.spawn ? -1 : 1));
    const speed = this.spec.speed;
    let elapsed = 0;
    for (const item of timeline) {
      if (!(await this.waitUntil(item.at, elapsed, speed))) return;
      elapsed = item.at;
      if (item.spawn) this.enqueue(item.spawn, () => this.spawn(item.spawn as string));
      else if (item.step) this.run(item.step);
    }
    await Promise.all(this.chains.values());
    await sleepOn(clock, (this.d.timing?.replayTailMs ?? 1500) / speed, this.abort.signal);
    if (!this.stopping) void this.stop("completed");
  }

  /** Waits for plan time `at` (from `from`), in slices so a pause or a stop is honoured. False when stopped. */
  private async waitUntil(at: number, from: number, speed: number): Promise<boolean> {
    let remaining = (at - from) / speed;
    for (;;) {
      if (this.abort.signal.aborted) return false;
      // Checked after every slice, the last one included: a pause that lands while the next thing is due holds it.
      if (this.paused || this.linkDown) {
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        continue;
      }
      if (remaining <= 0) return true;
      const dt = Math.min(remaining, SLICE_MS);
      if (!(await sleepOn(this.d.clock, dt, this.abort.signal))) return false;
      remaining -= dt;
    }
  }

  /** One recorded act per actor at a time, in the order it was recorded, after that actor has been spawned. */
  private enqueue(ref: string, fn: () => Promise<void> | void): void {
    const prior = this.chains.get(ref) ?? Promise.resolve();
    this.chains.set(ref, prior.then(fn).catch((err) => this.log.warn("replay step failed", { run: this.id, ref, error: err instanceof Error ? err.message : String(err) })));
  }

  private run(step: ReplayStep): void {
    this.executed++;
    if (step.k === "ui") {
      const ui = this.remapUi(step.ui);
      if (ui) {
        this.d.link.send({ t: "ui_push", run: this.id, to: { run: this.id }, ui });
        this.speaking.cues++;
        if (ui.k === "hud" && ui.letterbox !== undefined && ui.letterbox !== null) this.letterbox = ui.letterbox;
      }
      return;
    }
    this.enqueue(step.ref, () => this.command(step));
  }

  private async spawn(ref: string): Promise<void> {
    const { link, mirror, clock } = this.d;
    if (this.stopping || this.avatars.has(ref)) return;
    const info = this.names.get(ref) ?? { name: ref.slice(0, 16), figure: "" };
    const lease = link.leaseOf(this.id);
    if (lease === undefined) throw new Error("lease lost before spawn");
    const cid = link.nextCid(this.id);
    const answer = link.expectCid(cid, this.d.timing?.spawnTimeoutMs ?? 5000);
    link.send({ t: "actor_spawn", cid, run: this.id, lease, ref: this.refOf(ref), name: info.name, figure: info.figure, ...(info.effect ? { effect: info.effect } : {}), room: this.params.room, tile: null });
    const frame = await answer;
    if (frame.t !== "actor_spawned") {
      this.gone.add(ref);
      throw new Error(`spawn of ${info.name} refused: ${frame.t === "actor_error" ? frame.code : frame.t}`);
    }
    mirror.registerActor({ ref: this.refOf(ref), id: frame.actor, run: this.id, name: info.name }, String(frame.room), clock.now());
    this.avatars.set(ref, frame.actor);
    this.pacerOf(ref).noteJoin(clock.now());
    await sleepOn(clock, this.d.timing?.spawnIntervalMs ?? 200);
  }

  // ---- re-sending what was recorded --------------------------------------------

  private get retargeted(): boolean {
    return this.plan?.home !== undefined && this.plan.home !== this.params.room;
  }

  private mapRoom(room: number): number {
    return this.plan?.home !== undefined && room === this.plan.home ? this.params.room : room;
  }

  private newIdOfOld(old: number): number | undefined {
    const ref = this.plan?.avatarRefs[old];
    return ref === undefined ? undefined : this.avatars.get(ref);
  }

  private pacerOf(ref: string): ActorPacer {
    let pacer = this.pacers.get(ref);
    if (!pacer) {
      pacer = new ActorPacer();
      this.pacers.set(ref, pacer);
    }
    return pacer;
  }

  private async command(step: Extract<ReplayStep, { k: "cmd" }>): Promise<void> {
    const { link, clock } = this.d;
    const actor = this.avatars.get(step.ref);
    if (this.stopping || actor === undefined || link.leaseOf(this.id) === undefined || this.gone.has(step.ref)) return;
    const wire = this.remapCmd(step);
    if (!wire) return;
    // The hotel drops what goes over an actor's budgets (`rate_limited`, `slow_down`), which a fast replay would hit.
    const pacer = this.pacerOf(step.ref);
    for (let wait = pacer.waitMs(clock.now(), wire); wait > 0; wait = pacer.waitMs(clock.now(), wire)) {
      if (!(await sleepOn(clock, wait, this.abort.signal))) return;
    }
    const lease = link.leaseOf(this.id);
    if (this.stopping || lease === undefined || this.gone.has(step.ref)) return;
    pacer.record(clock.now(), wire);
    link.send({ t: "actor_cmd", cid: link.nextCid(this.id), run: this.id, lease, actor, cmd: wire });
    if (wire.k === "chat" && wire.mode !== "thought") this.speaking.lines++;
    else if (wire.k === "walk" || wire.k === "move_room") this.speaking.moves++;
  }

  /** The recorded command for the new actor and room; undefined when it has no meaning here (a seat or a person that is not in this room). */
  private remapCmd(step: Extract<ReplayStep, { k: "cmd" }>): ActorCmd | undefined {
    const cmd = step.cmd;
    // A command from the recorded home room is in coordinates the target room may not share.
    const fromHome = this.retargeted && (step.room === undefined || step.room === this.plan?.home);
    switch (cmd.k) {
      case "walk": {
        if (!fromHome) return cmd;
        const view = this.d.mirror.view(this.refOf(step.ref), this.d.clock.now())?.room;
        if (!view) return undefined;
        const to = pickTile({ room: view, self: this.refOf(step.ref), near: [Math.min(cmd.x, view.w - 1), Math.min(cmd.y, view.h - 1)], radius: 3, rng: this.d.rng });
        return to ? { ...cmd, x: to[0], y: to[1] } : undefined;
      }
      case "sit":
        return fromHome ? undefined : cmd;
      case "face":
        return fromHome && cmd.tile ? undefined : cmd;
      case "chat": {
        if (cmd.to === undefined || cmd.to === null) return cmd;
        const to = this.newIdOfOld(cmd.to);
        // A whisper to someone who is not here is not said to anyone else.
        if (to === undefined) return cmd.mode === "whisper" ? undefined : { ...cmd, to: null };
        return { ...cmd, to };
      }
      case "pair": {
        const w = this.newIdOfOld(cmd.with);
        return w === undefined ? undefined : { ...cmd, with: w };
      }
      case "move_room":
        return { ...cmd, room: this.mapRoom(cmd.room) };
      case "act":
        // REPLAY-1: the plan already drops them; this is the second lock, so a hand-built plan cannot send one either.
        return undefined;
      default:
        return cmd;
    }
  }

  /** A cue for the new avatars and rooms; undefined when it points at someone who is not in this replay. */
  private remapUi(ui: PerfectmanUi): PerfectmanUi | undefined {
    switch (ui.k) {
      case "thought":
      case "cue": {
        const id = this.newIdOfOld(ui.id);
        return id === undefined ? undefined : { ...ui, id };
      }
      case "camera": {
        const t = ui.target;
        if ("avatar" in t) {
          const id = this.newIdOfOld(t.avatar);
          return { ...ui, target: id === undefined ? { room: true } : { avatar: id } };
        }
        if ("pair" in t) {
          const a = this.newIdOfOld(t.pair[0]);
          const b = this.newIdOfOld(t.pair[1]);
          return { ...ui, target: a === undefined || b === undefined ? { room: true } : { pair: [a, b] } };
        }
        if (("furni" in t || "tile" in t) && this.retargeted) return { ...ui, target: { room: true } };
        return ui;
      }
      case "cut":
      case "next_room":
        return { ...ui, room: this.mapRoom(ui.room) };
      default:
        return ui;
    }
  }

  // ---- inbound -----------------------------------------------------------------

  handleFrame(frame: HotelFrame): void {
    const { mirror, clock } = this.d;
    switch (frame.t) {
      case "arrived":
        mirror.applyArrived(frame.actor, frame.room, frame.x, frame.y, clock.now());
        return;
      case "moved_room":
        mirror.applyMovedRoom(frame.actor, frame.from, frame.to, frame.x, frame.y, clock.now());
        return;
      case "actor_gone": {
        const rref = mirror.refOfAvatar(frame.actor);
        const ref = [...this.avatars].find(([, id]) => id === frame.actor)?.[0];
        if (ref) this.gone.add(ref);
        this.goneWaiters.delete(rref);
        if (this.goneWaiters.size === 0) this.goneResolve?.();
        mirror.unregisterActor(rref);
        return;
      }
      case "actor_error":
        // A recorded command the hotel refuses here (a tile, a seat) is not worth stopping for.
        this.log.info("replay command refused", { run: this.id, code: frame.code });
        return;
      default:
        return;
    }
  }

  async handleHumanChat(_frame: Extract<HotelFrame, { t: "human_chat" }>): Promise<void> {}
  mirrorMoved(_ref: string): void {}
  mirrorLeft(_ref: string): void {}
  humanTyping(_room: RoomId, _typing: boolean, _at: number): void {}
  async steer(_text: string, _to?: string): Promise<boolean> {
    return false;
  }
  resolveWhisperTarget(_args: string): undefined {
    return undefined;
  }
  async wipeMemory(_args: string): Promise<boolean> {
    return false;
  }
  get p95Drift(): boolean {
    return false;
  }

  // ---- lifecycle ---------------------------------------------------------------

  setLinkDown(down: boolean): void {
    this.linkDown = down;
    if (!down) this.wake?.();
  }

  pause(cause: PauseCause): void {
    if (this.state !== "running" && this.state !== "paused") return;
    if (this.state === "paused" && !(cause === "admin" && this.pauseCause === "idle")) return;
    this.state = "paused";
    this.pauseCause = cause;
    this.paused = true;
  }

  resume(source: "admin" | "auto" | "breaker"): boolean {
    if (this.state !== "paused") return false;
    if (source === "auto" && this.pauseCause !== "idle") return false;
    if (source === "breaker") return false;
    this.state = "running";
    this.pauseCause = undefined;
    this.paused = false;
    this.wake?.();
    return true;
  }

  status(loopLagMs?: number): Extract<SidecarMsg, { t: "run_status" }> {
    return {
      t: "run_status",
      run: this.id,
      state: this.state,
      ...(this.pauseCause ? { pause_cause: this.pauseCause } : {}),
      pulse: this.executed,
      llm_calls: 0,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      undelivered_committed: 0,
      ...(loopLagMs !== undefined ? { lag_ms: Math.round(loopLagMs) } : {}),
    };
  }

  statusText(): string {
    const total = this.plan?.steps.length ?? 0;
    return `replay of run ${this.spec?.source ?? "?"} (${this.spec?.mode ?? "?"}), ${this.executed}/${total} steps, ${this.state}`;
  }

  notice(code: string, kind: "info" | "warn" | "error", text?: string): void {
    this.d.link.send({ t: "ui_push", run: this.id, to: { admin: this.params.admin.id }, ui: { k: "notice", code, kind, ...(text ? { text } : {}) } });
  }

  stop(reason: SidecarEndReason, summary?: string, opts: StopOptions = {}): Promise<void> {
    this.stopping ??= this.teardown(reason, summary, opts);
    return this.stopping;
  }

  private async teardown(reason: SidecarEndReason, summary: string | undefined, opts: StopOptions): Promise<void> {
    const { link, mirror } = this.d;
    this.state = "stopping";
    this.abort.abort();
    this.wake?.();
    for (const t of this.timers) t.cancel();
    try {
      await Promise.race([Promise.all(this.chains.values()), sleepOn(this.d.clock, (this.d.timing?.spawnTimeoutMs ?? 5000) + 500)]);
      // A film stopped early still closes: the audience gets its letterbox back.
      if (this.letterbox && link.connected && !opts.byHotel) {
        link.send({ t: "ui_push", run: this.id, to: { run: this.id }, ui: { k: "hud", letterbox: false, fade: { to: 0, ms: 300 } } });
      }
      if (!opts.byHotel && link.connected) await this.walkOut();
    } finally {
      for (const ref of this.avatars.keys()) mirror.unregisterActor(this.refOf(ref));
      link.untrackRun(this.id);
      this.state = reason === "failed" ? "failed" : "ended";
      if (!opts.byHotel && !opts.interrupted) link.send({ t: "run_end", run: this.id, reason, ...(summary ? { summary } : {}) });
      this.d.onEnded(this, reason);
    }
  }

  private async walkOut(): Promise<void> {
    const { link, clock, mirror } = this.d;
    const lease = link.leaseOf(this.id);
    if (lease === undefined) return;
    const live = [...this.avatars].filter(([ref]) => !this.gone.has(ref));
    if (live.length === 0) return;
    const done = new Promise<void>((resolve) => {
      this.goneResolve = resolve;
    });
    for (const [ref, id] of live) {
      this.goneWaiters.add(this.refOf(ref));
      link.send({ t: "actor_despawn", cid: link.nextCid(this.id), run: this.id, lease, actor: id, mode: "walk_out" });
    }
    await Promise.race([done, sleepOn(clock, this.d.timing?.walkOutTimeoutMs ?? 10_000)]);
    for (const rref of [...this.goneWaiters]) {
      const id = mirror.avatarId(rref);
      if (id !== undefined) link.send({ t: "actor_despawn", cid: link.nextCid(this.id), run: this.id, lease, actor: id, mode: "now" });
    }
  }

  async abandon(): Promise<void> {
    await this.stop("failed", "interrupted", { byHotel: true });
  }
}
