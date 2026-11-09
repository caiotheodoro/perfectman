import type {
  ActionEmotions,
  ActionIntent,
  AgentState,
  BodyCommand,
  BodyHandleMap,
  BodyIntent,
  CommittedEvent,
  SpaceView,
  SpeechMode,
} from "@perfectman/shared";

/**
 * The embodiment planner's contract (ADR-0018 D-66, docs/embodiment.md
 * section 7). Pure: the same inputs and rng give the same commands. The three
 * optional fields below are additive to the Phase 1 signature: `handles` to
 * resolve the model's `p1`/`z2` references, `memory` for the hysteresis and
 * cooldown state the executor keeps between calls, `noOpStreak` for the
 * fidget rule.
 */
export type PlanInput = {
  space: SpaceView;
  /** Mood and relational state the priority rules read (docs/embodiment.md 7.1). */
  agentState: AgentState;
  /** Events committed by this agent's resolution this pulse. */
  committedEvents: CommittedEvent[];
  /** The validated `body` block, if the model wrote one. */
  bodyIntent?: BodyIntent;
  /** The intent the body block rode on, for `intentId` stamping. */
  intent?: ActionIntent;
  /** Wall-clock ms. */
  now: number;
  rng: () => number;
  handles?: BodyHandleMap;
  memory?: PlannerMemory;
  noOpStreak?: number;
  /** What this actor wants, for the initiative rules: its authored goal text, this turn's private motive, the room it started in. */
  drives?: { goalText?: string; motive?: string; homeRoom?: string };
  /**
   * The 15 action tendencies of this actor's last engine step (verb-bible 4.3). They are computed, not persisted, so they
   * are not on `AgentState`; the commit seam carries them. Read only when `drama` is present.
   */
  actionEmotions?: ActionEmotions;
  /** Present only when drama is negotiated and on for the run (a dialect 2 link, the hotel's switch on). Absent: every rule is today's. */
  drama?: DramaPlanInput;
};

/** What the planner needs to know about the acts of the room, from the act ledger and the director (act-contract.md REA-9, LAD-8, DOWN-1). */
export type DramaPlanInput = {
  /** The act that holds this actor's body commands (initiator, target, owed reactor, held bystander): the planner issues nothing (REA-9, ACT-12). */
  lock?: { actId: string; why: string };
  /** `DramaDecisionPort.busyActId`: the director's own view of the same lock. */
  busyActId?: string;
  /** The killer's 5 s without celebration (LAD-8). */
  noReward: boolean;
  /** Avatars on the floor: not interlocutors, not approached, and the subject of `tend_fallen`. */
  fallen: ReadonlyMap<string, "dead" | "fainted" | "down">;
  /** A violent act that just landed in front of this actor: who struck whom, for a rescuer's `restrain` (bible 3.3). */
  rescue?: { aggressor: string; victim: string };
  /** This actor's own hug, kiss or restrain just landed: a held picture is in order (`tableau`). */
  staged?: boolean;
  /** A fresh act id, unique within the run (ACT-5). */
  nextActId(): string;
};

/**
 * `afterArrival`: the executor holds the command until the walk with that plan
 * id ends. `fidget`: lowest keep-priority, and it starts the 45 s fidget cooldown.
 */
export type PlannedCommand = BodyCommand & { afterArrival?: string; fidget?: boolean; owed?: boolean };

export type EmbodimentPlanner = (input: PlanInput) => PlannedCommand[];

export type PlannerMemory = {
  lastMove?: { at: number; dx: number; dy: number };
  lastFidgetAt?: number;
  lastShoutAt?: number;
  lastLaughAt?: number;
  lastGesture?: { a: string; at: number };
  lastExpression?: string;
  /** Who this actor is in an exchange with, until when: the planner keeps facing them while the exchange lasts. */
  interlocutor?: { ref: string; until: number };
  /** A person who is in an exchange with this actor: faced ahead of any other speaker until then. */
  holdFace?: { ref: string; until: number };
  /** Human ref -> when that human last dodged or pushed away this actor's pair act. */
  pairRefusedAt?: Record<string, number>;
  /** The planner's first run for this actor: the clock the idle rules count from. */
  firstPlanAt?: number;
  lastSatAt?: number;
  lastStoodAt?: number;
  lastSeatTryAt?: number;
  /** The last pair act the planner started on its own, and how many it started toward each person. */
  lastInitiativeAt?: number;
  pairTries?: Record<string, number>;
  /** An errand to another room the planner sent this actor on: where from and to, and when. */
  errand?: { from: string; to: string; at: number; back?: boolean };
  lastErrandAt?: number;
  /** When this actor last played each solo verb the planner starts on its own, for the per-verb cooldowns. */
  soloAt?: Record<string, number>;
  /** Whom this actor turned its back on, until when: rule 2 does not turn it round again (REA-9: the face lock must not undo a table step). */
  turnedBack?: { ref: string; until: number };
};

export type SpeechModeChoice = { mode: SpeechMode; reason?: string };
