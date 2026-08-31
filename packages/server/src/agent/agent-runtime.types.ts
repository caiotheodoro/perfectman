import type { ActionIntent, LLMUsage, OperatorEvent, PromptPurpose } from "@perfectman/shared";

export type AgentRuntimeContext = {
  pulseIndex: number;
  /**
   * Simulated clock in ms (monotonic, pulse-relative) — deterministic across
   * replays, so it must not be used as a wall-clock timestamp. Operator-event
   * `createdAt` is stamped with `Date.now()` at emission; this value feeds only
   * rate-window bookkeeping (`LLMUsage.createdAt`).
   */
  now: number;
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
};

export type AgentRuntimeOutput = {
  intent: ActionIntent;
  llmUsage: LLMUsage | null;
  latencyMs: number;
  fallbackApplied: boolean;
  operatorEvents: OperatorEvent[];
};
