import type { AgentRuntimeInput, PromptPurpose } from "@perfectman/shared";
import type { PersonaPromptProfile } from "./persona-prompt-profile.js";
import type { BuiltPrompt } from "./agent-runtime.types.js";
import { ActionIntentPromptBuilder } from "./action-intent-prompt-builder.js";
import { BackgroundReflectionPromptBuilder } from "./background-reflection-prompt-builder.js";

export class PromptBuilder {
  /**
   * Dispatches to the dedicated builder for a prompt purpose.
   * Reserved purposes without a builder fail closed.
   */
  static build(
    input: AgentRuntimeInput,
    profile: PersonaPromptProfile,
    purpose: PromptPurpose
  ): BuiltPrompt {
    switch (purpose) {
      case "action_intent":
        return ActionIntentPromptBuilder.build(input, profile);
      case "background_reflection":
        return BackgroundReflectionPromptBuilder.build(input, profile);
      case "social_interpretation":
      case "spectator_recap":
        throw new Error(`Unsupported prompt purpose: ${purpose}`);
    }
  }
}
