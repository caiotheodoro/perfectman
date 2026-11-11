import type { ActVerb, AgentState, BodyIntent, BlockedReason, Presence, RoomView } from "@perfectman/shared";
import { ACT_TARGET_MODE, ladderRung } from "@perfectman/shared";
import { rememberAct, rememberDeath } from "@perfectman/engine";
import type { ActFacts, ActLang } from "@perfectman/engine";
import type { Clock, TimerHandle } from "../clock/clock.js";
import type { DramaSession } from "../director/dialect.js";
import type { HotelFrame } from "../director/index.js";
import type { DramaFrameSink } from "../run/drama-frame-sink.js";
import { chebyshev } from "../space/geometry.js";
import type { ActorSpace } from "../space/space-mirror.js";
import { ActLedger } from "./act-ledger.js";
import { ReactionScheduler } from "./reaction-scheduler.js";
import { DEFAULT_DRAMA_TUNING } from "../director/drama/tuning.js";
import type { DramaTuning } from "../director/drama/tuning.js";
import { ProvocationLedger } from "../director/drama/provocation.js";
import type { SpokenLine, UnlockLevel } from "../director/drama/provocation.js";
import { pickEscalation } from "../director/drama/escalation.js";
import { SAY_CLEAR_TILES } from "../space/hearing.js";
import type { ActProposal, DramaDecision, DramaDecisionPort, EmotionReading, RelationReading } from "../director/drama/ports.js";
import type { DramaLog, DramaLogEntry, DramaLogKind } from "../director/drama/decision-log.js";
import { plan } from "./plan.js";
import type { BodyExecutor } from "./body-executor.js";
import type { DramaPlanInput, PlanInput, PlannedCommand } from "./types.js";
import { verbMemory } from "./verb-facts.js";
import { pickTile } from "./tiles.js";

type Frame<T extends HotelFrame["t"]> = Extract<HotelFrame, { t: T }>;

/** The runtime's schedule, as far as the dead are concerned: out of the pulses at death, back at the revive, gone for a permadeath (DEATH-2, DEATH-7). */
export interface ActorPool {
  defer(ref: string): void;
  admit(ref: string): void;
  retire(ref: string): void;
}

/** Where the cast's `AgentState` lives (the run's repository); `upsert` replaces a whole state. */
export interface AgentStateStore {
  get(ref: string): Promise<AgentState | null>;
  upsert(state: AgentState): Promise<void>;
}

export type DramaBodyDeps = {
  run: number;
  clock: Clock;
  mirror: ActorSpace;
  executor: Pick<BodyExecutor, "send">;
  /** The drama director's seam (packet P2), read when needed: the run builds its director after the planner side. Absent: the model's `act` has nobody to approve it and nothing is sent. */
  port?: () => DramaDecisionPort | undefined;
  isOwn(ref: string): boolean;
  names(ref: string): string | undefined;
  lang: ActLang;
  pool: ActorPool;
  store?: AgentStateStore;
  /** DEATH-5: a dead actor keeps its place in the pulses and thinks aloud; only ever as a thought, only in cinematic runs (the caller decides). */
  ghostVoice?: boolean;
  hooks: { blocked(agentId: string, reasons: BlockedReason[]): void };
  /**
   * What the cast's talk may do (errata P7): `observer` may hold a grievance against `offender` (both the run's own actors, the scenario lets `observer` target
   * `offender`, drama is not off). Absent: nothing the cast says ever raises a grievance.
   */
  provocation?: { allow(observer: string, offender: string): boolean; tuning?: () => DramaTuning["provocation"] };
  /** The model's next prompt says a refused move is not yet earned (errata P7): called with the reasons worth telling, besides the `blocked` hook that logs them. */
  note?(agentId: string, reasons: BlockedReason[]): void;
  /** The run's decision log (errata P9), read when needed: the run opens it after the body is built. Absent or undefined: nothing is logged. Only ever written to. */
  log?: () => DramaLog | undefined;
  /** Test seam: where the planner's own act ids start. */
  idPrefix?: string;
  /** How long and how often a climb's actor follows a target that keeps moving (`DramaTuning.origination.climb`); absent: the sidecar's default. */
  follow?: { windowMs: number; everyMs: number; gapMs?: number; maxRung?: number };
};

/** How long a witness remembers a blow in front of it as something to put right (a rescuer's window), and how long a landed embrace is a held picture. */
const RESCUE_MS = 8000;
const STAGED_MS = 4000;
/** A proposal that was `too_far` waits this long for its walk before it is dropped. */
const RETRY_MS = 20_000;
/** The plan id prefix of the walks the body makes itself (`approach`), which a follow window never drops. */
const FOLLOW_PLAN_PREFIX = "drama:";
/** The `detail` of the `busy_moving` told to the `blocked` hook for each own walk a follow window did not send. */
const FOLLOW_SUPPRESSED = "follow_suppressed_walk";
/** The `detail`s of a `ladder` refusal the model is told about in its next prompt (`blockedReasonLine` has a line for each); the ceiling (`max_rung`) stays unshown. */
const TOLD_LADDER: ReadonlySet<string> = new Set(["motive", "grievance", "rung", "contagion", "zero_witness"]);
/** The same refusal (actor, verb, target, detail) is noted once, and again only after `NOTE_REPEAT_MS` without one or a blow of the actor's own (errata P9; run 63: 13 proposals refused on the motive, a note for each). */
const NOTE_REPEAT_MAX = 1;
const NOTE_REPEAT_MS = 240_000;
/** How often an actor with heat (a grievance from what was said, or the scene's pressure floor) takes a look at its director when its own model has not been consulted (run 63: the model proposed on every consult and the director was never asked). */
const HEAT_WATCH_MS = 8000;
/** The first look after a hostile line was said at an actor: it answers the provocation before the next consult. */
const HEAT_FIRST_MS = 1500;
const VIOLENT: ReadonlySet<ActVerb> = new Set<ActVerb>(["insult", "shove", "slap", "punch", "kill"]);
const PHYSICAL_VIOLENT: ReadonlySet<ActVerb> = new Set<ActVerb>(["shove", "slap", "punch"]);

type Latest = { agentState: AgentState; actionEmotions?: PlanInput["actionEmotions"]; rng: () => number };

/**
 * Packet P3's integration object, one per run: the `DramaFrameSink` of the planner side (it keeps the `ActLedger` and acts on
 * what the hotel says), and the one place the drama planner is called from. With drama off (no dialect 2 session, or the
 * hotel's switch off) `planFor` is the planner exactly as it was and nothing here touches the wire.
 *
 * What it does: gives the planner the act lock and the room's state; asks the director's port about the model's `act` and
 * the hug and the kiss (NEG-6); schedules the reactions owed to the hotel's debts; takes the dead out of the pulses and
 * brings them back; and writes the memory an act leaves (REA-8, DEATH-4).
 */
export class DramaBody implements DramaFrameSink {
  readonly ledger: ActLedger;
  private readonly reactions: ReactionScheduler;
  private readonly latest = new Map<string, Latest>();
  private readonly beats = new Map<string, { witnesses: string[] }>();
  private readonly rescue = new Map<string, { aggressor: string; victim: string; until: number }>();
  private readonly staged = new Map<string, number>();
  private readonly retry = new Map<string, { proposal: ActProposal; target: string; until: number }>();
  private readonly writes = new Map<string, Promise<void>>();
  /** An actor following the person its next blow is for (issue #262): who, until when, and the timer of its next look. */
  private readonly following = new Map<string, { target: string; until: number; rng: () => number; timer: TimerHandle }>();
  private readonly followCfg: { windowMs: number; everyMs: number; gapMs: number; maxRung: number };
  /** The look a climb's actor takes at its director once the climb's gap is over, one per actor, armed by the actor's own director beat (issue #262). */
  private readonly climbWatch = new Map<string, TimerHandle>();
  /** The look a heated actor takes at its director on a timer of its own (`HEAT_WATCH_MS`), one per actor, armed by its consults and by a hostile line said at it. */
  private readonly heatWatch = new Map<string, TimerHandle>();
  private ids = 0;
  /** The planner's own walks a follow window did not send, since the body was made (issue #262). */
  suppressedWalks = 0;
  /** What the cast's talk did to the cast (errata P7): the grievance each line raised, per ordered pair, decaying. */
  readonly provocation: ProvocationLedger;
  /** Refusals told to the model as a line in its next prompt (`DramaBodyDeps.note`). */
  private actBlockedNotes = 0;
  /** Refusals whose note was left out of the prompt because the same one had been told `NOTE_REPEAT_MAX` times in a row (errata P9). */
  private notesSilenced = 0;
  /** The run of identical refusals told to each actor: `actor|verb|target|detail`, how many in a row and when the last one was. */
  private readonly noteRuns = new Map<string, { n: number; at: number }>();
  /** The highest rung each ordered pair has started in this scene, `actor>target` by ref (errata P8: the spine's slap wants a pair that already shoved). */
  private readonly reached = new Map<string, number>();
  /** What the scene spine opened (errata P8): grants by level, the evaluations that found no evidence, and each grant with when and why, for the run's manifest. */
  private readonly unlocked = { shove: 0, slap: 0, skippedNoEvidence: 0 };
  readonly unlockLog: Array<{ at: number; level: UnlockLevel; observer: string; offender: string; why: string }> = [];

  constructor(private readonly d: DramaBodyDeps) {
    this.provocation = new ProvocationLedger(
      () => d.provocation?.tuning?.() ?? DEFAULT_DRAMA_TUNING.provocation,
      () => d.clock.now(),
      (observer, offender) => d.provocation?.allow(observer, offender) === true,
    );
    const climb = DEFAULT_DRAMA_TUNING.origination.climb;
    this.followCfg = { windowMs: climb.followWindowMs, everyMs: climb.followEveryMs, gapMs: climb.gapMs, maxRung: climb.maxRung, ...d.follow };
    this.ledger = new ActLedger({
      refOf: (id) => d.mirror.refOfAvatar(id),
      near: (ref, radius) => this.near(ref, radius),
      now: () => d.clock.now(),
      hooks: {
        beat: (f, owed) => {
          this.beats.set(f.act_id, { witnesses: f.witnesses.map((w) => d.mirror.refOfAvatar(w)) });
          this.reactions.onBeat(f, owed);
        },
        done: (f) => this.onDone(f),
        dead: (ref, f) => this.onDead(ref, f),
        revived: (ref) => d.pool.admit(ref),
        sceneCut: () => this.reactions.dispose(),
      },
    });
    this.reactions = new ReactionScheduler({
      clock: d.clock,
      ledger: this.ledger,
      isOwn: (ref) => d.isOwn(ref),
      state: (ref) => this.latest.get(ref),
      presence: (ref) => this.presence(ref),
      nextActId: () => this.nextActId(),
      send: (cmds) => d.executor.send(cmds),
    });
  }

  // ---- the planner ------------------------------------------------------------------------------------------------

  /** True when the drama planner is in charge: a dialect 2 session whose switch is on. */
  get active(): boolean {
    return this.ledger.dramaOn();
  }

  /** The executor's `isDead`, `lockOf` and the run's `ghostVoice`, in one place. */
  isDead(ref: string): boolean {
    return this.ledger.isDead(ref);
  }

  /**
   * Plans one actor's body. Drama off: today's planner, untouched. Drama on: the model's `act` and the hug or kiss it asked for become
   * proposals to the director (it decides and sends); an approved or initiated act holds the actor, a `too_far` veto walks it closer and
   * asks again once; everything else is the planner with the act lock and the emotion model.
   */
  planFor(ref: string, base: PlanInput): PlannedCommand[] {
    if (!this.active) return plan(base);
    // ACT-11, DEATH-2: the dead plan nothing; the hotel would answer actor_dead to all of it.
    if (this.ledger.isDead(ref)) return [];
    // A turn that carries no feelings keeps the last ones the actor had: the follow and the climb watch ask the director with them.
    const feelings = base.actionEmotions ?? this.latest.get(ref)?.actionEmotions;
    this.latest.set(ref, { agentState: base.agentState, ...(feelings ? { actionEmotions: feelings } : {}), rng: base.rng });
    const wire = this.d.mirror.avatarId(ref);
    const port = this.d.port?.();
    const now = this.d.clock.now();
    if (wire !== undefined && port?.active && port.busyActId(wire) !== undefined) {
      this.logSkip(ref, base, "busy", "act_busy");
      return [];
    }
    if (this.ledger.lockOf(ref)) {
      this.logSkip(ref, base, "busy", "locked");
      return [];
    }

    // 1. what the model proposed, and what a pair would be.
    const proposals = this.proposalsOf(base);
    const retry = this.retry.get(ref);
    if (retry && retry.until <= now) this.retry.delete(ref);
    const stripped = stripProposals(base.bodyIntent);
    let hold = false;
    const approach: PlannedCommand[] = [];
    if (wire !== undefined && port?.active) {
      const queue = [...proposals];
      const again = this.retry.get(ref);
      if (again && this.adjacent(ref, again.target)) {
        this.retry.delete(ref);
        queue.push(again.proposal);
      }
      for (const proposal of queue) {
        const out = this.decide(ref, wire, proposal, base, { queue: queue.length, hold });
        hold ||= out.hold;
        approach.push(...out.approach);
      }
      // 2. nothing proposed: the emotion state may drive a beat of the director's own. An actor the scene spine has opened a rung for is asked even when its model proposed
      // something the director refused (a glare at someone else, run 62: 79 times): the unlock is for the director to carry out, not for the model to ask for (errata P9).
      // A model that proposes on every consult (run 63: 13 glares refused on the motive, 12 originations never asked) must not leave the director idle: when nothing the model
      // proposed was approved the director is asked as for a passive turn, the same gates and the same pace. Only a proposal that went through (`hold`) keeps it out.
      const ask = queue.length === 0 || this.provocation.unlockOf(ref) !== undefined || DEFAULT_DRAMA_TUNING.origination.askAfterRefusal;
      if (ask && !hold && base.actionEmotions) {
        const out = this.passive(ref, wire, base, port);
        hold = out.hold;
        approach.push(...out.approach);
      } else if (queue.length > 0) {
        // The director is not asked to originate while the model's proposal goes through (or while askAfterRefusal is off): what the log would otherwise not say.
        this.logConsult(ref, "skip", { result: "not_asked", reason: hold ? "held" : "model_proposed" }, { queue: queue.length, hold });
      } else if (!base.actionEmotions) {
        this.logConsult(ref, "skip", { result: "no_emotion", reason: "no_feelings" }, { queue: 0, hold });
      }
    }
    if (!hold && wire !== undefined && port?.active) this.armHeatWatch(ref, HEAT_WATCH_MS);
    if (hold) return [];

    const drama = this.dramaInput(ref, port, wire);
    const input: PlanInput = { ...base, drama };
    if (stripped) input.bodyIntent = stripped;
    else delete input.bodyIntent;
    const cmds = plan(input);
    // 3. a pair the planner would have started is a hug or a kiss the director approves (NEG-6).
    const out: PlannedCommand[] = [...approach];
    for (const c of cmds) {
      if (c.cmd !== "pair") {
        out.push(c);
        continue;
      }
      if (wire === undefined || !port?.active) continue;
      const res = this.decide(ref, wire, { verb: c.kind, with: this.d.mirror.avatarId(c.with) as number, origin: "model" }, base, { queue: 1, hold: false });
      out.push(...res.approach);
    }
    return this.withoutOwnWalks(ref, out);
  }

  /**
   * While a follow window is open for `ref` (issue #262) the walks the planner makes for its own model's turn are not sent: they sent the actor off again
   * between two of the follow's own walks, and a climb never got beside its target. Only a `walk` whose plan id is not the body's own (`drama:`) is dropped,
   * with the commands that wait for its arrival; speech, gestures, faces, postures and every other command stay. Each walk dropped is told to the `blocked` hook
   * as `busy_moving` of the move part with the detail `follow_suppressed_walk` (the executor's own use of that code for a lock, the model reads it as a refused
   * move at its next turn) and counted in `suppressedWalks`. The window's end releases them: a blow, a scene cut, the actor's death or leaving, the timeout.
   */
  private withoutOwnWalks(ref: string, cmds: PlannedCommand[]): PlannedCommand[] {
    const f = this.following.get(ref);
    if (!f || f.until <= this.d.clock.now()) return cmds;
    const dropped = new Set<string>();
    const kept = cmds.filter((c) => {
      if (c.cmd !== "walk" || c.plan?.startsWith(FOLLOW_PLAN_PREFIX)) return true;
      if (c.plan !== undefined) dropped.add(c.plan);
      return false;
    });
    const count = cmds.filter((c) => c.cmd === "walk" && !c.plan?.startsWith(FOLLOW_PLAN_PREFIX)).length;
    if (count === 0) return cmds;
    this.suppressedWalks += count;
    this.d.hooks.blocked(ref, Array.from({ length: count }, () => ({ code: "busy_moving", part: "move", detail: FOLLOW_SUPPRESSED })));
    return kept.filter((c) => c.afterArrival === undefined || !dropped.has(c.afterArrival));
  }

  // ---- DramaFrameSink ----------------------------------------------------------------------------------------------

  onSession(session: DramaSession | null): void {
    this.ledger.onSession(session);
    for (const ref of this.d.mirror.model().agentRoom.keys()) if (this.ledger.isDead(ref) && !this.d.ghostVoice) this.d.pool.defer(ref);
    if (!session) this.reactions.dispose();
  }
  onActStarted(f: Frame<"act_started">): void {
    this.logHotel(f.actor, f.with ?? undefined, f.verb, f.rung ?? undefined, "started");
    // The blow (or any act of its own): the follow has done its job.
    const ref = this.d.mirror.refOfAvatar(f.actor);
    this.stopFollow(ref);
    for (const key of [...this.noteRuns.keys()]) if (key.startsWith(`${ref}|`)) this.noteRuns.delete(key);
    this.noteReached(ref, f);
    this.ledger.onActStarted(f);
    this.armClimbWatch(ref, f);
  }
  onActBeat(f: Frame<"act_beat">): void {
    this.ledger.onActBeat(f);
  }
  onActReaction(f: Frame<"act_reaction">): void {
    this.ledger.onActReaction(f);
  }
  onActDone(f: Frame<"act_done">): void {
    this.logHotel(f.actor, f.with ?? undefined, f.verb, undefined, f.outcome === "blocked" ? `blocked:${f.reason ?? "?"}${f.detail ? `/${f.detail}` : ""}` : `done:${f.outcome}`);
    this.ledger.onActDone(f);
    this.reactions.close(f.act_id);
  }
  onDramaConsent(): void {}
  onActorDeath(f: Frame<"actor_death">): void {
    this.ledger.onActorDeath(f);
  }
  onActorRevive(f: Frame<"actor_revive">): void {
    this.ledger.onActorRevive(f);
  }
  onHumanDown(f: Frame<"human_down">): void {
    this.ledger.onHumanDown(f);
  }
  onHumanUp(f: Frame<"human_up">): void {
    this.ledger.onHumanUp(f);
  }
  onSceneCut(f: Frame<"scene_cut">): void {
    this.ledger.onSceneCut(f);
    // A new scene starts the cast fresh: what was said in the last one is not held against anyone in this one (errata P7).
    this.provocation.clear();
    this.reached.clear();
    this.noteRuns.clear();
    this.stopFollows();
    this.stopClimbWatches();
    this.stopHeatWatches();
    this.retry.clear();
    this.rescue.clear();
  }
  onDramaState(f: Frame<"drama_state">): void {
    this.ledger.onDramaState(f);
  }

  /** The hotel retired an actor (`actor_gone`, a permadeath above all): it does not come back (DEATH-7). */
  actorGone(ref: string): void {
    const wasDead = this.ledger.isDead(ref);
    this.ledger.onGone(ref);
    this.stopFollow(ref);
    this.stopClimbWatch(ref);
    this.stopHeatWatch(ref);
    if (wasDead) this.d.pool.retire(ref);
  }

  /** An avatar left its room: it owes nothing any more (REA-10). */
  left(ref: string): void {
    this.ledger.onGone(ref, false);
    this.stopFollow(ref);
    this.stopClimbWatch(ref);
    this.stopHeatWatch(ref);
  }

  /** Resolves when every memory write started so far has finished. */
  async idle(): Promise<void> {
    await Promise.all([...this.writes.values()]);
  }

  dispose(): void {
    this.stopFollows();
    this.stopClimbWatches();
    this.stopHeatWatches();
    this.reactions.dispose();
  }

  // ---- internals ---------------------------------------------------------------------------------------------------

  private nextActId(): string {
    return `${this.d.idPrefix ?? "p3"}.${(++this.ids).toString(36)}`;
  }

  private presence(ref: string): Presence | undefined {
    const room = this.d.mirror.roomOfRef(ref);
    return this.d.mirror.presenceOf(ref) ?? (room ? this.d.mirror.presenceIn(room, ref) : undefined);
  }

  private near(ref: string, radius: number): string[] {
    const me = this.presence(ref);
    const room = this.d.mirror.roomOfRef(ref);
    if (!me || !room) return [];
    return this.d.mirror.peopleIn(room, this.d.clock.now()).filter((p) => p.ref !== ref && chebyshev(p.tile, me.tile) <= radius).map((p) => p.ref);
  }

  private adjacent(ref: string, other: string): boolean {
    const a = this.presence(ref);
    const b = this.presence(other);
    return a !== undefined && b !== undefined && chebyshev(a.tile, b.tile) <= 1;
  }

  private dramaInput(ref: string, port: DramaDecisionPort | undefined, wire: number | undefined): DramaPlanInput {
    const now = this.d.clock.now();
    const lock = this.ledger.lockOf(ref);
    const busy = wire !== undefined && port?.active ? port.busyActId(wire) : undefined;
    const rescue = this.rescue.get(ref);
    return {
      noReward: this.ledger.noReward(ref),
      fallen: this.ledger.fallenAll(),
      nextActId: () => this.nextActId(),
      ...(lock ? { lock } : {}),
      ...(busy !== undefined ? { busyActId: busy } : {}),
      ...(rescue && rescue.until > now ? { rescue: { aggressor: rescue.aggressor, victim: rescue.victim } } : {}),
      ...((this.staged.get(ref) ?? 0) > now ? { staged: true } : {}),
    };
  }

  /** The model's `act`, and the kiss it asked for as a gesture, as proposals (NEG-6). Targets resolve through the render's handles. */
  private proposalsOf(base: PlanInput): ActProposal[] {
    const b = base.bodyIntent;
    const out: ActProposal[] = [];
    const wireOf = (handle: string | undefined): number | undefined => {
      const t = handle ? base.handles?.[handle] : undefined;
      return t?.kind === "person" ? this.d.mirror.avatarId(t.ref) : undefined;
    };
    if (b?.act) {
      const needs = ACT_TARGET_MODE[b.act.verb] === "required";
      const w = wireOf(b.act.target);
      if (!needs || w !== undefined) out.push({ verb: b.act.verb, ...(needs && w !== undefined ? { with: w } : {}), ...(b.act.intensity !== undefined ? { intensity: b.act.intensity } : {}), origin: "model" });
    }
    if (b?.gesture?.kind === "kiss") {
      const w = wireOf(b.gesture.toward);
      if (w !== undefined) out.push({ verb: "kiss", with: w, origin: "model" });
    }
    return out;
  }

  private emotionOf(ref: string, base: Pick<PlanInput, "agentState" | "actionEmotions">): EmotionReading | undefined {
    if (!base.actionEmotions) return undefined;
    const relations = new Map<number, RelationReading>();
    for (const [other, r] of base.agentState.relationalStates) {
      const id = this.d.mirror.avatarId(other);
      if (id !== undefined) relations.set(id, { resentment: r.resentment, threat: r.threat, envy: r.envy, suspicion: r.suspicion, lastNegativeAt: r.lastNegativeAt, ...this.provoked(ref, other) });
    }
    // Someone it has never dealt with can still have provoked it: the director aims a beat only at someone listed here.
    for (const other of this.provocation.offenders(ref)) {
      const id = this.d.mirror.avatarId(other);
      if (id !== undefined && !relations.has(id)) relations.set(id, { resentment: 0, threat: 0, envy: 0, suspicion: 0, lastNegativeAt: null, ...this.provoked(ref, other) });
    }
    const m = base.agentState.coreMood;
    return { actionEmotions: base.actionEmotions, social: base.agentState.socialEmotions, core: { arousal: m.arousal, momentumArousal: m.momentumArousal }, relations, at: this.d.clock.now() };
  }

  /** The grievance the talk built toward `other`, and the rung the scene spine opened toward them, as the fields the director reads (none when there is none). */
  private provoked(ref: string, other: string): { provocation?: number; unlocked?: number } {
    const level = this.provocation.levelOf(ref, other);
    const rung = this.provocation.unlockedRung(ref, other);
    return { ...(level > 0 ? { provocation: level } : {}), ...(rung !== undefined ? { unlocked: rung } : {}) };
  }

  /** The highest rung `ref` has started at someone in this scene (the frame's own `rung` when it carries one), kept per pair for `escalate`. */
  private noteReached(ref: string, f: Frame<"act_started">): void {
    const rung = f.rung ?? ladderRung(f.verb);
    if (rung === undefined || f.with == null) return;
    const other = this.d.mirror.refOfAvatar(f.with);
    const key = `${ref}>${other}`;
    this.reached.set(key, Math.max(this.reached.get(key) ?? 0, rung));
    // The blow the spine opened has been thrown: the unlock ends with it (one climax per unlock).
    this.provocation.consume(ref, other, rung);
  }

  /**
   * The scene spine asks to open the ladder (errata P8): `level` is `shove` at its turn and `slap` at its decision, `holders` are the actors the spine calls holders.
   * It looks at what the cast has said (`ProvocationLedger.events`): a pair that was heard heating up (`provocation.unlock`) is opened for the person the hostile lines
   * were about toward the person who said them, through `ProvocationLedger.unlock`. No evidence, drama not in charge, a pair the scenario does not let, a human: nothing is
   * opened, and `countSkip` says whether the miss is counted (`spine_unlock_skipped_no_evidence`, once per step the spine reaches, not once per later look). It starts no
   * act: the climb stays the director's, one rung per beat.
   */
  escalate(level: UnlockLevel, holders: readonly string[], countSkip: boolean): "granted" | "refreshed" | "already" | "none" {
    const port = this.d.port?.();
    if (!this.active || !port?.active) return "none";
    const pick = pickEscalation({
      ledger: this.provocation,
      tuning: this.d.provocation?.tuning?.() ?? DEFAULT_DRAMA_TUNING.provocation,
      level,
      holders,
      rungOf: (observer, offender) => this.reached.get(`${observer}>${offender}`) ?? 0,
      now: this.d.clock.now(),
    });
    // The evidence is there but the pair has thrown that rung already: nothing left to open, and not a miss.
    if (pick === "already") return "already";
    const result = pick ? this.provocation.unlock(pick.observer, pick.offender, pick.level) : "skipped";
    if (!pick || result === "skipped") {
      if (countSkip) this.unlocked.skippedNoEvidence++;
      return "none";
    }
    if (result === "granted") this.noteGrant(level, pick.observer, pick.offender, pick.why);
    return result;
  }

  /**
   * Opens `level` for `observer` toward `offender` without reading the evidence (`escalate` does that, then does this): the ledger's unlock, and the count and the manifest line of a grant.
   * For a test that puts a live run's grants back at their seconds. The same refusals as `escalate`: a pair the scenario does not let, a human, drama not in charge.
   */
  grant(observer: string, offender: string, level: UnlockLevel, why: string): "granted" | "refreshed" | "none" {
    const port = this.d.port?.();
    if (!this.active || !port?.active) return "none";
    const result = this.provocation.unlock(observer, offender, level);
    if (result === "skipped") return "none";
    if (result === "granted") this.noteGrant(level, observer, offender, why);
    return result;
  }

  private noteGrant(level: UnlockLevel, observer: string, offender: string, why: string): void {
    this.unlocked[level]++;
    this.unlockLog.push({ at: this.d.clock.now(), level, observer, offender, why });
    // The rung is open for `observer` now: the director is asked at once, as a climb watch's look is, and not at the actor's next turn or the next pulse's sweep (errata P9).
    this.lookAt(observer);
  }

  /** One look at the director for `ref`, now: the plain `decide` of a passive turn with the feelings the actor last planned with. Every gate is the director's; it starts the next rung, says `approach` (the follow opens and the actor walks up) or does nothing. */
  private lookAt(ref: string): void {
    this.stopClimbWatch(ref);
    this.climbWatchTick(ref);
  }

  /** The line the aggressor of an open unlock reads in its next prompt (errata P8), naming who it is aimed at; undefined for an actor with no open unlock. */
  unlockNote(ref: string, language: "pt-BR" | "en"): string | undefined {
    const open = this.provocation.unlockOf(ref);
    if (!open) return undefined;
    const name = this.d.names(open.offender) ?? open.offender;
    return language === "en"
      ? `You have had enough: if "${name}" provokes you again, go for them.`
      : `Você não aguenta mais: se "${name}" provocar de novo, parta pra cima.`;
  }

  /**
   * A line the cast spoke (errata P7): who it was about, who heard it, and what it does to them (`ProvocationLedger`). The run calls it for every committed
   * line of its own actors; nothing happens when drama is not in charge, which is also what keeps `drama: off` inert. The listeners are the run's actors in
   * the speaker's room: heard clearly within the say radius (a shout carries to the room), otherwise in the room but not told.
   */
  noteSpoken(line: SpokenLine): void {
    const port = this.d.port?.();
    if (!this.active || !port?.active || !this.d.isOwn(line.speaker)) return;
    const room = this.d.mirror.roomOfRef(line.speaker);
    const me = this.presence(line.speaker);
    if (!room || !me) return;
    const listeners = this.d.mirror
      .peopleIn(room, this.d.clock.now())
      .filter((p) => p.ref !== line.speaker && this.d.isOwn(p.ref))
      .map((p) => ({ ref: p.ref, heard: chebyshev(p.tile, me.tile) <= SAY_CLEAR_TILES }));
    const before = this.provocation.total;
    this.provocation.note(line, listeners);
    // The ones the line was about answer it soon, not at their next consult.
    if (this.provocation.total > before) for (const who of new Set([...line.mentioned, ...line.addressees])) if (who !== line.speaker && this.d.isOwn(who) && this.provocation.offenders(who).length > 0) this.armHeatWatch(who, HEAT_FIRST_MS);
  }

  /** The run summary's flat counters for what this body did on its own: grievance raised from talk, and the refusals it told the model about. */
  counters(): Record<string, number> {
    const p = this.provocation;
    const all: Record<string, number> = {
      grievance_raised: p.total,
      grievance_skipped: p.skipped,
      grievance_reported: p.reportedRaised,
      grievance_reported_ignored: p.reportedIgnored,
      act_blocked_notes: this.actBlockedNotes,
      act_blocked_notes_silenced: this.notesSilenced,
      spine_unlock_shove: this.unlocked.shove,
      spine_unlock_slap: this.unlocked.slap,
      spine_unlock_skipped_no_evidence: this.unlocked.skippedNoEvidence,
    };
    for (const [k, n] of Object.entries(p.raised)) all[`grievance_${k}`] = n;
    return Object.fromEntries(Object.entries(all).filter(([, n]) => n > 0));
  }

  private decide(ref: string, wire: number, proposal: ActProposal, base: PlanInput, ctx: { queue: number; hold: boolean }): { hold: boolean; approach: PlannedCommand[] } {
    const port = this.d.port?.();
    if (!port) return { hold: false, approach: [] };
    const emotion = this.emotionOf(ref, base);
    const res: DramaDecision = port.decide({ actor: wire, proposal, ...(emotion ? { emotion } : {}) });
    this.logDecision(ref, port, undefined, { queue: ctx.queue, hold: ctx.hold || res.kind === "approve" || res.kind === "initiate" });
    switch (res.kind) {
      case "approve":
      case "initiate":
        return { hold: true, approach: [] };
      case "veto": {
        if (res.reason === "too_far" && proposal.with !== undefined) return { hold: false, approach: this.walkCloser(ref, proposal, base) };
        const targetRef = proposal.with === undefined ? undefined : this.d.mirror.refOfAvatar(proposal.with);
        const reason: BlockedReason = { code: res.reason, part: "act", ...(res.detail ? { detail: res.detail } : {}), verb: proposal.verb, ...(targetRef ? { target: targetRef } : {}) };
        this.d.hooks.blocked(ref, [reason]);
        // An act the ladder refused for want of a motive or a grievance, one rung too many, a witness or a calmer room is not yet earned: the model is told so in its
        // next prompt, with the name it aimed at and what would earn it (errata P7, P8).
        if (res.reason === "ladder" && res.detail !== undefined && TOLD_LADDER.has(res.detail) && targetRef !== undefined && this.d.note) {
          // The same refusal told again and again changes nothing (run 62: 79 refused glares, 80 notes, no uptake): after `NOTE_REPEAT_MAX` of them in a row (each within
          // `NOTE_REPEAT_MS` of the one before) the note is left out of the prompt. The refusal is still logged; a quiet `NOTE_REPEAT_MS` or a blow of the actor's own starts the count over.
          if (this.noteAgain(ref, proposal.verb, targetRef, res.detail)) {
            this.d.note(ref, [{ ...reason, ref: this.d.names(targetRef) ?? targetRef }]);
            this.actBlockedNotes++;
          } else this.notesSilenced++;
        }
        return { hold: false, approach: [] };
      }
      case "pass":
      case "unsent":
        return { hold: false, approach: [] };
      default: {
        const unhandled: never = res;
        return unhandled;
      }
    }
  }

  /** GATE-7: a contact verb needs the two beside each other; walk up, then ask again once (the executor's own arrival releases nothing here, the next plan does). */
  private walkCloser(ref: string, proposal: ActProposal, base: PlanInput): PlannedCommand[] {
    const targetRef = proposal.with === undefined ? undefined : this.d.mirror.refOfAvatar(proposal.with);
    if (!targetRef || !this.presence(targetRef) || !base.space.room) return [];
    this.retry.set(ref, { proposal, target: targetRef, until: this.d.clock.now() + RETRY_MS });
    return this.approach(ref, targetRef, base.space.room, base.rng);
  }

  /** The walk of a passive actor up to the person its next blow is for. */
  private approachTo(ref: string, wire: number, base: PlanInput): PlannedCommand[] {
    const targetRef = this.d.mirror.refOfAvatar(wire);
    return targetRef ? this.approach(ref, targetRef, base.space.room, base.rng) : [];
  }

  /**
   * The walk that puts `ref` on a free tile beside `targetRef`: the one `walkCloser` makes for the model's `too_far` act, the one `passive` makes
   * toward the person the director's next blow is for, and the one the `BeatPlayer` makes for an authored beat's (habbo#41). Empty when either is
   * not placed or no tile beside the target is free. Sends nothing.
   */
  approach(ref: string, targetRef: string, room: RoomView | undefined, rng: () => number): PlannedCommand[] {
    const target = this.presence(targetRef);
    if (!target || !room) return [];
    const to = pickTile({ room, self: ref, near: target.tile, radius: 1, awayFrom: { tile: target.tile, ideal: 1 }, rng });
    return to ? [{ agentId: ref, cmd: "walk", to, plan: `drama:${ref}:${this.d.clock.now().toString(36)}` }] : [];
  }

  /**
   * No proposal: let the director start a beat from the emotion state, if it has one (it keeps its own pace). When it would start the next blow of a
   * climb but the two are not beside each other (GATE-7), it says whom to walk to: the actor walks up and the next turn starts the blow. Nothing is
   * retried: the beat is the director's own and is decided again from the feelings then, not replayed as the model's proposal.
   */
  private passive(ref: string, wire: number, base: PlanInput, port: DramaDecisionPort): { hold: boolean; approach: PlannedCommand[] } {
    const emotion = this.emotionOf(ref, base);
    if (!emotion) return { hold: false, approach: [] };
    const res = port.decide({ actor: wire, emotion });
    this.logDecision(ref, port, undefined, { queue: 0, hold: res.kind === "initiate" });
    if (res.kind === "initiate") return { hold: true, approach: [] };
    if (res.kind === "pass" && res.approach !== undefined) {
      this.startFollow(ref, res.approach, base.rng);
      return { hold: false, approach: this.approachTo(ref, res.approach, base) };
    }
    return { hold: false, approach: [] };
  }

  /** True while this refusal is still worth a line in the actor's prompt: counts it, and starts the count over after `NOTE_REPEAT_MS` without one. */
  private noteAgain(ref: string, verb: ActVerb, target: string, detail: string): boolean {
    const now = this.d.clock.now();
    const key = `${ref}|${verb}|${target}|${detail}`;
    const run = this.noteRuns.get(key);
    const n = run !== undefined && now - run.at <= NOTE_REPEAT_MS ? run.n + 1 : 1;
    this.noteRuns.set(key, { n, at: now });
    return n <= NOTE_REPEAT_MAX;
  }

  // ---- the decision log (errata P9) --------------------------------------------------------------------------------

  /** One line of the log for `ref`, with the unlock the actor holds right now. Writes nothing when the run keeps no log. */
  private logConsult(ref: string, kind: DramaLogKind, over: Pick<DramaLogEntry, "result"> & Partial<Omit<DramaLogEntry, "actor" | "kind" | "queue" | "hold">>, ctx: { queue: number; hold: boolean }): void {
    const log = this.d.log?.();
    if (!log) return;
    const open = this.provocation.unlockOf(ref);
    // A line that is not about a person says the unlock the actor holds as its pair (a skip: nobody was looked at); one that is about someone says that person's.
    const about = over.pair === undefined && open !== undefined;
    log.record({ ...over, ...(open ? { unlock: `${ref}>${open.offender}@${open.rung}` } : {}), ...(about ? { pair: `${ref}>${open.offender}`, unlocked: open.rung } : { unlocked: over.unlocked ?? 0 }), actor: ref, kind, queue: ctx.queue, hold: ctx.hold });
  }

  /** The director's own account of its last `decide` as a log line; `kind` overrides it for the timers' looks (`continue`). */
  private logDecision(ref: string, port: DramaDecisionPort, kind: DramaLogKind | undefined, ctx: { queue: number; hold: boolean }): void {
    if (!this.d.log?.()) return;
    const t = port.trace?.();
    if (!t) return;
    const { actor: _actor, kind: traced, ...rest } = t;
    this.logConsult(ref, kind ?? traced, rest, ctx);
  }

  /** What the hotel said of an act of an own actor: it began, it ended (and how), or it refused it (`blocked:<reason>/<detail>`, the answer the director's own gates did not foresee). */
  private logHotel(actor: number, target: number | undefined, verb: ActVerb, rung: number | undefined, result: string): void {
    if (!this.d.log?.()) return;
    const ref = this.d.mirror.refOfAvatar(actor);
    if (!this.d.isOwn(ref)) return;
    const other = target === undefined ? undefined : this.d.mirror.refOfAvatar(target);
    const r = rung ?? ladderRung(verb);
    this.logConsult(ref, "hotel", { result, verb, ...(r !== undefined ? { rung: r } : {}), ...(other ? { pair: `${ref}>${other}`, unlocked: this.provocation.unlockedRung(ref, other) ?? 0 } : {}) }, { queue: 0, hold: false });
  }

  /** A consult the body ended itself, before asking the director anything (the actor holds an act or a lock): `queue` is what the model proposed meanwhile. */
  private logSkip(ref: string, base: PlanInput, result: string, reason: string): void {
    if (!this.d.log?.()) return;
    this.logConsult(ref, "skip", { result, reason }, { queue: this.proposalsOf(base).length, hold: true });
  }

  // ---- following a target that keeps moving (issue #262) ------------------------------------------------------------

  /**
   * The director said the next blow of a climb is motivated and only the distance is missing. A model that is consulted every ~20 s sees a target that has walked
   * off again by the time the walk ends, so the actor keeps after it for `follow.windowMs` (`DramaTuning.origination.climb`): see `followTick`. A window already open
   * for the same person is kept as it is, never extended; the next `approach` after it ends opens a new one.
   */
  private startFollow(ref: string, wire: number, rng: () => number): void {
    const { windowMs, everyMs } = this.followCfg;
    const target = this.d.mirror.refOfAvatar(wire);
    const now = this.d.clock.now();
    if (!target || windowMs <= 0 || everyMs <= 0) return;
    const open = this.following.get(ref);
    if (open && open.target === target && open.until > now) {
      open.rng = rng;
      return;
    }
    this.stopFollow(ref);
    const f = { target, until: now + windowMs, rng, timer: this.d.clock.setTimer(() => this.followTick(ref, everyMs), everyMs) };
    this.following.set(ref, f);
  }

  /**
   * One look of a follow, off the actor's own timer: the window over, the actor dead, locked or busy, or the scene cut, and the follow ends. Beside the target, the
   * director is asked as a passive turn asks it (no proposal, the feelings the actor last planned with, `at` now), and every gate applies: it starts the blow when the
   * two are still and the pace and the ladder allow it, and otherwise nothing happens until the next look. Apart, the actor is walked beside the target again unless it is
   * already heading for a tile beside it.
   */
  private followTick(ref: string, everyMs: number): void {
    const f = this.following.get(ref);
    if (!f) return;
    const now = this.d.clock.now();
    const wire = this.d.mirror.avatarId(ref);
    const port = this.d.port?.();
    const target = this.presence(f.target);
    if (now >= f.until || !this.active || !port?.active || wire === undefined || !target || this.ledger.isDead(ref) || this.ledger.lockOf(ref) || port.busyActId(wire) !== undefined) {
      this.stopFollow(ref);
      return;
    }
    if (this.adjacent(ref, f.target)) {
      const seen = this.latest.get(ref);
      const emotion = seen ? this.emotionOf(ref, seen) : undefined;
      const res = emotion ? port.decide({ actor: wire, emotion }) : undefined;
      if (emotion) this.logDecision(ref, port, "continue", { queue: 0, hold: res?.kind === "initiate" });
      if (res?.kind === "initiate") {
        this.stopFollow(ref);
        return;
      }
    } else {
      const me = this.presence(ref);
      const heading = me?.state === "walk" && me.walkGoal !== undefined && chebyshev(me.walkGoal, target.tile) <= 1;
      const room = this.d.mirror.view(ref, now)?.room;
      if (!heading) {
        const cmds = this.approach(ref, f.target, room, f.rng);
        if (cmds.length > 0) this.d.executor.send(cmds);
      }
    }
    f.timer = this.d.clock.setTimer(() => this.followTick(ref, everyMs), everyMs);
  }

  /**
   * The director's own beat of a climb (a rung of the ladder below the climb's ceiling) started for an own actor: once the climb's `gapMs` is over the actor takes
   * one look at its director, the plain `decide` of a passive turn with the feelings it last planned with, instead of waiting for its own model's next committed turn
   * (a turn every ~20 s live, and a follow that only began at the turn after). Everything is the director's: the pace, the ladder, the gates and the budget decide
   * whether that look starts the next beat, says `approach` (the follow opens and the actor walks up) or does nothing; the body adds no way past any of them and no port.
   * One look per beat; a window already open, a lock, a busy act, a dead actor or a cut scene cancel it.
   */
  private armClimbWatch(ref: string, f: Frame<"act_started">): void {
    this.stopClimbWatch(ref);
    const { windowMs, gapMs, maxRung } = this.followCfg;
    const rung = f.rung ?? 0;
    if (windowMs <= 0 || f.origin !== "director" || rung < 1 || rung >= maxRung || !this.d.isOwn(ref)) return;
    this.climbWatch.set(ref, this.d.clock.setTimer(() => this.climbWatchTick(ref), gapMs));
  }

  private climbWatchTick(ref: string): void {
    this.climbWatch.delete(ref);
    const now = this.d.clock.now();
    const wire = this.d.mirror.avatarId(ref);
    const port = this.d.port?.();
    const seen = this.latest.get(ref);
    const emotion = seen ? this.emotionOf(ref, seen) : undefined;
    if (!seen || !emotion || wire === undefined || !port?.active || !this.active || this.ledger.isDead(ref) || this.ledger.lockOf(ref) || port.busyActId(wire) !== undefined) return;
    if ((this.following.get(ref)?.until ?? 0) > now) return;
    const res = port.decide({ actor: wire, emotion });
    this.logDecision(ref, port, "continue", { queue: 0, hold: res.kind === "initiate" });
    if (res.kind !== "pass" || res.approach === undefined) return;
    this.startFollow(ref, res.approach, seen.rng);
    const target = this.d.mirror.refOfAvatar(res.approach);
    const cmds = target ? this.approach(ref, target, this.d.mirror.view(ref, now)?.room, seen.rng) : [];
    if (cmds.length > 0) this.d.executor.send(cmds);
  }

  /** Arms the heated actor's look at its director in `inMs` unless one is already armed (an earlier one is kept, a later one is not pushed back). */
  private armHeatWatch(ref: string, inMs: number): void {
    if (this.heatWatch.has(ref) || !this.d.isOwn(ref)) return;
    this.heatWatch.set(ref, this.d.clock.setTimer(() => this.heatTick(ref), inMs));
  }

  /** Whether the actor has something the director could act on: a grievance from what was said or an open unlock, or the scene's pressure floor is up. */
  private heated(ref: string, port: DramaDecisionPort): boolean {
    return this.provocation.offenders(ref).length > 0 || (port.pressure?.() ?? 0) > 0;
  }

  /**
   * One look of a heat watch, off the actor's own timer: the plain `decide` of a passive turn with the feelings the actor last planned with, so a model that proposes on every
   * consult or is slow to answer (9 timeouts in run 63) does not leave a heated actor unlooked at. Every gate and the pace are the director's. A busy, locked or dead actor is
   * not asked; the watch goes on while the actor is heated and stops when it is not (the next consult arms it again).
   */
  private heatTick(ref: string): void {
    this.heatWatch.delete(ref);
    const wire = this.d.mirror.avatarId(ref);
    const port = this.d.port?.();
    if (!this.active || !port?.active || wire === undefined || this.ledger.isDead(ref) || !this.heated(ref, port)) return;
    const now = this.d.clock.now();
    const seen = this.latest.get(ref);
    const emotion = seen ? this.emotionOf(ref, seen) : undefined;
    const idle = !this.ledger.lockOf(ref) && port.busyActId(wire) === undefined && (this.following.get(ref)?.until ?? 0) <= now;
    if (seen && emotion && idle) {
      const res = port.decide({ actor: wire, emotion });
      if (res.kind !== "pass" || res.approach !== undefined) this.logDecision(ref, port, "continue", { queue: 0, hold: res.kind === "initiate" });
      if (res.kind === "pass" && res.approach !== undefined) {
        this.startFollow(ref, res.approach, seen.rng);
        const target = this.d.mirror.refOfAvatar(res.approach);
        const cmds = target ? this.approach(ref, target, this.d.mirror.view(ref, now)?.room, seen.rng) : [];
        if (cmds.length > 0) this.d.executor.send(cmds);
      }
    }
    this.armHeatWatch(ref, HEAT_WATCH_MS);
  }

  private stopHeatWatch(ref: string): void {
    this.heatWatch.get(ref)?.cancel();
    this.heatWatch.delete(ref);
  }

  private stopHeatWatches(): void {
    for (const ref of [...this.heatWatch.keys()]) this.stopHeatWatch(ref);
  }

  private stopClimbWatch(ref: string): void {
    this.climbWatch.get(ref)?.cancel();
    this.climbWatch.delete(ref);
  }

  private stopClimbWatches(): void {
    for (const ref of [...this.climbWatch.keys()]) this.stopClimbWatch(ref);
  }

  private stopFollow(ref: string): void {
    this.following.get(ref)?.timer.cancel();
    this.following.delete(ref);
  }

  private stopFollows(): void {
    for (const ref of [...this.following.keys()]) this.stopFollow(ref);
  }

  // ---- what an act leaves behind -------------------------------------------------------------------------------------

  private onDead(ref: string, f: Frame<"actor_death"> | undefined): void {
    this.stopFollow(ref);
    this.stopClimbWatch(ref);
    this.stopHeatWatch(ref);
    if (this.d.isOwn(ref) && !this.d.ghostVoice) this.d.pool.defer(ref);
    if (!f) return;
    const witnesses = (this.beats.get(f.act_id)?.witnesses ?? []).filter((w) => w !== ref);
    const killer = f.killer != null ? this.d.mirror.refOfAvatar(f.killer) : undefined;
    const facts = { actId: f.act_id, victim: ref, ...(killer ? { killer } : {}), cause: f.cause, witnesses, names: this.nameMap([ref, ...(killer ? [killer] : []), ...witnesses]), lang: this.d.lang } as const;
    const involved = new Set([ref, ...(killer ? [killer] : []), ...witnesses]);
    for (const who of involved) if (this.d.isOwn(who)) this.write(who, (s, now) => rememberDeath(s, facts, now));
  }

  private onDone(f: Frame<"act_done">): void {
    const beat = this.beats.get(f.act_id);
    this.beats.delete(f.act_id);
    if (f.outcome !== "landed" && f.outcome !== "dodged" && f.outcome !== "declined") return;
    const actor = this.d.mirror.refOfAvatar(f.actor);
    const target = f.with != null ? this.d.mirror.refOfAvatar(f.with) : undefined;
    const witnesses = (beat?.witnesses ?? []).filter((w) => w !== actor && w !== target);
    const memory = verbMemory(f.verb);
    const facts: ActFacts = { actId: f.act_id, verb: f.verb, actor, ...(target ? { target } : {}), witnesses, names: this.nameMap([actor, ...(target ? [target] : []), ...witnesses]), lang: this.d.lang };
    if (f.outcome === "landed") {
      if (this.d.isOwn(actor)) this.write(actor, (s, now) => rememberAct(s, facts, "actor", memory.actor, now));
      if (target && this.d.isOwn(target)) this.write(target, (s, now) => rememberAct(s, facts, "target", memory.target, now));
      for (const w of witnesses) if (this.d.isOwn(w)) this.write(w, (s, now) => rememberAct(s, facts, "witness", memory.witnesses, now));
      this.afterLanded(f.verb, actor, target, witnesses);
    } else if (VIOLENT.has(f.verb) && this.d.isOwn(actor)) {
      // REA-8: a dodged or declined violent act leaves the aggressor an aggressor and the target nothing.
      this.write(actor, (s, now) => rememberAct(s, facts, "actor", memory.actor, now));
    }
  }

  /** Who is moved to step in, and who holds a picture, once a blow or an embrace has landed (bible 3.3). */
  private afterLanded(verb: ActVerb, actor: string, target: string | undefined, witnesses: string[]): void {
    const now = this.d.clock.now();
    if (PHYSICAL_VIOLENT.has(verb) && target) for (const w of witnesses) this.rescue.set(w, { aggressor: actor, victim: target, until: now + RESCUE_MS });
    if (verb === "hug" || verb === "kiss" || verb === "restrain") this.staged.set(actor, now + STAGED_MS);
  }

  private nameMap(refs: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of refs) {
      const n = this.d.names(r);
      if (n) out[r] = n;
    }
    return out;
  }

  /** One read-modify-write per actor at a time, so two frames about the same actor never overwrite each other's memory. */
  private write(ref: string, fn: (s: AgentState, now: number) => AgentState): void {
    const store = this.d.store;
    if (!store) return;
    const prev = this.writes.get(ref) ?? Promise.resolve();
    const next = prev.then(async () => {
      const state = await store.get(ref);
      if (!state) return;
      const out = fn(state, Math.max(state.updatedAt, ...state.memories.map((m) => m.lastReinforcedAt)));
      if (out !== state) await store.upsert(out);
    }).catch(() => undefined);
    this.writes.set(ref, next);
  }
}

/** The body block without the parts the director now owns: the `act`, and a kiss gesture (a hug or kiss is an act, NEG-6). */
function stripProposals(b: BodyIntent | undefined): BodyIntent | undefined {
  if (!b) return undefined;
  const rest = { ...b };
  delete rest.act;
  if (rest.gesture?.kind === "kiss") delete rest.gesture;
  return rest;
}
