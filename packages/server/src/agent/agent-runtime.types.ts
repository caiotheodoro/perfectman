import type { ActionIntent, LlmUsage, OperatorEvent } from "@perfectman/shared";

export type AgentRuntimeContext = {
  pulseIndex: number;
  now: number;
};

export type BuiltPrompt = {
  system: string;
  user: string;
  inputTokensEstimate: number;
};

export type AgentRuntimeOutput = {
  intent: ActionIntent;
  llmUsage: LlmUsage | null;
  latencyMs: number;
  fallbackApplied: boolean;
  operatorEvents: OperatorEvent[];
};
