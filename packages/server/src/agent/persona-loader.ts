import type { LLMConfig } from "../llm/llm-config.js";
import type { ScenarioContextBlock } from "@perfectman/shared";
import {
  getPersonaPackById,
  type PersonaPack,
} from "@perfectman/shared";
import {
  GENERIC_PROMPT_PROFILE,
  PERSONA_PROFILES,
  type PersonaPromptProfile
} from "./persona-prompt-profile.js";

export const DEFAULT_MOCK_CONFIG: LLMConfig = {
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
   * Resolves an LLMConfig by personaId with safe mock defaults.
   * Sampling is persona-tuned when a persona pack exists.
   */
  static getLLMConfig(personaId: string, overrides?: Partial<LLMConfig>): LLMConfig {
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

/**
 * A scenario re-skin of a pack: the pack supplies temperament, voice and
 * relationship texture; the scene supplies the name and the cast. Without
 * it the pack's own friends leak into a room they were never in (a goulart
 * playing "Íris" once tagged `@caio @leo` in a scene with neither) and the
 * prompt says "Display Name: Goulart" under a room context that says
 * "Você é Íris".
 */
export type PersonaReskin = {
  scenarioContext?: ScenarioContextBlock;
  /** Every agent id in the scene; a pack peer survives only if it maps onto one of these. */
  castAgentIds: readonly string[];
  /** Scene display name per cast id, used when rewriting peer names inside free text. */
  castDisplayNames?: Record<string, string>;
  /** The scene seeds this agent's memories, so the pack's unresolved-memory lines are dropped. */
  replacesMemories?: boolean;
};

const RESKIN_FRAME_PREFIX = (displayName: string): string =>
  `In this scene you are ${displayName}; the profile below describes your temperament, not your name or history.`;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compiles an authored PersonaPack into the LLM-facing prompt profile. */
export function personaPackToProfile(pack: PersonaPack, reskin?: PersonaReskin): PersonaPromptProfile {
  const castMap = reskin?.scenarioContext?.castMap ?? {};
  const castIds = new Set(reskin?.castAgentIds ?? []);
  const resolvePeer = (peer: string): string | undefined => {
    if (!reskin) return peer;
    return castMap[peer] ?? (castIds.has(peer) ? peer : undefined);
  };

  // Free-text lines that name a pack peer: rename mapped peers to their
  // scene name, drop lines about peers outside the cast. A text heuristic —
  // it matches display names as whole words, case-insensitively — and
  // documented as such; the structural fix is the biases map below.
  const renamePeers = (lines: readonly string[]): string[] => {
    if (!reskin) return [...lines];
    const out: string[] = [];
    for (const line of lines) {
      let renamed = line;
      let dropped = false;
      for (const peer of Object.keys(pack.relationshipBiases)) {
        const peerName = getPersonaPackById(peer)?.displayName ?? peer;
        const pattern = new RegExp(`\\b${escapeRegExp(peerName)}\\b`, "giu");
        if (!pattern.test(renamed)) continue;
        const target = resolvePeer(peer);
        if (target === undefined) { dropped = true; break; }
        const targetName = reskin.castDisplayNames?.[target] ?? target;
        renamed = renamed.replace(pattern, targetName);
      }
      if (!dropped) out.push(renamed);
    }
    return out;
  };

  // The bias map is keyed by scene id, but its prose was still the pack's
  // ("Mariana barely reacts to you…"): in a real read the band called Bea
  // "mariana" and Kai "caio" — names nobody in the scene has. The prose
  // goes through the same rename; a view that names a peer outside the
  // cast is dropped with it.
  const biases: Record<string, import("./persona-prompt-profile.js").RelationshipPromptBias> = {};
  for (const [peer, view] of Object.entries(pack.relationshipBiases)) {
    const target = resolvePeer(peer);
    if (target === undefined) continue;
    const [renamedView] = renamePeers([view]);
    if (renamedView === undefined) continue;
    biases[target] = { view: renamedView, warmth: "medium", trust: "medium", likelyBehaviors: [], triggers: [] };
  }

  const displayName = reskin?.scenarioContext?.displayName ?? pack.displayName;
  const identityFrame =
    displayName !== pack.displayName
      ? `${RESKIN_FRAME_PREFIX(displayName)} ${pack.identityFrame}`
      : pack.identityFrame;

  return {
    personaId: pack.personaId,
    displayName,
    language: pack.language,
    identityFrame,
    coreTraits: [pack.archetype],
    valuesAndMotivations: renamePeers(pack.socialTheory),
    socialPresence: pack.edgeProfile.maskTells.length > 0
      ? pack.edgeProfile.maskTells.map(t => `Masking tell: ${t}`)
      : [],
    cognitiveStyle: pack.edgeProfile.maskTells.length > 0 ? pack.edgeProfile.maskTells : [],
    emotionalPatterns: reskin?.replacesMemories
      ? []
      : renamePeers(pack.memorySeeds.filter(m => m.unresolved).map(m => `Unresolved: ${m.summary}`)),
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
