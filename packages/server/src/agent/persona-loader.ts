import type { LlmConfig } from "../llm/llm-config.js";
import {
  GENERIC_PROMPT_PROFILE,
  type PersonaPromptProfile
} from "./persona-prompt-profile.js";

export const DEFAULT_MOCK_CONFIG: LlmConfig = {
  providerType: "mock",
  modelName: "mock-model",
  maxInputTokens: 2048,
  maxOutputTokens: 512,
  temperature: 0.7,
  timeoutMs: 5000,
  retryCount: 2,
};

export class PersonaLoader {
  static getProfile(personaId: string): PersonaPromptProfile {
    return {
      ...GENERIC_PROMPT_PROFILE,
      personaId,
      displayName: personaId.charAt(0).toUpperCase() + personaId.slice(1),
    };
  }

  /**
   * Resolves an LlmConfig by personaId with safe mock defaults.
   * By default, it resolves to mock unless explicit overrides are supplied.
   */
  static getLlmConfig(personaId: string, overrides?: Partial<LlmConfig>): LlmConfig {
    // In the future, we could check if process.env has specific settings for this agent
    // E.g., process.env[`LLM_CONFIG_${personaId.toUpperCase()}`]
    
    return {
      ...DEFAULT_MOCK_CONFIG,
      ...overrides,
    };
  }
}
