import type { ActionEmotions, ActOrigin, ActVerb, CoreMood, RelationalState, SocialEmotions } from "@perfectman/shared";
import type { ActCmdError } from "../act-cmd.js";
import type { BlockedReason, HotelFrame } from "../index.js";
import type { DramaLogEntry } from "./decision-log.js";

/**
 * The port between the drama director (packet P2) and the planner and engine (packet P3).
 *
 * Where it sits. The model's body block may carry an `act` (any of the 18 verbs); the director has the last word
 * (act-contract.md 11.5, the HYBRID rule). P3 turns the model's `act` into an `ActProposal`, reads the emotion state
 * into an `EmotionReading`, and asks `decide`. The director answers with one of five things and, when it approves or
 * initiates, has already sent `actor_cmd{k:"act"}` itself: P3 never sends an act, so the run has one ledger of act ids
 * (ACT-5), one budget (ACT-3) and one source of `origin`.
 *
 *   proposal present, `approve`   the director sent it as `origin:"model"` (or `"scenario"` for an authored beat).
 *   proposal present, `veto`      nothing was sent. `reason` is a member of the contract's blocked-reason enum; `rule`
 *                                 names the rule that refused (a hotel gate, or the director's own LAD-6 / LAD-10).
 *   no proposal, `initiate`       the model was passive and the emotion state drives a beat: sent as `origin:"director"`.
 *   no proposal, `pass`           nothing to do (nothing drives a beat, the pace gap has not passed, ...).
 *   `unsent`                      the director wanted to send but the link refused (not dialect 2, no lease, a frame the
 *                                 hotel would refuse at ACT-4 to ACT-9). Nothing is reserved.
 *
 * What P3 must do with a result. `approve` and `initiate` mean the actor now owes the act: hold its body commands until
 * `act_done` (ACT-12, REA-9) by asking `busyActId`, which the director keeps from the hotel's frames. A `veto` with
 * `too_far` is the cue to walk closer and ask again (the planner's `afterArrival`); `consent_off`, `calm_room`,
 * `rate_limit` and `kill_switch` mean stop proposing that kind of act for now (`drama_state` says when it changes).
 *
 * Events P3 must feed back. The director reads the hotel's drama frames itself (it is a `DramaFrameSink` and the manager
 * routes every frame to it), so `feed` is not required for the director to work. It exists for a caller that sees the
 * lifecycle frames by another path (a replay of a recorded run, a test, the planner's own sink): `act_started`,
 * `act_beat` and `act_done` of the run. Feeding a frame twice is harmless (the director keys everything by `act_id`
 * and phase). A frame of another run is ignored.
 *
 * Ids. Every id is a wire id: actors are negative, humans positive (act-contract.md 0.1). The director maps an actor's id
 * to its `person-N` ref itself, for the scenario gates.
 */

/** What the model (or an authored scenario beat) proposes. The director never changes the verb or the target. */
export type ActProposal = {
  verb: ActVerb;
  /** Wire id of the target: present iff the verb has one (ACT-7, ACT-8). */
  with?: number;
  /** 0 to 1; absent means the verb's default. */
  intensity?: number;
  /** `insult` only: the line spoken at contact (at most 200 characters, ACT-4). */
  text?: string;
  /** `model` for a proposal of the model, `scenario` for an authored beat. The director's own beats are `director` and are never proposed. */
  origin: Exclude<ActOrigin, "director">;
  /** Honoured only with `origin:"scenario"` and a scenario drama block (LAD-2, SCN-4). */
  authoredSkip?: boolean;
};

/** The relational fields of one actor toward one other avatar that the ladder reads (verb-bible 4.4 and 4.5). */
export type RelationReading = Pick<RelationalState, "resentment" | "threat" | "envy" | "suspicion" | "lastNegativeAt"> & {
  /** The grievance the cast's talk built toward this person, 0 to 1 (`ProvocationLedger`, errata P7); absent is none. */
  provocation?: number;
  /**
   * The top rung the scene spine has opened toward this person (errata P8, `ProvocationLedger.unlock`): 3 (the shove) or 4 (the slap), absent when nothing is open. It makes
   * the volition of every ladder verb up to that rung `provocation.unlock.volition` and opens their grievance; it is never above the slap, and one rung per beat still applies.
   */
  unlocked?: number;
};

/**
 * The emotion state that becomes ladder pressure. `actionEmotions` are the 15 tendencies (computed, not persisted);
 * `social` and `core` are optional extras the mapping can read; `relations` is keyed by the target's wire id.
 * The mapping from these numbers to a threshold test is data (`DRAMA_TUNING`), not code.
 */
export type EmotionReading = {
  actionEmotions: ActionEmotions;
  social?: Partial<SocialEmotions>;
  core?: Partial<Pick<CoreMood, "arousal" | "momentumArousal">>;
  /** Who the actor has a relationship with. The director aims a beat of its own only at someone listed here. */
  relations?: ReadonlyMap<number, RelationReading>;
  /** `Date.now()`-style time of the reading, for `lastNegativeAt`; absent means the director's clock. */
  at?: number;
};

export type DramaTurn = {
  /** Wire id of the actor whose turn it is. */
  actor: number;
  /** The model's `act`, or an authored beat. Absent means the model is passive: the director may initiate. */
  proposal?: ActProposal;
  /** Without it a ladder act of rung 1 or above cannot pass the motive gate (LAD-6) unless it is authored. */
  emotion?: EmotionReading;
};

/** An approved proposal or a director-originated beat: the act was sent. */
export type DramaApproval = {
  kind: "approve" | "initiate";
  actId: string;
  actor: number;
  verb: ActVerb;
  with?: number;
  origin: ActOrigin;
  /** The ladder rung of the verb; absent for an off-ladder verb. */
  rung?: number;
  /** Ladder verbs jumped by an authored skip (LAD-2); `[]` otherwise. */
  skippedRungs: ActVerb[];
  authoredSkip: boolean;
  intensity?: number;
  /** The `cid` of the `actor_cmd`, so a later `actor_error` can be matched. */
  cid: number;
  /** `initiate` only: the volition `v` that drove the beat and the threshold it passed (verb-bible 4.5). */
  volition?: { v: number; theta: number };
};

/** Nothing was sent. `reason` is the contract's enum; `rule` is the id of the rule that said no. */
export type DramaVeto = {
  kind: "veto";
  reason: BlockedReason;
  /** The contract's `detail` where the rule has one (`max_rung`, `zero_witness`, `physical`, `chip_busy`, ...), or the director's own (`motive`, `contagion`). */
  detail?: string;
  rule: string;
};

/**
 * `inert`: drama is not negotiated for this run (or the hotel's switch is off and no proposal was made). `actor_dead`, `actor_busy`
 * (ACT-11, ACT-12), `posture` (ACT-13: a lying actor cannot make a gesture), `not_placed` (the mirror has no room for the actor yet), `target_gone` (ACT-10: the target is not in the actor's
 * room): nothing to send. `no_drive`: no beat is driven by the emotion state, there is no emotion state, or a `restrain` has no aggressor to restrain (RES-1). `pace`: this actor was
 * offered a beat too recently.
 */
export type DramaPassWhy = "inert" | "actor_dead" | "actor_busy" | "not_placed" | "target_gone" | "posture" | "no_drive" | "pace";

export type DramaPass = {
  kind: "pass";
  why: DramaPassWhy;
  /**
   * Only on a passive turn (no proposal): the wire id of someone the actor should walk up to. The director would start the next blow of a climb in progress (the
   * volition, the grievance and the pace all say yes) but the two are not beside each other (GATE-7); the planner walks the actor over and the next turn starts it.
   */
  approach?: number;
};

/** The link refused the frame. Nothing is reserved, so the same turn may be asked again. */
export type DramaUnsent = { kind: "unsent"; cause: "dialect" | "no_lease" | "invalid"; error?: ActCmdError };

export type DramaDecision = DramaApproval | DramaVeto | DramaPass | DramaUnsent;

/** The three frames that carry an act's lifecycle (FRM-1). `act_done` with no `act_started` is a blocked act (FRM-2). */
export type ActLifecycleFrame = Extract<HotelFrame, { t: "act_started" | "act_beat" | "act_done" }>;

/** `advanceScene`: the sidecar's script advanced (SCENE-2). It is the only way a scene is cut; cinematic cuts never call it. */
export type SceneAdvance =
  | { kind: "sent" }
  /** `too_young`: the scene is not yet `scene_min_age_ms` old (SCENE-5). `pending`: a `scene_advance` is out and no `scene_cut` has come (SCENE-4). */
  | { kind: "refused"; why: "inert" | "too_young" | "pending" | "unsent"; retryInMs?: number };

/** What the director saw in its last `decide`, as a decision-log line without the body's own fields (`queue`, `hold`, `unlock`): errata P9. */
export type DecisionTrace = Omit<DramaLogEntry, "queue" | "hold" | "unlock">;

export interface DramaDecisionPort {
  /**
   * True while drama is negotiated for this run (dialect 2 link, a `drama_state` read). False makes every `decide` a `pass` of
   * `inert`. When it is true but the hotel's runtime switch is off, a proposal is vetoed `kill_switch` (GATE-1) and a passive turn passes.
   */
  readonly active: boolean;
  /** The current scene id (`"<run>.<n>"`), as the hotel last told us (SCENE-4). */
  readonly scene: string;
  decide(turn: DramaTurn): DramaDecision;
  feed(frame: ActLifecycleFrame): void;
  advanceScene(reason: string): SceneAdvance;
  /** The `act_id` that keeps this actor busy (it started an open act, or is its locked target, TGT-1), else undefined (ACT-12). */
  busyActId(actor: number): string | undefined;
  /** What the last `decide` looked at and why it answered as it did, for the run's decision log (errata P9); undefined before the first one. Optional: a port with nothing to say leaves it out. */
  trace?(): DecisionTrace | undefined;
}
