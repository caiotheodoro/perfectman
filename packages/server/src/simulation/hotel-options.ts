import type {
  ActionEmotions,
  ActionIntent,
  AgentState,
  CommittedEvent,
  ResolvedIntentOutcome,
  SpaceMirror,
  SpaceView,
  SpeechMode,
} from "@perfectman/shared";
import type { ArbiterConfig, BudgetSoftLimits, PulseReason, SplitPulseConfig } from "./hotel-runtime-api.js";
import type { InMemoryEventRepositoryOptions } from "./in-memory-stores.js";
import type { ResolvedBody } from "./intent-resolver.js";

/**
 * What the host needs right after one agent's intent was resolved and its
 * events appended: the embodiment planner's inputs (docs/embodiment.md 7).
 * The host must not await anything in the callback (hotel-package.md 7); a
 * throw is contained.
 */
export type AgentCommitInfo = {
  simulationId: string;
  agentId: string;
  reason: PulseReason;
  pulseIndex: number;
  intent: ActionIntent;
  outcome: ResolvedIntentOutcome;
  /** Appended events of this resolution, in log order. */
  committedEvents: CommittedEvent[];
  /** Validated `body` block, targets and any deferral, when the intent carried one. */
  body?: ResolvedBody;
  /** The agent's view of the space when it decided. */
  space?: SpaceView;
  agentState: AgentState;
  /** The 15 action tendencies of the step this decision came from (computed, never persisted): the planner's reading of the whole emotion model. */
  actionEmotions?: ActionEmotions;
};

export type OnAgentCommitted = (info: AgentCommitInfo) => void;

/**
 * Everything that switches a simulation into hotel mode. Passed as one
 * optional bag through `buildConfiguredSimulation` and
 * `SimulationRuntime.createSimulation`; absent, every code path is the one the
 * web builder, the CLI and eval have always run.
 */
export type HotelSimulationOptions = SplitPulseConfig & {
  /** Split mode: "settle" (default) commits as each call settles, "turn" in seeded order for eval and replay. */
  commitOrder?: "settle" | "turn";
  /** Bounded event reads and the in-memory retention window (ADR-0024). Default: windowed reads on. */
  windowedReads?: boolean;
  eventRetention?: InMemoryEventRepositoryOptions;
  /** Room speech arbiter (ADR-0021). Omit to run without one. */
  arbiter?: Partial<ArbiterConfig>;
  /** Source of per-agent `SpaceView`s (ADR-0018); also used to stamp who hears each actor line. */
  spaceMirror?: SpaceMirror;
  /**
   * The mode an actor's `say` line is actually delivered in (the planner's shout choice). Asked once, when
   * the line is stamped with who hears it, so the stamped hearing and the delivered mode are the same.
   */
  chooseMode?: (agentId: string, content: string, committed: SpeechMode) => SpeechMode;
  /**
   * Pure peek at the same choice: would this `say` line be delivered as a shout? An addressed line to someone
   * beyond the say radius is walked to (move_then_speak) unless this says it will carry as a shout.
   */
  wouldShout?: (agentId: string, content: string) => boolean;
  /** Fires after each agent's intent is resolved and appended; the planner's seam. */
  onAgentCommitted?: OnAgentCommitted;
  /** Wall clock for the arbiter and the space reads; injectable for tests. */
  clock?: () => number;
  /**
   * Registers this simulation's LLM budget in warn mode (ADR-0025, D11): the hard
   * limits are effectively unbounded, so a busy room never goes mute, and these
   * soft limits only drive the `llm_budget_warning` and the priority ladder.
   * Ignored when the caller injects its own `llmBudget`.
   */
  budget?: Partial<BudgetSoftLimits>;
};
