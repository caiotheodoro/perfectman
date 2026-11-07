import type {
  ActionIntent,
  AgentState,
  CommittedEvent,
  ResolvedIntentOutcome,
  SpaceMirror,
  SpaceView,
} from "@perfectman/shared";
import type { ArbiterConfig, PulseReason, SplitPulseConfig } from "./hotel-runtime-api.js";
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
  /** Fires after each agent's intent is resolved and appended; the planner's seam. */
  onAgentCommitted?: OnAgentCommitted;
  /** Wall clock for the arbiter and the space reads; injectable for tests. */
  clock?: () => number;
};
