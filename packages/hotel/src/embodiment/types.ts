import type { ActionIntent, AgentState, BodyCommand, BodyIntent, CommittedEvent, SpaceView } from "@perfectman/shared";

/**
 * The embodiment planner's contract (ADR-0018 D-66, docs/embodiment.md
 * section 7). Pure: the same inputs and rng give the same commands. The
 * implementation (priority rules, budgets, anti-jitter, pair choreography)
 * lands in Phase 2; only the signature is frozen here.
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
};

export type EmbodimentPlanner = (input: PlanInput) => BodyCommand[];
