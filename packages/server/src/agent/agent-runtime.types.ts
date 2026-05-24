import type { ActionIntent, LlmUsage, OperatorEvent, PromptPurpose } from "@perfectman/shared";

export type AgentRuntimeContext = {
  pulseIndex: number;
  now: number;
};

export type BuiltPrompt = {
  system: string;
  user: string;
  inputTokensEstimate: number;
  purpose: PromptPurpose;
};

export type AgentRuntimeOutput = {
  intent: ActionIntent;
  llmUsage: LlmUsage | null;
  latencyMs: number;
  fallbackApplied: boolean;
  operatorEvents: OperatorEvent[];
};
