import type { AgentRuntimeInput, PromptPurpose } from "@perfectman/shared";
import type { PersonaPromptProfile } from "./persona-prompt-profile.js";
import type { BuiltPrompt } from "./agent-runtime.types.js";
import { ActionIntentPromptBuilder } from "./action-intent-prompt-builder.js";

export class PromptBuilder {
  /**
   * Dispatches to the dedicated builder for a prompt purpose.
   * Only action_intent is implemented for V1 production.
   */
  static build(
    input: AgentRuntimeInput,
    profile: PersonaPromptProfile,
    purpose: PromptPurpose
  ): BuiltPrompt {
    switch (purpose) {
      case "action_intent":
        return ActionIntentPromptBuilder.build(input, profile);
      case "social_interpretation":
      case "background_reflection":
      case "spectator_recap":
        throw new Error(`Unsupported prompt purpose: ${purpose}`);
    }
  }
}
