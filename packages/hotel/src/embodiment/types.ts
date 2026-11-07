import type {
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
};

/**
 * `afterArrival`: the executor holds the command until the walk with that plan
 * id ends. `fidget`: lowest keep-priority, and it starts the 45 s fidget cooldown.
 */
export type PlannedCommand = BodyCommand & { afterArrival?: string; fidget?: boolean };

export type EmbodimentPlanner = (input: PlanInput) => PlannedCommand[];

export type PlannerMemory = {
  lastMove?: { at: number; dx: number; dy: number };
  lastFidgetAt?: number;
  lastShoutAt?: number;
  lastLaughAt?: number;
  lastGesture?: { a: string; at: number };
  lastExpression?: string;
  /** Human ref -> when that human last dodged or pushed away this actor's pair act. */
  pairRefusedAt?: Record<string, number>;
};

export type SpeechModeChoice = { mode: SpeechMode; reason?: string };
