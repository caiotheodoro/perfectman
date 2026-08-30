import type { ActionIntent, LLMUsage, OperatorEvent, PromptPurpose } from "@perfectman/shared";

export type AgentRuntimeContext = {
  pulseIndex: number;
  now: number;
};

export type PromptTrim = {
  maxInputTokens: number;
  rawInputTokensEstimate: number;
  finalInputTokensEstimate: number;
  droppedEvents: number;
  droppedMemories: number;
  droppedInputTokensEstimate: number;
};

export type BuiltPrompt = {
  system: string;
  user: string;
  inputTokensEstimate: number;
  purpose: PromptPurpose;
  /** Deterministic content hash of the rendered prompt, for result attribution. */
  version: string;
  /** Manually-bumped structure identifier, stable across renders that share the same template. */
  templateVersion: string;
  /**
   * Set only when the raw assembly exceeded `maxInputTokens` and per-pulse
   * context was dropped to bring it within the cap.
   */
  trim?: PromptTrim;
};

export type AgentRuntimeOutput = {
  intent: ActionIntent;
  llmUsage: LLMUsage | null;
  latencyMs: number;
  fallbackApplied: boolean;
  operatorEvents: OperatorEvent[];
};
