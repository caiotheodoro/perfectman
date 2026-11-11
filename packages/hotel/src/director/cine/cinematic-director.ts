/**
 * The cinematic run mode (D18, D19, D38): buffered lookahead plus a playback
 * clock.
 *
 * The engine runs ahead of what the audience sees. Its speech and thoughts do
 * not reach the hotel when the gateway decides: they are caught at the
 * executor seam, queued, and released one at a time by the playback clock, each
 * after the camera is on its speaker and held for its reading time. LLM
 * latency is spent inside the lookahead buffer, so the viewer never sees it;
 * and when the buffer runs dry anyway, a filler (establishing shot, narrator
 * aside, murmur) keeps dead air short.
 *
 * Movement, faces and pair acts stay live: they are the room, not the film.
 * They are observed, and become tracking shots, inserts and SFX only while
 * they are fresh.
 */
import type { Clock, TimerHandle } from "../../clock/clock.js";
import type { GatewayExecutor } from "../../gateway/hotel-gateway.js";
import type { PlannedCommand } from "../../embodiment/types.js";
import type { Logger } from "../../util/log.js";
import type { PerfectmanUi, SidecarMsg } from "../index.js";
import { canonicalize } from "./cue-vocab.js";
import { drawThought, dropLeave, dropPair, dropWalk } from "./hold-spot.js";
import { computeMetrics } from "./metrics.js";
import type { DirectorMetrics } from "./metrics.js";
import { Narrator } from "./narrator.js";
import { ACT_FX, ACT_VERBS, ShotPlanner, canStage, estimateMs } from "./planner.js";
import { expire, selectNext } from "./select.js";
import { TrackRecorder } from "./track.js";
import { DEFAULT_CINE } from "./types.js";
import type { ActItem, CameraIntent, CineConfig, CineItem, CineMood, CineWorld, LineItem, ObjectItem, Program, Step, StoryPhase, Tile } from "./types.js";

/** Gestures that are part of the film; the rest (fidgets, stand, idle) stay live. */
const GATED_GESTURES: ReadonlySet<string> = new Set(["laugh", "wave", "thumbs", "sign", "dance"]);
/** `ui` kinds that take `in_ms`; `next_room` and `cut` do not. */
const TIMED_KINDS: ReadonlySet<PerfectmanUi["k"]> = new Set(["hud", "card", "lower_third", "caption", "thought", "cue", "camera", "camera_fx", "sfx", "cut_fx"]);

export type CinematicOptions = {
  run: number;
  home: number;
  clock: Clock;
  world: CineWorld;
  narrator: Narrator;
  send(msg: SidecarMsg): boolean;
  logger: Logger;
  config?: Partial<CineConfig>;
  /** The scenario's own title or situation, for the opening card. */
  premise?: string;
  /** One line per track entry, e.g. a file sink. */
  trackSink?: (line: string) => void;
};

/** 0..1: how much a line deserves a close-up. Deterministic from the text and the speaker's mood. */
export function lineSalience(text: string, mode: LineItem["mode"], mood: CineMood | undefined): number {
  let s = 0.25;
  if (mode === "shout") s += 0.3;
  if (mode === "whisper") s += 0.2;
  if (text.includes("!")) s += 0.15;
  if (text.includes("?")) s += 0.1;
  if (text.length > 120) s += 0.1;
  if (mood) s += Math.abs(mood.valence) * 0.2 + mood.arousal * 0.15;
  return Math.min(1, s);
}

export class CinematicDirector {
  readonly track: TrackRecorder;
  readonly planner: ShotPlanner;
  readonly cfg: CineConfig;
  private readonly queue: CineItem[] = [];
  private readonly held = new Map<string, () => void>();
  /** Held walks, doors and pair acts (not speech): their actor and order, so an actor's acts are released in the order they were planned. */
  private readonly heldActs = new Map<string, { ref: string; seq: number; with?: string }>();
  private readonly timers = new Set<TimerHandle>();
  private inner: GatewayExecutor | undefined;
  private idle: TimerHandle | undefined;
  private startedAt = 0;
  private seq = 0;
  private busy = false;
  private paused = false;
  private started = false;
  private phase: "live" | "draining" | "ended" = "live";
  private drainDone: (() => void) | undefined;
  private current: TimerHandle | undefined;

  constructor(private readonly o: CinematicOptions) {
    this.cfg = { ...DEFAULT_CINE, ...o.config };
    this.planner = new ShotPlanner(this.cfg);
    this.track = new TrackRecorder(o.trackSink);
  }

  // ---- lifecycle --------------------------------------------------------------

  /** Opens the film: letterbox, the title card, the establishing shot. Call once, before the first pulse. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const { clock, world, narrator, home } = this.o;
    this.startedAt = clock.now();
    this.track.add({ t: 0, k: "start", run: this.o.run, room: home, lang: this.cfg.language });
    narrator.begin(home, { kind: "title", roomName: world.roomName(home), ...(this.o.premise ? { premise: this.o.premise } : {}), cast: this.members(), lines: [] });
    this.busy = true;
    void (async () => {
      await narrator.ready(home, "title", this.cfg.narratorWaitMs);
      if (this.hasEnded()) return;
      this.play(this.planner.intro(this.t(), home, world, narrator));
    })();
  }

  /** Playback pauses at the end of the current program; steps already scheduled still play. */
  pause(): void {
    if (this.paused || this.phase === "ended") return;
    this.paused = true;
    this.cancelIdle();
    this.track.add({ t: this.t(), k: "pause" });
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.track.add({ t: this.t(), k: "resume" });
    this.kick();
  }

  /**
   * Ends the film. With `drain`, buffered lines keep playing (up to `drainMs`);
   * either way the HUD is closed with a fade and the track gets its `end`.
   */
  async stop(reason: string, drain: boolean): Promise<void> {
    if (this.phase === "ended") return;
    if (drain && this.started && !this.paused) {
      this.phase = "draining";
      this.cancelIdle();
      await new Promise<void>((resolve) => {
        this.drainDone = resolve;
        const deadline = this.o.clock.setTimer(resolve, this.cfg.drainMs);
        this.timers.add(deadline);
        this.kick();
      });
    }
    this.phase = "ended";
    this.drainDone = undefined;
    this.cancelIdle();
    for (const item of this.queue.splice(0)) this.drop(item, "stopped");
    this.held.clear();
    this.heldActs.clear();
    if (!this.started) return void this.track.add({ t: this.t(), k: "end", reason });
    for (const timer of this.timers) timer.cancel();
    this.timers.clear();
    this.current?.cancel();
    const outro = this.planner.outro(this.t());
    this.schedule(outro);
    await new Promise<void>((resolve) => this.timers.add(this.o.clock.setTimer(resolve, outro.durationMs)));
    this.track.add({ t: this.t(), k: "end", reason });
  }

  // ---- the lookahead budget (D18) ---------------------------------------------

  /** Milliseconds of film waiting in the buffer. */
  bufferedMs(): number {
    return this.queue.reduce((sum, item) => sum + estimateMs(item, this.cfg), 0);
  }

  /** False once the buffer holds `lookaheadPulses` pulses of film: the run should skip its next pulse. */
  wantsMore(): boolean {
    return this.phase !== "live" || this.bufferedMs() < this.cfg.lookaheadPulses * this.cfg.pulseMs;
  }

  get queued(): number {
    return this.queue.length;
  }

  metrics(): DirectorMetrics {
    return computeMetrics(this.track.entries, { deadAirMs: this.cfg.deadAirMs, minShotMs: this.cfg.minShotMs, varietyWindowMs: this.cfg.varietyWindowMs, minShotKinds: this.cfg.minShotKinds, ...(this.started && this.phase !== "ended" ? { now: this.t() } : {}) });
  }

  // ---- the executor seam ------------------------------------------------------

  /**
   * The executor the run hands to the gateway and the planner. Speech, thoughts
   * and show-gestures are held for playback, and so are walks, doors and pair
   * acts once the film is rolling, so each happens when the camera is on it
   * (or, if it waited out its age limit, unfilmed); everything else passes
   * straight through, observed.
   */
  wrapExecutor(inner: GatewayExecutor): GatewayExecutor {
    this.inner = inner;
    return {
      send: (cmds) => this.intercept(cmds),
      sendThought: (agentId, text) => {
        if (this.phase === "ended") return inner.sendThought(agentId, text);
        if (!drawThought(this.o.home)) return;
        if (!showThought(text)) return;
        this.enqueue({ kind: "thought", ref: agentId, text, room: this.roomOf(agentId), salience: 0.5 });
      },
    };
  }

  private intercept(cmds: PlannedCommand[]): void {
    const inner = this.inner;
    if (!inner) return;
    if (this.phase === "ended") return inner.send(cmds);
    const pass: PlannedCommand[] = [];
    for (const c of cmds) {
      switch (c.cmd) {
        case "chat": {
          const mode = c.mode;
          const mood = this.o.world.moodOf(c.agentId);
          this.enqueue({ kind: "line", ref: c.agentId, text: c.text, mode, ...(c.to ? { to: c.to } : {}), room: this.roomOf(c.agentId), salience: lineSalience(c.text, mode, mood) }, () => inner.send([c]));
          break;
        }
        case "typing":
          // The typing bubble is shown just before the line plays, not while it waits in the buffer.
          if (!c.on) pass.push(c);
          break;
        case "gesture":
          if (GATED_GESTURES.has(c.a) && !c.fidget) {
            this.enqueue({ kind: "gesture", ref: c.agentId, gesture: c.a, room: this.roomOf(c.agentId), salience: 0.3 }, () => inner.send([c]));
          } else pass.push(c);
          break;
        case "walk": {
          if (dropWalk(this.o.home, c.plan)) break;
          // A door entrance is a wide shot of the room, not a tracking shot of a few steps.
          if (c.plan?.endsWith(":enter") && this.started) {
            this.enqueue({ kind: "entrance", ref: c.agentId, room: this.roomOf(c.agentId), salience: 0.45 });
            pass.push(c);
            break;
          }
          const from = this.o.world.tileOf(c.agentId);
          const steps = from ? Math.max(Math.abs(from[0] - c.to[0]), Math.abs(from[1] - c.to[1])) : 0;
          // A short walk is never filmed, and the cast walking in is part of the opening: both go straight out.
          if (!this.enqueueAct({ kind: "walk", ref: c.agentId, steps, room: this.roomOf(c.agentId), salience: 0.2 }, c, steps >= 3 && !c.plan?.endsWith(":enter"), inner)) pass.push(c);
          break;
        }
        case "move_room": {
          if (dropLeave(this.o.home)) break;
          if (!this.enqueueAct({ kind: "hop", ref: c.agentId, to: Number(c.to), room: this.roomOf(c.agentId), salience: 0.45 }, c, true, inner)) pass.push(c);
          break;
        }
        case "pair": {
          if (dropPair(this.o.home)) break;
          if (!this.enqueueAct({ kind: "pair", ref: c.agentId, pair: c.kind, with: c.with, room: this.roomOf(c.agentId), salience: 0.7 }, c, true, inner)) pass.push(c);
          break;
        }
        case "act":
          pass.push(c);
          if (this.started && ACT_VERBS.has(c.verb)) this.playActFx(c.agentId, c.verb, c.with);
          break;
        default:
          pass.push(c);
      }
    }
    if (pass.length > 0) inner.send(pass);
  }

  /** Queues an act and holds its command until the beat plays; false when the command must go straight out (nothing is filming yet, or it is not worth a shot). */
  private enqueueAct(item: DistributiveOmit<CineItem, "id" | "seq" | "at">, c: PlannedCommand, worthIt: boolean, inner: GatewayExecutor): boolean {
    if (!worthIt || !this.started || this.phase === "ended") {
      this.enqueue(item);
      return false;
    }
    // The queue entry exists before the item can play, and so must the order record.
    this.heldActs.set(`b${this.seq + 1}`, { ref: c.agentId, seq: this.seq + 1, ...(c.cmd === "pair" ? { with: c.with } : {}) });
    this.enqueue(item, () => inner.send([c]));
    return true;
  }

  /**
   * Runs a held command. An actor's earlier held acts go first, so a pair is never sent ahead of the walk that
   * brought the actor there, and so do the partner's: a kiss is not sent while the person being kissed still has a
   * walk waiting in the buffer (the executor then holds the act until that walk has arrived).
   */
  private release(id: string): void {
    const act = this.heldActs.get(id);
    if (act) {
      const before = [...this.heldActs].filter(([, a]) => (a.ref === act.ref || (act.with !== undefined && a.ref === act.with)) && a.seq < act.seq).sort((x, y) => x[1].seq - y[1].seq);
      for (const [other] of before) this.release(other);
    }
    this.heldActs.delete(id);
    const run = this.held.get(id);
    this.held.delete(id);
    run?.();
  }

  private roomOf(ref: string): number {
    return this.o.world.roomOf(ref) ?? this.o.home;
  }

  /**
   * An act with a body went out: the moves its contact calls for (stop the room, shake, slow motion on a kill), planned
   * at once and not behind the film's current program, since the table plays the act on its own clock from now. The
   * act is not held for the camera (a held act would stall the drama director's own timing and the scenario's forced climax).
   */
  private playActFx(ref: string, verb: string, withRef: string | undefined): void {
    const fx = ACT_FX[verb];
    if (!fx) return;
    const seq = ++this.seq;
    const item: ActItem = { kind: "act", id: `b${seq}`, seq, at: this.o.clock.now(), room: this.roomOf(ref), ref, verb, ...(withRef ? { with: withRef } : {}), contactMs: fx.contactMs, salience: 0.9 };
    const program = this.planner.planAct(item, this.t());
    if (program) this.schedule(program, item);
  }

  /** Where the scene is in its arc (a beat sheet's phase); the planner frames the next shots by it. */
  setPhase(phase: StoryPhase): void {
    this.planner.setPhase(phase);
  }

  /**
   * A camera beat of a beat sheet, played now: its shot and its move. False when the film is not rolling or the beat
   * names someone who is not in the picture.
   */
  playIntent(intent: CameraIntent): boolean {
    if (!this.started || this.phase === "ended") return false;
    const program = this.planner.planIntent(intent, this.t(), this.o.world);
    if (!program) return false;
    this.schedule(program);
    return true;
  }

  /** A world event worth an insert shot ("a fire alarm goes off"). */
  noteObject(o: { room: number; ref?: string; furni?: number; tile?: Tile; label?: string; sfx?: string }): void {
    const item: Omit<ObjectItem, "id" | "seq" | "at"> = { kind: "object", ref: o.ref ?? "", room: o.room, salience: 0.8, ...(o.furni !== undefined ? { furni: o.furni } : {}), ...(o.tile ? { tile: o.tile } : {}), ...(o.label ? { label: o.label } : {}), ...(o.sfx ? { sfx: o.sfx } : {}) };
    this.enqueue(item);
  }

  /** Adds an item to the buffer; returns its id, or undefined when the film is over and nothing is queued. */
  enqueue(item: DistributiveOmit<CineItem, "id" | "seq" | "at">, hold?: () => void): string | undefined {
    if (this.phase === "ended") return undefined;
    const seq = ++this.seq;
    const full = { ...item, id: `b${seq}`, seq, at: this.o.clock.now() } as CineItem;
    // Registered before the item can play: a covered shot releases at program time 0, inside the advance below.
    if (hold) this.held.set(full.id, hold);
    this.queue.push(full);
    this.beginScene(full);
    if (this.started && !this.busy && !this.paused) {
      this.cancelIdle();
      void this.advance();
    }
    return full.id;
  }

  // ---- narrator ---------------------------------------------------------------

  private cast(room: number): Array<{ name: string; role?: string }> {
    return this.named(this.o.world.occupants(room));
  }

  /** The whole cast: at the opening nobody has walked in yet, so the room has no occupants to name. */
  private members(): Array<{ name: string; role?: string }> {
    return this.named(this.o.world.members());
  }

  private named(refs: string[]): Array<{ name: string; role?: string }> {
    const { world } = this.o;
    return refs.map((ref) => {
      const role = world.roleOf(ref);
      return { name: world.nameOf(ref), ...(role ? { role } : {}) };
    });
  }

  /** The first sighting of a room starts its narrator pass now, while the item waits in the buffer. */
  private beginScene(item: CineItem): void {
    const { narrator, world, home } = this.o;
    if (item.room === home || narrator.has(item.room, "scene")) return;
    const lines = this.queue.filter((q): q is LineItem => q.kind === "line" && q.room === item.room).slice(0, 6).map((q) => ({ name: world.nameOf(q.ref), text: q.text }));
    narrator.begin(item.room, { kind: "scene", roomName: world.roomName(item.room), cast: this.cast(item.room), lines });
  }

  // ---- playback ---------------------------------------------------------------

  private t(): number {
    return this.o.clock.now() - this.startedAt;
  }

  private cancelIdle(): void {
    this.idle?.cancel();
    this.idle = undefined;
  }

  /** A method, so the compiler does not carry a stale narrowing of `phase` across an await. */
  private hasEnded(): boolean {
    return this.phase === "ended";
  }

  private kick(): void {
    if (!this.busy && !this.paused && this.phase !== "ended") void this.advance();
  }

  private async advance(): Promise<void> {
    if (this.busy || this.paused || this.phase === "ended") return;
    this.busy = true;
    this.cancelIdle();
    const { clock, world, narrator } = this.o;
    for (;;) {
      const held = new Set(this.heldActs.keys());
      for (const d of expire(this.queue, clock.now(), this.cfg, held)) this.drop(d, "stale");
      const now = this.t();
      const item = selectNext(this.queue, clock.now(), { now, room: this.planner.currentRoom, roomSince: this.planner.roomSince, followRef: this.planner.followRef(now), cfg: this.cfg, held });
      if (!item) {
        this.busy = false;
        if (this.phase === "draining") this.drainDone?.();
        else this.armIdle();
        return;
      }
      this.queue.splice(this.queue.indexOf(item), 1);
      if (!canStage(item, world)) {
        this.drop(item, "unstageable");
        continue;
      }
      if (item.room !== this.planner.currentRoom && narrator.has(item.room, "scene")) await narrator.ready(item.room, "scene", this.cfg.narratorWaitMs);
      if (this.hasEnded()) return;
      if (this.paused) {
        this.queue.unshift(item);
        this.busy = false;
        return;
      }
      const program = this.planner.plan(item, this.t(), world, narrator);
      if (!program) {
        this.drop(item, "unstageable");
        continue;
      }
      this.play(program, item);
      return;
    }
  }

  private drop(item: CineItem, why: string): void {
    // A held act that is not filmed still happens (late, off camera); only a stop discards it.
    if (why !== "stopped" && this.heldActs.has(item.id)) this.release(item.id);
    this.held.delete(item.id);
    this.track.add({ t: this.t(), k: "drop", beat: item.id, why, item: item.kind });
  }

  private armIdle(): void {
    if (this.paused || this.phase !== "live" || this.planner.consecutiveFillers >= this.cfg.maxConsecutiveFillers) return;
    this.idle = this.o.clock.setTimer(() => {
      this.idle = undefined;
      if (this.busy || this.paused || this.queue.length > 0 || this.phase !== "live") return;
      const program = this.planner.filler(this.t(), this.o.world, this.o.narrator);
      if (!program) return;
      this.busy = true;
      this.play(program);
    }, this.cfg.fillerAfterMs);
  }

  /** Schedules a program's steps and, at its end, hands the stage to the next one. */
  private play(program: Program, item?: CineItem): void {
    this.schedule(program, item);
    // One shot ahead (spectate-and-audience.md 4): tell the client which room comes next, so it can preload art.
    const upcoming = selectNext(this.queue, this.o.clock.now(), { now: this.t(), room: program.room, roomSince: this.planner.roomSince, followRef: undefined, cfg: this.cfg });
    if (upcoming && upcoming.room !== program.room && this.planner.lastActivityIn(upcoming.room) === undefined) {
      this.emit({ at: 0, k: "next_room", room: upcoming.room }, program, 0);
    }
    this.current = this.o.clock.setTimer(() => {
      this.busy = false;
      this.kick();
    }, program.durationMs);
  }

  private schedule(program: Program, item?: CineItem): void {
    const base = this.t();
    const steps = [...program.steps].sort((a, b) => a.at - b.at);
    for (const step of steps) {
      const early = step.k === "ui" && TIMED_KINDS.has(step.ui.k) ? Math.min(this.cfg.cueLeadMs, step.at) : 0;
      const when = step.at - early;
      const fire = (): void => this.emit(step, program, base + step.at, early, item);
      if (when <= 0) fire();
      else {
        const timer = this.o.clock.setTimer(() => {
          this.timers.delete(timer);
          fire();
        }, when);
        this.timers.add(timer);
      }
    }
  }

  /** One step reaches the hotel (or the executor) and the track. `planned` is when the audience sees it. */
  private emit(step: Step, program: Program, planned: number, inMs = 0, item?: CineItem): void {
    const { run, send } = this.o;
    switch (step.k) {
      case "ui": {
        const timed = inMs > 0 ? ({ ...step.ui, in_ms: inMs } as PerfectmanUi) : step.ui;
        // The vocabulary net (camera-and-audio.md 8): the planner emits canonical names, so this only fires for a bug.
        const ui = canonicalize(timed);
        if (!ui) {
          this.o.logger.warn("cue outside the vocabulary dropped", { run, k: timed.k });
          this.track.add({ t: this.t(), k: "drop", beat: program.beat, why: "cue_not_in_vocabulary" });
          return;
        }
        send({ t: "ui_push", run, to: { run }, ui });
        this.track.add({ t: planned, k: "cue", room: program.room, beat: program.beat, ui });
        return;
      }
      case "next_room":
        send({ t: "ui_push", run, to: { run }, ui: { k: "next_room", room: step.room } });
        this.track.add({ t: this.t(), k: "cue", room: program.room, beat: program.beat, ui: { k: "next_room", room: step.room } });
        return;
      case "cut":
        send({ t: "ui_push", run, to: { run }, ui: { k: "cut", room: step.room } });
        this.track.add({ t: planned, k: "cut", room: step.room, from: step.from });
        return;
      case "typing":
        this.inner?.send([{ agentId: step.ref, cmd: "typing", on: true }]);
        return;
      case "release": {
        this.release(step.item.id);
        const it = item ?? step.item;
        if (it.kind === "line") {
          this.track.add({ t: planned, k: "line", room: it.room, beat: it.id, ref: it.ref, avatar: this.o.world.avatarId(it.ref) ?? null, mode: it.mode, text: it.text, ms: Math.max(0, program.durationMs - step.at - this.cfg.beatGapMs) });
        }
        return;
      }
    }
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A thought the audience can read: a short line. Planner notes, temperament words and code stay off the screen. */
function showThought(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 90) return false;
  if (/^(connector|skeptic|performer)$/i.test(t)) return false;
  if (/[{}<>]|\/goto|=>|[a-z][A-Z]/.test(t)) return false;
  if (/\b(mostrar|objetivo|plano|ambiente|curiosidade|esp[ií]rito|estrat[eé]gia|confort[aá]vel|latente|parecer)\b/i.test(t)) return false;
  return true;
}
