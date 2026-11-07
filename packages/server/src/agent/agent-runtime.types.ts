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

export type PromptTrim = {
  maxInputTokens: number;
  rawInputTokensEstimate: number;
  finalInputTokensEstimate: number;
  droppedEvents: number;
  droppedMemories: number;
  /**
   * Own recent utterances shed oldest-first (perception assembles them in
   * chronological order), after memories and events were not enough.
   */
  droppedUtterances: number;
  /** Hotel mode: how far the body block was compressed (0 none .. 3 most) before any event was dropped. */
  bodyCompressionLevel?: number;
  droppedInputTokensEstimate: number;
  /**
   * False when the drop loop exhausted every trimmable item and the render
   * still estimates over `maxInputTokens` (irreducible persona + output
   * contract + decision + triggering event). The prompt is sent anyway; this
   * flags that the cap was not actually honored.
   */
  withinCap: boolean;
  /**
   * Which assembly produced this trim: the initial render, or the
   * repetition-guard retry whose correction note re-inflated an
   * already-capped prompt.
   */
  phase: "assembly" | "repetition_retry";
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
  /**
   * Hotel mode: the model's `body` block named a handle that is not in this
   * render's `bodyHandles`, so the parser dropped it and kept the speech
   * (ADR-0019). The resolver commits these as an operator-only `body_blocked`.
   */
  bodyDropped?: import("@perfectman/shared").BlockedReason[];
};
