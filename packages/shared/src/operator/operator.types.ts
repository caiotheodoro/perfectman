import type { EventPayload, EventType } from "../event/event.types.js";
import type { IntentType } from "../intent/intent.types.js";

/**
 * Operator event types the server may emit. Declared once here — the single
 * source of truth — and enforced by the producer guard in packages/server
 * (`operator-event-producers.test.ts`): a type with no emission site in
 * packages/server/src is dead and must be removed, not kept "for later".
 * Deriving the type from the array keeps the runtime-iterable list and the
 * type in one place.
 *
 * `rate_limit_hit` was removed — the one type declared with no producer
 * anywhere in packages/server/src (RateLimitGate computes block state but
 * never emits an operator event for it).
 */
export const OPERATOR_EVENT_TYPES = [
  "llm_failure",
  "llm_budget_exceeded",
  "intent_blocked",
  "intent_delayed",
  "stagnation_warning",
  "stagnation_metrics",
  "attractor_detected",
  "scheduler_error",
  "pulse_metrics",
  "agent_state_snapshot",
  "action_intent",
  "event_visibility",
  "goal_proposed",
  "goal_accepted",
  "goal_declined",
  "world_verdict",
  "delusion_gap_sampled",
  "ending_offered",
] as const;

export type OperatorEventType = (typeof OPERATOR_EVENT_TYPES)[number];

export type OperatorEvent = {
  type: OperatorEventType;
  simulationId: string;
  agentId?: string;
  pulseIndex: number;
  detail: string;
  data?: EventPayload;
  createdAt: number;
};

export type LLMUsage = {
  simulationId: string;
  agentId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  callType: "cognition" | "reflection" | "recap" | "interpretation" | "goal";
  pulseIndex: number;
  createdAt: number;
  /** Deterministic content hash of the prompt that produced this call. */
  promptVersion?: string;
  /** Structure identifier of the prompt template, stable across renders — for old-vs-new template comparison. */
  promptTemplateVersion?: string;
};

export type StagnationMetrics = {
  simulationId: string;
  pulseIndex: number;
  bdi: number; // Behavioral Diversity Index
  rdv: number; // Relationship Dynamics Velocity
  ige: number; // Interaction Graph Entropy
  cue: number; // Channel Usage Entropy
  eri: number; // Emotional Range Index
  isd: number; // Initiative Source Diversity
  cns: number; // Conversation Novelty Score
  compositeScore: number;
  level: "normal" | "yellow" | "red" | "critical";
};

export type OperatorMetrics = {
  pulseIndex: number;
  pulseDurationMs: number;
  agentsCalled: number;
  eventsCommitted: number;
  llmCallsMade: number;
  budgetUsedPercent: number;
  stagnation?: StagnationMetrics;
};

/** `action_intent` payload — the LLM thinking payload for one agent in one
 *  pulse, emitted post-resolution (truthful, including fallback `no_op`). */
export type ActionIntentOperatorData = {
  intentType: IntentType;
  visibleContent?: string;
  privateMotiveSummary: string;
  emotionDrivers: string[];
  motivationDrivers: string[];
};

/** `event_visibility` payload — per-committed-event visibility/recipient
 *  data, the perspective-filter signal for receivers. */
export type EventVisibilityData = {
  eventId: string;
  eventType: EventType;
  actorId: string;
  channelId: string;
  visibleToAgents: string[];
  content?: string;
  channelName?: string;
};

/** `stagnation_metrics` payload — the full composite + 7 sub-metrics, emitted
 *  every stagnation cadence regardless of `level` (per-cadence telemetry).
 *  `stagnation_warning` still fires only on a non-normal `level`. */
export type StagnationMetricsOperatorData = StagnationMetrics;

/** `attractor_detected` payload — one event per detected attractor signature.
 *  Independent of the composite `level`, which it never overrides. */
export type AttractorDetectedOperatorData = {
  signature: string;
};
