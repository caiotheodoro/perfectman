import type { ActionIntent, LLMUsage, OperatorEvent, PromptPurpose } from "@perfectman/shared";

export type AgentRuntimeContext = {
  pulseIndex: number;
  now: number;
};

export type BuiltPrompt = {
  system: string;
  user: string;
  inputTokensEstimate: number;
  purpose: PromptPurpose;
  /** Deterministic content hash of the rendered prompt, for result attribution. */
  version: string;
};

export type AgentRuntimeOutput = {
  intent: ActionIntent;
  llmUsage: LLMUsage | null;
  latencyMs: number;
  fallbackApplied: boolean;
  operatorEvents: OperatorEvent[];
};
