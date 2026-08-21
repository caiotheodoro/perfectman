import type { EventPayload } from "../event/event.types.js";

export type OperatorEventType =
  | "llm_failure"
  | "llm_budget_exceeded"
  | "intent_blocked"
  | "intent_delayed"
  | "rate_limit_hit"
  | "stagnation_warning"
  | "scheduler_error"
  | "pulse_metrics"
  | "agent_state_snapshot";

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
  callType: "cognition" | "reflection" | "recap" | "interpretation";
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
