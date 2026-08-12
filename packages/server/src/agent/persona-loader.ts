import type { LlmConfig } from "../llm/llm-config.js";
import {
  getPersonaPackById,
  type PersonaPack,
} from "@perfectman/shared";
import {
  GENERIC_PROMPT_PROFILE,
  PERSONA_PROFILES,
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
  /**
   * Resolves the compiled prompt profile for a persona. Canonical personas
   * resolve to their authored PersonaPack (identity frame, voice, biases,
   * motive lexicon); unknown ids fall back to a generic profile.
   */
  static getProfile(personaId: string): PersonaPromptProfile {
    const normalizedPersonaId = personaId.toLowerCase();
    const profile = PERSONA_PROFILES[normalizedPersonaId];
    if (profile) return profile;

    const pack = getPersonaPackById(personaId);
    if (pack) return personaPackToProfile(pack);

    return {
      ...GENERIC_PROMPT_PROFILE,
      personaId,
      displayName: personaId.charAt(0).toUpperCase() + personaId.slice(1),
    };
  }

  /**
   * Resolves an LlmConfig by personaId with safe mock defaults.
   * Sampling is persona-tuned when a persona pack exists.
   */
  static getLlmConfig(personaId: string, overrides?: Partial<LlmConfig>): LlmConfig {
    const pack = getPersonaPackById(personaId);
    return {
      ...DEFAULT_MOCK_CONFIG,
      ...(pack
        ? {
            temperature: pack.sampling.temperature,
            maxOutputTokens: pack.sampling.maxTokens,
            extraBody: {
              top_p: pack.sampling.topP,
              repetition_penalty: pack.sampling.repetitionPenalty,
            },
          }
        : {}),
      ...overrides,
    };
  }
}

/** Compiles an authored PersonaPack into the LLM-facing prompt profile. */
export function personaPackToProfile(pack: PersonaPack): PersonaPromptProfile {
  const biases: Record<string, import("./persona-prompt-profile.js").RelationshipPromptBias> = {};
  for (const [peer, view] of Object.entries(pack.relationshipBiases)) {
    biases[peer] = { view, warmth: "medium", trust: "medium", likelyBehaviors: [], triggers: [] };
  }
  return {
    personaId: pack.personaId,
    displayName: pack.displayName,
    language: pack.language,
    identityFrame: pack.identityFrame,
    coreTraits: [pack.archetype],
    valuesAndMotivations: pack.socialTheory,
    socialPresence: pack.edgeProfile.maskTells.length > 0
      ? pack.edgeProfile.maskTells.map(t => `Masking tell: ${t}`)
      : [],
    cognitiveStyle: pack.edgeProfile.maskTells.length > 0 ? pack.edgeProfile.maskTells : [],
    emotionalPatterns: pack.memorySeeds.filter(m => m.unresolved).map(m => `Unresolved: ${m.summary}`),
    conflictStyle: pack.edgeProfile.triggers.map(t => `Trigger: ${t.trigger} → ${t.behavior}`),
    affectionStyle: [],
    publicPrivateDelta: pack.edgeProfile.maskTells,
    voiceGuidelines: pack.voiceGuidelines,
    styleExamples: {
      default: pack.styleExamples,
      animated: [],
      dryOrLowEnergy: [],
      conflict: pack.edgeProfile.impulseBehaviors,
    },
    privateMotivePatterns: pack.edgeProfile.privateMotiveLexicon,
    hardAvoids: pack.edgeProfile.hardLimits,
    relationshipBiases: biases,
    sourceRefs: {
      assessmentIds: [],
      lastCompiledAt: new Date().toISOString(),
    },
  };
}
