import type { AgentState, BodyCommandBody, SpaceView, SpeechMode, Tile } from "@perfectman/shared";
import type { Clock, TimerHandle } from "../../clock/clock.js";
import type { DramaFrameSink } from "../../run/drama-frame-sink.js";
import { NOOP_DRAMA_SINK } from "../../run/drama-frame-sink.js";
import { chebyshev } from "../../space/geometry.js";
import { CMD_BUDGET, WALK_TICK_MS } from "../constants.js";
import { updateMemory } from "../plan.js";
import { pickTile } from "../tiles.js";
import type { PlannedCommand, PlannerMemory } from "../types.js";
import { lineFacts } from "./lines.js";
import { reactToLine } from "./reactions.js";
import type { ReactMem, ReactPerson, TimedCmd } from "./reactions.js";
import { hrand } from "./rng.js";
import { feelOf, cutLine, interrupts, overlapGapMs, reactionLatencyMs, typingPlan } from "./turn.js";
import type { TypingPlan } from "./turn.js";
import { HT, chance } from "./tuning.js";
import { HUMAN_PLAN_PREFIX } from "./rules.js";
import type { HumanLine, HumanLogEntry, HumanPlanCtx, HumanProp } from "./types.js";

/** What the chat gateway asks of the human layer (hotel-gateway.ts). Implemented by `HumanBody`; absent or h = 0 means the gateway is what it was. */
export interface GatewayHuman {
  readonly likeness: number;
  /** The reaction latency (ms from the consult to the first key press) of an actor whose own pace is `baseMs`, by how it feels; undefined at h = 0. */
  think(agentId: string, baseMs: number): number | undefined;
  /** The plan for typing one line after `thinkMs`: undefined for a line to a human guest or at h = 0 (the gateway's own timing stands). */
  typing(agentId: string, text: string, thinkMs: number, to: string | undefined): TypingPlan | undefined;
  /** `a` is about to land and `b` is waiting: whether `b` talks over `a`, and the cut text of `a` and the gap before `b`. */
  interrupt(a: { agentId: string; text: string; to?: string }, b: { agentId: string; to?: string }, now: number): { text: string; gapMs: number } | undefined;
  /** A first line to someone who is far: the walk to take first and how long it takes. */
  approach(agentId: string, to: string | undefined): { cmds: PlannedCommand[]; delayMs: number } | undefined;
  /** Typing display: the bubble comes up after the think time and drops for a hesitation. */
  note(entry: HumanLogEntry): void;
}

export type HumanBodyDeps = {
  clock: Clock;
  /** `human_likeness` for this run, 0..1 (`resolveHumanLikeness`). */
  likeness: number;
  seed: number;
  /** The run's view of a room (`SpaceMirror.view`) and the avatar-to-ref mapping the drama frames use. */
  view(ref: string, now: number): SpaceView | undefined;
  refOfAvatar(id: number): string;
  /** An actor of this run (gets commands) as opposed to a human guest (is only looked at). */
  isOwn(ref: string): boolean;
  /** Display names of the cast and guests, for who a line names. */
  names(): ReadonlyMap<string, string>;
  /** The latest feelings the run has of an actor. */
  stateOf(ref: string): AgentState | undefined;
  /** The executor's door: budgets, staleness gate and the act lock apply. */
  send(cmds: readonly PlannedCommand[]): void;
  /** Planner memory per actor, so cooldowns (gestures, expressions, the last walk) are shared with the planner. */
  memory: { get(ref: string): PlannerMemory | undefined; set(ref: string, m: PlannerMemory): void };
  isDead?(ref: string): boolean;
  isLocked?(ref: string): boolean;
  /** A beat sheet's blocking (or a staged act) holds this actor's feet. */
  holdMove?(ref: string): boolean;
  /** Things in the room that matter to the scene (the envelope, the safe) and the words that point at them. */
  props?(): readonly HumanProp[];
  /** `body-log.jsonl`. The writer stamps the run clock. */
  log?(entry: HumanLogEntry & { at: number }): void;
};

const RING = 14;

/**
 * The human layer's runtime (cinematic revamp B5): it turns a line that just landed into the small, timed things people do (looking, gesturing, the
 * silent answers that replace "hm" and "tá"), supplies the planner with the context the standing rules need (recent lines, a hold, who hit whom), and
 * gives the chat gateway its turn-taking (typing time by line length, reaction latency by feeling, interruptions, walking up before a first line).
 * Everything is a pure function of the seed and the events, and every decision is written to the body log. At h = 0 nothing here does anything.
 */
export class HumanBody implements GatewayHuman {
  readonly sink: DramaFrameSink;
  private readonly lines: HumanLine[] = [];
  private readonly timers = new Set<TimerHandle>();
  private readonly mem = new Map<string, ReactMem>();
  private readonly hits = new Map<string, { ref: string; at: number }>();
  private readonly sent = new Map<string, number[]>();
  private readonly faceSeq = new Map<string, number>();
  private lineN = 0;
  private turnN = 0;
  private lastInterruptAt: number | undefined;
  private closed = false;
  stats = { lines: 0, scheduled: 0, sent: 0, droppedBudget: 0, droppedState: 0, interrupts: 0, approaches: 0 };

  constructor(private readonly d: HumanBodyDeps) {
    this.sink = {
      ...NOOP_DRAMA_SINK,
      onActStarted: (f) => {
        // A shove, slap or punch lands on its target: the victim gives ground once the act is over (rules.ts, `step_back`).
        if (f.with === null || f.with === undefined) return;
        if (!["shove", "slap", "punch"].includes(String(f.verb))) return;
        const victim = this.d.refOfAvatar(f.with);
        this.hits.set(victim, { ref: this.d.refOfAvatar(f.actor), at: this.d.clock.now() });
      },
    };
  }

  get likeness(): number {
    return this.d.likeness;
  }

  get on(): boolean {
    return this.d.likeness > 0 && !this.closed;
  }

  dispose(): void {
    this.closed = true;
    for (const t of this.timers) t.cancel();
    this.timers.clear();
  }

  // ---- the planner's context ------------------------------------------------------------------------

  /** The block `PlanInput.human` carries, or undefined at h = 0 (then the planner is what it was). */
  planCtx(ref: string): HumanPlanCtx | undefined {
    if (!this.on) return undefined;
    const props = this.d.props?.();
    const hit = this.hits.get(ref);
    return {
      h: this.d.likeness,
      seed: this.d.seed,
      lines: this.lines,
      ...(this.d.holdMove?.(ref) ? { hold: true } : {}),
      ...(props && props.length > 0 ? { props } : {}),
      ...(hit ? { hitBy: hit } : {}),
      log: (e) => this.d.log?.({ ...e, at: this.d.clock.now() }),
    };
  }

  // ---- a line landed -----------------------------------------------------------------------------------

  /** A line reached the wire. Schedules the reactions of everyone in the room. Returns the line as the layer read it. */
  onLine(l: { speaker: string; to?: string; text: string; mode?: SpeechMode; lie?: boolean; reveal?: boolean; cut?: boolean }): HumanLine {
    const now = this.d.clock.now();
    const line = lineFacts({
      n: ++this.lineN,
      speaker: l.speaker,
      ...(l.to ? { to: l.to } : {}),
      atMs: now,
      text: l.text,
      ...(l.mode ? { mode: l.mode } : {}),
      cast: this.d.names(),
      ...(l.lie !== undefined ? { lie: l.lie } : {}),
      ...(l.reveal !== undefined ? { reveal: l.reveal } : {}),
    });
    if (l.cut) {
      line.cut = true;
      // A film talked this line over (cine/planner.ts `talkOver`): the cut is the layer's decision, so it is in the body log with what the room saw.
      this.d.log?.({ actor: l.speaker, kind: "interrupt", rule: "interrupt:cut", line: line.n, ...(l.to ? { to: l.to } : {}), detail: `shown "${line.text}"`, at: now });
    }
    const history = [...this.lines];
    this.lines.push(line);
    if (this.lines.length > RING) this.lines.shift();
    this.stats.lines++;
    if (!this.on || l.mode === "whisper") return line;
    const view = this.d.view(l.speaker, now);
    const room = view?.room;
    if (!room || room.stale) return line;
    const people = new Map<string, ReactPerson>();
    for (const p of room.occupants) {
      const own = this.d.isOwn(p.ref);
      const state = own ? this.d.stateOf(p.ref) : undefined;
      people.set(p.ref, { ref: p.ref, presence: p, own, ...(state ? { state } : {}) });
    }
    const gestureOf = (ref: string): Readonly<Record<string, number>> => this.d.view(ref, now)?.body.dwell.lastGestureAt ?? {};
    const cmds = reactToLine({
      h: this.d.likeness,
      seed: this.d.seed,
      line,
      room,
      people,
      history,
      props: this.d.props?.() ?? [],
      memOf: (ref) => this.memOf(ref),
      lastGestureAt: gestureOf,
    });
    for (const c of cmds) this.schedule(line, c);
    return line;
  }

  private memOf(ref: string): ReactMem {
    let m = this.mem.get(ref);
    if (!m) this.mem.set(ref, (m = {}));
    return m;
  }

  private schedule(line: HumanLine, t: TimedCmd): void {
    const fireAt = line.atMs + t.atMs;
    const timer = this.d.clock.setTimer(() => {
      this.timers.delete(timer);
      this.fire(line, t);
    }, Math.max(0, fireAt - this.d.clock.now()));
    this.timers.add(timer);
    this.stats.scheduled++;
    // The cooldowns count from the moment the reaction is decided, so two lines in a row do not both draw the same kind of answer.
    const m = this.memOf(t.ref);
    if (t.log.kind === "backchannel" || t.tag.startsWith("face:")) m.lastBackchannelAt = line.atMs;
    if (t.tag === "gesture" || t.tag === "gesture_sign") m.lastEmphasisAt = line.atMs;
    if (t.tag === "gesture_sign") m.lastSignAt = line.atMs;
    if (t.tag === "react") m.lastReactAt = line.atMs;
  }

  /** A scheduled reaction comes due: look again at the room, and send it only if it still makes sense and the actor has budget for it. */
  private fire(line: HumanLine, t: TimedCmd): void {
    if (this.closed) return;
    const now = this.d.clock.now();
    const skip = (why: string): void => {
      this.stats.droppedState++;
      this.d.log?.({ actor: t.ref, ...t.log, skipped: why, at: now });
    };
    if (this.d.isDead?.(t.ref)) return skip("dead");
    if (this.d.isLocked?.(t.ref)) return skip("locked");
    const view = this.d.view(t.ref, now);
    const self = view?.self;
    if (!view?.room || !self || view.room.stale) return skip("no_view");
    if (self.state === "walk" || self.fallen !== undefined) return skip(self.state === "walk" ? "walking" : "fallen");
    // A face command aimed at a person looks where they stand now, not where they stood when the line landed.
    let cmd: BodyCommandBody = t.cmd;
    if (cmd.cmd === "face" && cmd.targetTile && t.log.to) {
      const at = view.room.occupants.find((p) => p.ref === t.log.to);
      if (!at) return skip("target_gone");
      cmd = { cmd: "face", targetTile: at.tile };
    }
    // Faces that are not neutral decay: a newer face cancels the older one's decay.
    const cmdFace = cmd.cmd === "expression" ? cmd.face : undefined;
    const seq = cmdFace !== undefined ? (this.faceSeq.get(t.ref) ?? 0) + 1 : this.faceSeq.get(t.ref) ?? 0;
    // The human layer's own share of the budget, so it never starves the planner's or an act's commands.
    const times = (this.sent.get(t.ref) ?? []).filter((x) => now - x < HT.budget.windowMs);
    const used = view.body.budget.cmdTimes.filter((x) => now - x < CMD_BUDGET.windowMs).length;
    if (times.length >= HT.budget.perWindow || used >= CMD_BUDGET.count - (t.keep >= 2.5 ? 0 : 1)) {
      this.stats.droppedBudget++;
      this.d.log?.({ actor: t.ref, ...t.log, skipped: "budget", at: now });
      return;
    }
    times.push(now);
    this.sent.set(t.ref, times);
    const planned: PlannedCommand = { agentId: t.ref, ...cmd } as PlannedCommand;
    const mem = this.d.memory.get(t.ref) ?? {};
    this.d.memory.set(t.ref, updateMemory(mem, [planned], now, self.tile));
    this.stats.sent++;
    this.d.log?.({ actor: t.ref, ...t.log, at: now });
    this.d.send([planned]);
    if (cmdFace !== undefined && cmdFace !== "neutral") {
      this.faceSeq.set(t.ref, seq);
      const hold = t.log.ms ?? (HT.gesture.faceHoldMs as Record<string, number>)[cmdFace] ?? 4000;
      const timer = this.d.clock.setTimer(() => {
        this.timers.delete(timer);
        if (this.closed || this.faceSeq.get(t.ref) !== seq || this.d.isDead?.(t.ref) || this.d.isLocked?.(t.ref)) return;
        const m = this.d.memory.get(t.ref) ?? {};
        const back: PlannedCommand = { agentId: t.ref, cmd: "expression", face: "neutral" };
        this.d.memory.set(t.ref, updateMemory(m, [back], this.d.clock.now(), self.tile));
        this.d.log?.({ actor: t.ref, kind: "expression", rule: "decay", at: this.d.clock.now() });
        this.d.send([back]);
      }, hold);
      this.timers.add(timer);
    }
  }

  // ---- the gateway's turn-taking ----------------------------------------------------------------------

  private feelOfActor(agentId: string): ReturnType<typeof feelOf> {
    const st = this.d.stateOf(agentId);
    return st ? feelOf({ arousal: st.coreMood.arousal, valence: st.coreMood.valence, shame: st.socialEmotions.shame, humiliation: st.socialEmotions.humiliation, momentumArousal: st.coreMood.momentumArousal }) : "neutral";
  }

  think(agentId: string, baseMs: number): number | undefined {
    if (!this.on) return undefined;
    const feel = this.feelOfActor(agentId);
    const ms = reactionLatencyMs(baseMs, feel, this.d.likeness);
    this.d.log?.({ actor: agentId, kind: "latency", rule: `latency:${feel}`, ms, detail: `base ${Math.round(baseMs)}`, at: this.d.clock.now() });
    return ms;
  }

  typing(agentId: string, text: string, thinkMs: number, to: string | undefined): TypingPlan | undefined {
    if (!this.on || (to !== undefined && to.startsWith("h:"))) return undefined;
    const plan = typingPlan({ chars: text.length, thinkMs, h: this.d.likeness, seed: this.d.seed, actor: agentId, n: ++this.turnN });
    this.d.log?.({ actor: agentId, kind: "typing", rule: "typing", ms: plan.totalMs, detail: `think ${plan.thinkMs} type ${plan.typingMs}${plan.hesitate ? ` pause ${plan.hesitate.forMs}@${plan.hesitate.afterMs}` : ""} chars ${text.length}`, at: this.d.clock.now() });
    return plan;
  }

  interrupt(a: { agentId: string; text: string; to?: string }, b: { agentId: string; to?: string }, now: number): { text: string; gapMs: number } | undefined {
    if (!this.on || a.agentId === b.agentId) return undefined;
    // Only the cast talks over each other; a human guest's line is never cut.
    if (a.to?.startsWith("h:") || b.to?.startsWith("h:")) return undefined;
    const sa = this.d.stateOf(a.agentId);
    const sb = this.d.stateOf(b.agentId);
    if (!sa || !sb) return undefined;
    const words = a.text.trim().split(/\s+/).length;
    const n = this.lineN + 1;
    const yes = interrupts({
      h: this.d.likeness,
      seed: this.d.seed,
      n,
      speaker: { actor: a.agentId, arousal: sa.coreMood.arousal, words },
      other: { actor: b.agentId, arousal: sb.coreMood.arousal },
      now,
      ...(this.lastInterruptAt !== undefined ? { lastInterruptAt: this.lastInterruptAt } : {}),
    });
    if (!yes) return undefined;
    const cut = cutLine(a.text, this.d.seed, a.agentId, n);
    if (!cut) return undefined;
    this.lastInterruptAt = now;
    this.stats.interrupts++;
    const gapMs = overlapGapMs(this.d.seed, b.agentId, n);
    this.d.log?.({ actor: b.agentId, kind: "interrupt", rule: "interrupt", to: a.agentId, ms: gapMs, detail: `cut "${cut}" from ${words} words`, at: now });
    return { text: cut, gapMs };
  }

  approach(agentId: string, to: string | undefined): { cmds: PlannedCommand[]; delayMs: number } | undefined {
    if (!this.on || !to || to.startsWith("h:")) return undefined;
    if (this.d.isDead?.(agentId) || this.d.isLocked?.(agentId) || this.d.holdMove?.(agentId)) return undefined;
    const now = this.d.clock.now();
    const view = this.d.view(agentId, now);
    const room = view?.room;
    const self = view?.self;
    const other = room?.occupants.find((p) => p.ref === to);
    if (!room || room.stale || !self || !other || self.state !== "stand" || self.fallen !== undefined) return undefined;
    const dist = chebyshev(self.tile, other.tile);
    if (dist < HT.prox.approachFirstAt || dist > HT.prox.earshotMax + 1) return undefined;
    // Only a first line: people who have been talking do not walk up before every sentence.
    if (this.lines.some((l) => now - l.atMs <= 60_000 && ((l.speaker === agentId && l.to === to) || (l.speaker === to && l.to === agentId)))) return undefined;
    if (hrand(this.d.seed, "first", agentId, to, this.turnN) >= chance(0.9, this.d.likeness)) return undefined;
    const ideal = Math.round(HT.prox.approachFirstTo[0] + hrand(this.d.seed, "first-to", agentId, to) * (HT.prox.approachFirstTo[1] - HT.prox.approachFirstTo[0]));
    let n = 0;
    const target = pickTile({ room, self: agentId, near: other.tile, radius: ideal + 1, awayFrom: { tile: other.tile, ideal }, rng: () => hrand(this.d.seed, "first-pick", agentId, n++) });
    if (!target || chebyshev(target, other.tile) >= dist) return undefined;
    const steps = chebyshev(self.tile, target);
    const cmd: PlannedCommand = { agentId, cmd: "walk", to: target, plan: `${HUMAN_PLAN_PREFIX}first:${this.turnN}`, humanTag: "first" } as PlannedCommand;
    this.stats.approaches++;
    this.d.log?.({ actor: agentId, kind: "walk", rule: "approach_then_speak", to, tile: target, dist, ms: steps * WALK_TICK_MS, at: now });
    return { cmds: [cmd], delayMs: steps * WALK_TICK_MS + 250 };
  }

  note(entry: HumanLogEntry): void {
    this.d.log?.({ ...entry, at: this.d.clock.now() });
  }

  /** Whether the given tile is one a human-layer walk was sent to; used by tests. */
  static isHumanWalk(plan: string | undefined): boolean {
    return plan?.startsWith(HUMAN_PLAN_PREFIX) === true;
  }
}

export type { Tile };
