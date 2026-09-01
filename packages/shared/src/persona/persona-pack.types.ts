/**
 * PersonaPack — the canonical, filled-in definition of a persona.
 *
 * Bridges the three persona systems:
 *  - PersonaConfig        (engine calibration — lives in constants/personas.ts)
 *  - PersonaPromptProfile (LLM-facing compiled artifact — lives in server)
 *  - PersonaPack          (this — the authored source of truth: voice, memory
 *                          seeds, masking tells, private motive lexicon, and
 *                          the "unhinged" edge profile)
 *
 * A PersonaPack is authored data (questionnaire-filled), not derived.
 */

import type { Memory } from "../memory/memory.types.js";

export type MemorySeed = {
  type: Memory["type"];
  subjectAgentIds: string[];
  summary: string;
  emotionalTone: string;
  confidence: number;
  intensity?: number; // [0, 1]
  unresolved: boolean;
};

export type PendingIntention = {
  summary: string;
  urgency: "low" | "medium" | "high";
  source: string;
};

export type ChaosCap = "low" | "medium" | "high";

/** The anti-tame spec: what pushes this persona to edge behavior, and how far. */
export type EdgeProfile = {
  chaosCap: ChaosCap;
  /** Chaotic moves this persona may pull when pressure spikes. */
  impulseBehaviors: string[];
  /** Specific trigger → behavior mappings (feed the pressure/prompt layer). */
  triggers: {
    trigger: string;
    behavior: string;
    /** which pressure type it feeds (e.g. urge_to_mock, urge_to_withdraw). */
    pressure: string;
    sensitivity: number;
  }[];
  /** How this persona masks what it feels. */
  maskTells: string[];
  /** Canonical hidden motives this persona is prone to. */
  privateMotiveLexicon: string[];
  /** Things that will NOT happen even at peak pressure (safety bounds). */
  hardLimits: string[];
};

export type PresenceProfile = {
  responseDelayMs: [number, number];
  silenceTolerancePulses: number;
  messageLength: "short" | "medium" | "long" | "rapid_fire";
  punctuationTells: string[];
};

export type PersonaPack = {
  personaId: string;
  displayName: string;
  archetype: string;
  /** Rich first-person identity frame for the prompt. */
  identityFrame: string;
  voiceGuidelines: string[];
  styleExamples: string[];
  relationshipBiases: Record<string, string>;
  language: "pt-BR" | "en";
  /** Memory seeds — biased, emotional, often unresolved. */
  memorySeeds: MemorySeed[];
  pendingIntentions: PendingIntention[];
  socialTheory: string[];
  edgeProfile: EdgeProfile;
  presenceProfile: PresenceProfile;
  /** LLM sampling for this persona. */
  sampling: {
    temperature: number;
    repetitionPenalty: number;
    topP: number;
    maxTokens: number;
  };
};
