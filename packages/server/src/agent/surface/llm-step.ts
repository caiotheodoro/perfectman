import type { LLMUsage, PromptPurpose } from "@perfectman/shared";
import type { BuiltPrompt } from "../agent-runtime.types.js";
import type { LLMConfig } from "../../llm/llm-config.js";
import type { LLMProvider } from "../../llm/llm-provider.js";
import type { PersonaPromptProfile } from "../persona-prompt-profile.js";

export type StepOutcome<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      fallback: T;
      errorDetail?: string;
      gateBlocked?: boolean;
    };

/**
 * Context every agent-surface step needs that is orthogonal to the surface's
 * own input. `prompt` is undefined until `render()` has run.
 */
export interface StepRunContext {
  now: number;
  pulseIndex: number;
  provider: LLMProvider;
  llmConfig: LLMConfig;
  profile: PersonaPromptProfile;
  prompt?: BuiltPrompt;
}

/**
 * A single LLM surface as a typed, closed step: render → gate → execute.
 * Implementations never throw for expected failure and never mutate upstream
 * state; they return a StepOutcome.
 */
export interface LLMStep<Input, Output> {
  readonly purpose: PromptPurpose;
  readonly label: string;
  /** Build the prompt text; the result is needed before `gate` for token estimates. */
  render(input: Input, ctx: StepRunContext): BuiltPrompt;
  /** Pre-call gate (LLM budget). Return a blocked outcome to reject the call, or undefined to proceed. */
  gate(input: Input, ctx: StepRunContext): StepOutcome<Output> | undefined;
  /** Run the full surface: provider call → strict parse → retry/fallback arms → usage/compose. */
  execute(input: Input, ctx: StepRunContext): Promise<StepOutcome<Output>>;
}

export function purposeToCallType(purpose: PromptPurpose): LLMUsage["callType"] {
  switch (purpose) {
    case "action_intent":         return "cognition";
    case "social_interpretation": return "interpretation";
    case "background_reflection": return "reflection";
    case "spectator_recap":       return "recap";
  }
}
