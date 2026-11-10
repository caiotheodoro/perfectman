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

/** One inline image attached to the user turn (base64, no `data:` prefix). */
export type PromptImage = {
  mediaType: "image/png" | "image/jpeg";
  base64: string;
};

export type BuiltPrompt = {
  system: string;
  user: string;
  /** Images sent after `user` text, in order. Only the OpenAI-compatible transport reads this (the eval judge path); the agent runtime never sets it. */
  userImages?: readonly PromptImage[];
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
  /** Hotel mode: set to "compact" when the small-window profile rendered this prompt. Unset otherwise. */
  promptStyle?: "compact";
  /**
   * Set on a retry prompt (a near-duplicate or an unresolvable target): the model already answered once this turn
   * and the answer was not usable. A provider chain reads it to ask a different model the second time.
   */
  retry?: "correction";
  /** Hotel drama mode: the room stalled and the decision carries the one-line nudge to commit to a move (scene-stall.ts). Unset otherwise. */
  stallNudged?: true;
  /** Hotel runs with the script checks on: the decision carries the note that this actor owes a direct question an answer (script-guard.ts). Unset otherwise. */
  owedNoted?: true;
  /** Hotel runs with the script checks on: the decision carries the note that the room's last line was a move at this actor (a reveal, an accusation, a threat, an offer) to react to first. Unset otherwise. */
  answerNoted?: true;
};

export type AgentRuntimeOutput = {
  intent: ActionIntent;
  llmUsage: LLMUsage | null;
  latencyMs: number;
  fallbackApplied: boolean;
  operatorEvents: OperatorEvent[];
  /**
   * The provider call (or its retry) itself failed, as opposed to answering
   * with something unusable. A structured flag: the circuit breaker reads it
   * instead of the model-influenced motive text.
   */
  providerFailed?: boolean;
  /**
   * Hotel mode: the model's `body` block named a handle that is not in this
   * render's `bodyHandles`, so the parser dropped it and kept the speech
   * (ADR-0019). The resolver commits these as an operator-only `body_blocked`.
   */
  bodyDropped?: import("@perfectman/shared").BlockedReason[];
};
