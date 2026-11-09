import type { ActVerb } from "@perfectman/shared";
import { ladderRung } from "@perfectman/shared";
import type { RunDrama } from "../../authoring/scenario-drama.js";
import type { Clock } from "../../clock/clock.js";
import type { DramaFrameSink } from "../../run/drama-frame-sink.js";
import type { Logger } from "../../util/log.js";
import { silentLogger } from "../../util/log.js";
import { validateActCmd } from "../act-cmd.js";
import type { ActSend } from "../director-client.js";
import type { Dialect, DramaSession } from "../dialect.js";
import type { ActorCmd, HotelFrame } from "../index.js";
import { VOCAB_CONSTANTS } from "../verb-vocab.generated.js";
import { reviewGates } from "./gates.js";
import type { GateAvatar } from "./gates.js";
import { ActLedger } from "./ledger.js";
import type { Assumed } from "./ledger.js";
import type { ActLifecycleFrame, ActProposal, DramaApproval, DramaDecision, DramaDecisionPort, DramaTurn, DramaVeto, EmotionReading, SceneAdvance } from "./ports.js";
import { intensityOf, motive, volition } from "./pressure.js";
import { DEFAULT_DRAMA_TUNING, LIMITS } from "./tuning.js";
import type { DramaTuning } from "./tuning.js";
import type { DramaWorld } from "./world.js";

type Frame<T extends HotelFrame["t"]> = Extract<HotelFrame, { t: T }>;
type ActCmd = Extract<ActorCmd, { k: "act" }>;

/** What the director needs of the Director connection: the dialect, and the two frames it sends. `DirectorClient` is one. */
export interface DramaLink {
  readonly dialect: Dialect;
  sendAct(p: { run: number; actor: number; cmd: ActCmd }): ActSend;
  sendSceneAdvance(run: number, reason?: string): ActSend;
}

export type DramaDirectorDeps = {
  run: number;
  clock: Clock;
  link: DramaLink;
  world: DramaWorld;
  scenario: RunDrama;
  tuning?: DramaTuning;
  logger?: Logger;
  /** The session of the link as the last `hello` said (the hub passes it on attach). */
  session?: DramaSession | null;
  /** The run's body frame log, so the replay filter has an `act` to drop (REPLAY-1). */
  record?: (dir: "in" | "out", room: string | undefined, kind: string, data: Record<string, unknown>) => void;
  /** A director that is rebuilt from nothing (NEG-9): it acts only after the first `drama_state`, which also gives it its scene. */
  resumed?: boolean;
};

type RoomDrama = { enabled: boolean; calm: boolean; paused: boolean; optIn: ReadonlySet<number> };

/** The verbs whose `actor_posture` in the verb table includes `lay`. */
const LAY_OK: ReadonlySet<ActVerb> = new Set<ActVerb>(["die", "cry", "tableau"]);

type Assessed = { ok: true; rung: number | undefined; skippedRungs: ActVerb[] } | { ok: false; veto: DramaVeto };

/** `d1`, `d2`, ...: unique within a run (ACT-5) and inside the `act_id` pattern. A retry always takes a new one. */
export function makeActIds(prefix = "d"): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

const OPEN_ROOM: RoomDrama = { enabled: true, calm: false, paused: false, optIn: new Set() };

/**
 * The drama director of one run (packet P2). It is two things at once: the `DramaDecisionPort` the planner asks (HYBRID:
 * the model's `act` is approved or vetoed here, and a passive model may be given a beat), and the `DramaFrameSink` the
 * frame router feeds, from which it keeps its copy of the hotel's counters (`ActLedger`), the dead, and each room's calm,
 * pause, switch and opt-in. It sends `act` and `scene_advance`; the hotel stays authoritative (a refusal there is an
 * `act_done{blocked}`, which undoes the reservation here).
 */
export class DramaDirector implements DramaDecisionPort, DramaFrameSink {
  private readonly tuning: DramaTuning;
  private readonly log: Logger;
  private readonly ledger: ActLedger;
  private readonly rooms = new Map<number, RoomDrama>();
  private fallen = new Set<number>();
  /**
   * Faints in flight: a faint has no stand-up frame (P2-10), so the faint's own frames say who is on the floor: from its contact (`act_beat`) to its
   * `act_done`, which the hotel sends once the actor stood up. A scene cut ends them all (SCENE-3).
   */
  private readonly faints = new Map<string, { actor: number; down: boolean }>();
  private session: DramaSession | null;
  private ready: boolean;
  private resumedAdopt: boolean;
  private readonly nextId = makeActIds();
  private advancePending: number | undefined;
  private readonly offered = new Map<number, number>();
  /** When each actor last started each verb (`<actor>|<verb>`), for the repeat window of `DramaTuning.repeatMs`. */
  private readonly startedAt = new Map<string, number>();

  constructor(private readonly d: DramaDirectorDeps) {
    this.tuning = d.tuning ?? DEFAULT_DRAMA_TUNING;
    this.log = d.logger ?? silentLogger;
    this.session = d.session ?? null;
    this.ledger = new ActLedger(`${d.run}.1`, d.clock.now());
    this.ready = !d.resumed;
    this.resumedAdopt = d.resumed === true;
    this.applySession();
  }

  // ---- the port ---------------------------------------------------------------------------------------------

  get active(): boolean {
    return this.d.link.dialect === 2 && this.session !== null && this.ready;
  }

  get scene(): string {
    return this.ledger.sceneId;
  }

  busyActId(actor: number): string | undefined {
    return this.ledger.busyActId(actor);
  }

  feed(frame: ActLifecycleFrame): void {
    switch (frame.t) {
      case "act_started":
        return this.onActStarted(frame);
      case "act_beat":
        return this.onActBeat(frame);
      case "act_done":
        return this.onActDone(frame);
      default: {
        const unhandled: never = frame;
        return unhandled;
      }
    }
  }

  decide(turn: DramaTurn): DramaDecision {
    if (!this.active) return { kind: "pass", why: "inert" };
    if (this.isFallen(turn.actor)) return { kind: "pass", why: "actor_dead" };
    if (this.ledger.busyActId(turn.actor) !== undefined) return { kind: "pass", why: "actor_busy" };
    return turn.proposal ? this.propose(turn, turn.proposal) : this.originate(turn);
  }

  /** SCENE-2: the sidecar's script advanced. The only way a scene is cut. SCENE-5: not before the scene is `scene_min_age_ms` old. SCENE-4: not while a cut is awaited. */
  advanceScene(reason: string): SceneAdvance {
    if (!this.active) return { kind: "refused", why: "inert" };
    const now = this.d.clock.now();
    if (this.advancePending !== undefined && now - this.advancePending < this.tuning.sceneAdvancePendingMs) return { kind: "refused", why: "pending", retryInMs: this.tuning.sceneAdvancePendingMs - (now - this.advancePending) };
    const age = now - this.ledger.sceneSince;
    if (age < LIMITS.sceneMinAgeMs) return { kind: "refused", why: "too_young", retryInMs: LIMITS.sceneMinAgeMs - age };
    const sent = this.d.link.sendSceneAdvance(this.d.run, reason);
    if (!sent.sent) return { kind: "refused", why: "unsent" };
    this.advancePending = now;
    this.d.record?.("out", undefined, "scene_advance", { reason: reason.slice(0, 40) });
    return { kind: "sent" };
  }

  // ---- HYBRID: a proposal ------------------------------------------------------------------------------------

  private propose(turn: DramaTurn, p: ActProposal): DramaDecision {
    const wire = this.wireOf(turn.actor, p.verb, p.with, p.origin, p.intensity, p.text, p.authoredSkip === true);
    const bad = this.precheck(turn.actor, p) ?? validateActCmd(wire, { run: this.d.run, actor: turn.actor }, new Set());
    if (bad) return { kind: "unsent", cause: "invalid", error: bad };
    if (p.origin !== "scenario" && this.repeating(turn.actor, p.verb)) return { kind: "pass", why: "pace" };
    // RES-1: a `restrain` needs an aggressor, someone who has used a rung in this scene.
    if (p.verb === "restrain" && p.with !== undefined && this.ledger.rungOfActor(p.with) === 0) return { kind: "pass", why: "no_drive" };
    const assessed = this.assess(turn.actor, p.verb, p.with, p.origin, p.authoredSkip === true, turn.emotion);
    if ("pass" in assessed) return assessed.pass;
    if (!assessed.ok) return assessed.veto;
    return this.dispatch("approve", turn.actor, wire, assessed.rung, assessed.skippedRungs, undefined);
  }

  /** ACT-9 as far as the sidecar knows it: `restrain` never at a human, `tend_fallen` only at a fallen avatar. */
  private precheck(actor: number, p: ActProposal): { code: "bad_target"; detail: string } | undefined {
    if (p.verb === "restrain" && p.with !== undefined && p.with > 0) return { code: "bad_target", detail: "kind" };
    if (p.verb === "tend_fallen" && p.with !== undefined && !this.isFallen(p.with)) return { code: "bad_target", detail: "not_fallen" };
    return actor === p.with ? { code: "bad_target", detail: "self" } : undefined;
  }

  // ---- initiative: the model is passive ------------------------------------------------------------------------

  private originate(turn: DramaTurn): DramaDecision {
    const emotion = turn.emotion;
    if (!emotion || !this.roomState(turn.actor).enabled) return { kind: "pass", why: "no_drive" };
    const now = this.d.clock.now();
    const last = this.offered.get(turn.actor);
    if (last !== undefined && now - last < this.tuning.origination.minGapMs) return { kind: "pass", why: "pace" };
    const room = this.d.world.roomOf(turn.actor);
    if (room === undefined) return { kind: "pass", why: "not_placed" };

    type Pick = { verb: ActVerb; target: number; margin: number; v: number; theta: number; rung: number };
    let best: Pick | undefined;
    for (const other of this.d.world.avatarsIn(room)) {
      if (other.id === turn.actor || other.id === this.narrator() || this.isFallen(other.id)) continue;
      // The reading names who the actor has a relationship with: those are the only people a beat can be aimed at.
      if (!emotion.relations?.has(other.id)) continue;
      for (const verb of this.tuning.origination.verbs) {
        if (this.repeating(turn.actor, verb)) continue;
        const m = motive(verb, emotion, emotion.relations?.get(other.id), emotion.at ?? now, this.tuning);
        if (!m.ok) continue;
        const off = ladderRung(verb) === undefined;
        const theta = off ? this.tuning.origination.offLadderTheta : m.theta;
        const v = off ? volition(verb, emotion, emotion.relations?.get(other.id), this.tuning) : m.v;
        if (v < theta) continue;
        const a = this.assess(turn.actor, verb, other.id, "director", false, emotion);
        if ("pass" in a || !a.ok) continue;
        const pick: Pick = { verb, target: other.id, margin: v - theta, v, theta, rung: ladderRung(verb) ?? 0 };
        if (!best || pick.margin > best.margin || (pick.margin === best.margin && (pick.rung < best.rung || (pick.rung === best.rung && pick.target < best.target)))) best = pick;
      }
    }
    if (!best) return { kind: "pass", why: "no_drive" };
    const wire = this.wireOf(turn.actor, best.verb, best.target, "director", intensityOf(emotion), undefined, false);
    const a = this.assess(turn.actor, best.verb, best.target, "director", false, emotion);
    if ("pass" in a || !a.ok) return { kind: "pass", why: "no_drive" };
    const out = this.dispatch("initiate", turn.actor, wire, a.rung, a.skippedRungs, { v: best.v, theta: best.theta });
    if (out.kind === "initiate") this.offered.set(turn.actor, now);
    return out;
  }

  // ---- the review: hotel gates first, then the director's own policy ------------------------------------------

  private assess(actor: number, verb: ActVerb, target: number | undefined, origin: ActProposal["origin"] | "director", authoredSkip: boolean, emotion: EmotionReading | undefined): Assessed | { pass: DramaDecision } {
    const room = this.d.world.roomOf(actor);
    if (room === undefined) return { pass: { kind: "pass", why: "not_placed" } };
    const present = this.d.world.avatarsIn(room);
    // ACT-13: a lying actor can only do the verbs that are done lying down.
    if (present.find((a) => a.id === actor)?.state === "lay" && !LAY_OK.has(verb)) return { pass: { kind: "pass", why: "posture" } };
    if (target !== undefined && !present.some((a) => a.id === target)) return { pass: { kind: "pass", why: "target_gone" } };
    const avatars: GateAvatar[] = present.map((a) => ({ ...a, fallen: this.isFallen(a.id) }));
    const now = this.d.clock.now();
    const state = this.roomState(actor);
    const verdict = reviewGates({
      verb,
      actor,
      target,
      origin,
      authoredSkip,
      now,
      enabled: (this.session?.enabled ?? true) && state.enabled,
      calm: state.calm,
      paused: state.paused,
      harm: { count: this.ledger.harmCount(room, now, this.harmWindowMs()), max: this.session?.harmMax ?? VOCAB_CONSTANTS.harm_max_default },
      optIn: state.optIn,
      scenario: this.d.scenario,
      actorRef: this.d.world.refOf(actor),
      targetRef: target === undefined ? undefined : this.d.world.refOf(target),
      avatars,
      ladder: this.ledger,
    });
    if (!verdict.ok) return { ok: false, veto: { kind: "veto", reason: verdict.reason, rule: verdict.rule, ...(verdict.detail !== undefined ? { detail: verdict.detail } : {}) } };

    // LAD-6 and LAD-10 are the director's policy, not the hotel's. An authored beat bypasses the emotion gate (LAD-6) and the contagion cap, which guards the autonomous spiral.
    const rung = ladderRung(verb);
    if (rung !== undefined && origin !== "scenario") {
      const m = emotion && target !== undefined ? motive(verb, emotion, emotion.relations?.get(target), emotion.at ?? now, this.tuning) : undefined;
      if (!m) return { ok: false, veto: { kind: "veto", reason: "ladder", rule: "LAD-6", detail: "motive" } };
      if (!m.ok) return { ok: false, veto: { kind: "veto", reason: "ladder", rule: "LAD-6", detail: m.why === "grievance" ? "grievance" : "motive" } };
      if (rung >= this.tuning.contagion.minRung && this.contagious(actor, avatars)) return { ok: false, veto: { kind: "veto", reason: "ladder", rule: "LAD-10", detail: "contagion" } };
    }
    return { ok: true, rung: verdict.rung, skippedRungs: verdict.skippedRungs };
  }

  /** The actor started this verb less than its window ago (`DramaTuning.repeatMs`). */
  private repeating(actor: number, verb: ActVerb): boolean {
    const window = this.tuning.repeatMs[verb];
    const at = this.startedAt.get(`${actor}|${verb}`);
    return window !== undefined && at !== undefined && this.d.clock.now() - at < window;
  }

  /** LAD-10: the cap of actors at rung 3 or above is reached and this actor is not one of them. */
  private contagious(actor: number, avatars: readonly GateAvatar[]): boolean {
    const c = this.tuning.contagion;
    const cap = Math.min(c.maxActors, Math.max(1, Math.floor(this.d.world.castSize() * c.castFraction)));
    const holding = this.ledger.actorsAtOrAbove(c.minRung, avatars.filter((a) => !a.human).map((a) => a.id));
    return !holding.includes(actor) && holding.length >= cap;
  }

  // ---- sending ---------------------------------------------------------------------------------------------------

  private wireOf(actor: number, verb: ActVerb, target: number | undefined, origin: ActProposal["origin"] | "director", intensity: number | undefined, text: string | undefined, authoredSkip: boolean): ActCmd {
    return {
      k: "act",
      act_id: this.nextId(),
      verb,
      ...(target !== undefined ? { with: target } : {}),
      ...(intensity !== undefined ? { intensity } : {}),
      origin,
      ...(authoredSkip ? { authored_skip: true } : {}),
      ...(text !== undefined ? { text } : {}),
    };
  }

  private dispatch(kind: "approve" | "initiate", actor: number, cmd: ActCmd, rung: number | undefined, skippedRungs: ActVerb[], volition: { v: number; theta: number } | undefined): DramaDecision {
    const sent = this.d.link.sendAct({ run: this.d.run, actor, cmd });
    if (!sent.sent) return { kind: "unsent", cause: sent.reason, ...(sent.reason === "invalid" ? { error: sent.error } : {}) };
    const now = this.d.clock.now();
    const room = this.d.world.roomOf(actor);
    const target = cmd.with ?? undefined;
    this.startedAt.set(`${actor}|${cmd.verb}`, now);
    this.ledger.reserve({ actId: cmd.act_id, actor, target, room, verb: cmd.verb, origin: cmd.origin ?? "director", scene: this.ledger.sceneId, humanTarget: target !== undefined && target > 0, at: now });
    this.d.record?.("out", room === undefined ? undefined : String(room), "actor_cmd", { actor: this.d.world.refOf(actor) ?? String(actor), cmd: cmd as unknown as Record<string, unknown> });
    const approval: DramaApproval = {
      kind,
      actId: cmd.act_id,
      actor,
      verb: cmd.verb,
      ...(target !== undefined ? { with: target } : {}),
      origin: cmd.origin ?? "director",
      ...(rung !== undefined ? { rung } : {}),
      skippedRungs,
      authoredSkip: cmd.authored_skip === true,
      ...(cmd.intensity != null ? { intensity: cmd.intensity } : {}),
      cid: sent.cid ?? 0,
      ...(volition ? { volition } : {}),
    };
    return approval;
  }

  // ---- reading the hotel's frames (DramaFrameSink) -----------------------------------------------------------------

  onSession(session: DramaSession | null): void {
    this.session = session;
    this.applySession();
  }

  private applySession(): void {
    this.ledger.keepMs = Math.max(this.harmWindowMs(), this.tuning.keepDoneMs) + this.tuning.keepDoneMs;
    // NEG-8: `hello.drama.dead` is a full replacement of the dead actors. A human down is not in it and is kept.
    if (this.session) this.fallen = new Set([...this.session.dead, ...[...this.fallen].filter((id) => id > 0)]);
  }

  onActStarted(f: Frame<"act_started">): void {
    if (f.run !== this.d.run) return;
    this.ledger.started(f, this.d.clock.now(), f.room);
    if (f.verb === "faint") this.faints.set(f.act_id, { actor: f.actor, down: false });
  }

  onActBeat(f: Frame<"act_beat">): void {
    // Contact is the planner's clock (REA-1), not the ladder's: nothing counts from it, except that a faint's actor is on the floor from here.
    const faint = f.run === this.d.run ? this.faints.get(f.act_id) : undefined;
    if (faint) faint.down = true;
  }

  onActReaction(_f: Frame<"act_reaction">): void {
    // The table owns the reactions (REA-3); the director keeps no debt.
  }

  onActDone(f: Frame<"act_done">): void {
    if (f.run !== this.d.run) return;
    if (f.outcome === "blocked") this.log.info("act blocked by the hotel", { run: f.run, act: f.act_id, reason: f.reason ?? null, detail: f.detail ?? null });
    this.faints.delete(f.act_id);
    this.ledger.done(f, this.d.clock.now());
  }

  onDramaConsent(f: Frame<"drama_consent">): void {
    if (f.run === this.d.run && f.phase === "answered") this.ledger.chipAnswered(f.act_id);
  }

  onActorDeath(f: Frame<"actor_death">): void {
    if (f.run === this.d.run) this.fallen.add(f.actor);
  }

  onActorRevive(f: Frame<"actor_revive">): void {
    if (f.run === this.d.run) this.fallen.delete(f.actor);
  }

  onHumanDown(f: Frame<"human_down">): void {
    if (f.run === this.d.run) this.fallen.add(f.human);
  }

  onHumanUp(f: Frame<"human_up">): void {
    if (f.run === this.d.run) this.fallen.delete(f.human);
  }

  /** SCENE-3, SCENE-4: the scene changes only on this frame (or on a `drama_state` after a resume). The actors it revives stand again; the ones it removes are gone. */
  onSceneCut(f: Frame<"scene_cut">): void {
    if (f.run !== this.d.run) return;
    this.ledger.cut(f.scene, this.d.clock.now());
    this.faints.clear();
    this.advancePending = undefined;
    for (const id of f.revived) this.fallen.delete(id);
    for (const id of f.removed) this.fallen.add(id);
  }

  /** NEG-9, SCENE-4: a room's calm, pause, switch and opt-in, and the run's scene. A different scene than ours is adopted: a cut we missed, or a resume. */
  onDramaState(f: Frame<"drama_state">): void {
    if (f.run !== this.d.run) return;
    this.rooms.set(f.room, { enabled: f.enabled, calm: f.calm, paused: f.paused, optIn: new Set(f.opt_in) });
    const now = this.d.clock.now();
    if (this.resumedAdopt) {
      this.resumedAdopt = false;
      this.ready = true;
      this.ledger.adopt(f.scene, now, this.assumptions(now));
    } else if (f.scene !== this.ledger.sceneId) {
      this.ledger.adopt(f.scene, now, {});
      this.advancePending = undefined;
    }
  }

  /** A rebuilt director cannot read the scene's counters back, so it assumes the worst until the next cut (`DramaTuning.resumeAssumes`). */
  private assumptions(now: number): Assumed {
    const a = this.tuning.resumeAssumes;
    return { ...(a.physicalBeatJustStarted ? { physicalAt: now } : {}), ...(a.killUsed ? { killUsed: true } : {}) };
  }

  // ---- helpers ------------------------------------------------------------------------------------------------------

  private roomState(actor: number): RoomDrama {
    const room = this.d.world.roomOf(actor);
    return (room === undefined ? undefined : this.rooms.get(room)) ?? OPEN_ROOM;
  }

  private harmWindowMs(): number {
    return (this.session?.harmWindowS ?? VOCAB_CONSTANTS.harm_window_s_default) * 1000;
  }

  /** On the floor: dead, down, or fainted (DOWN-1). */
  private isFallen(id: number): boolean {
    if (this.fallen.has(id)) return true;
    for (const faint of this.faints.values()) if (faint.down && faint.actor === id) return true;
    return false;
  }

  /** Slot 0 of the run is its narrator (ACT-9). */
  private narrator(): number {
    return -(this.d.run * 100);
  }

  /** What the director currently believes about the scene: for tests and the run's status line. */
  snapshot(): { scene: string; highestRung: number; kills: number; lastPhysicalAt: number | undefined; fallen: number[]; rooms: number } {
    return { scene: this.ledger.sceneId, highestRung: this.ledger.highestRung(), kills: this.ledger.kills(), lastPhysicalAt: this.ledger.lastPhysicalAt(), fallen: [...new Set([...this.fallen, ...[...this.faints.values()].filter((x) => x.down).map((x) => x.actor)])].sort((x, y) => x - y), rooms: this.rooms.size };
  }
}
