import { ActionIntentStep } from "./action-intent-step.js";

/**
 * Registry of every implemented LLM surface, keyed by PromptPurpose.
 * The production runtime routes through this so a new surface is added in one
 * place (`ActionIntentStep` is the template) instead of new ad-hoc branching.
 */
export const llmSurfaceRegistry = {
  action_intent: new ActionIntentStep(),
} as const;

export type LLMSurfaceRegistry = typeof llmSurfaceRegistry;
