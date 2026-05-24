/**
 * Types for the LLM-facing translated emotional state.
 * Moved to shared so PerceptionPacket can reference them without circular deps.
 */

export type RelationalFlavor = {
  targetAgentId: string;
  description:   string;
};

export type TranslatedEmotionalState = {
  /** Section 4: subjective mood paragraph */
  moodDescription:    string;
  /** Section 4: notable social emotions (empty if nothing salient) */
  socialContext:      string;
  /** Section 4: relational flavors for people in scope */
  relationalFlavors:  RelationalFlavor[];
  /** Section 5: pressures as felt urges */
  pressureDescriptions: string[];
  /** Section 5: inhibitions as felt blocks */
  inhibitionDescriptions: string[];
};

/**
 * PromptPurpose gates which PersonaPromptProfile fields are injected into a
 * built prompt. Each value maps to a distinct LLM call surface.
 *
 * Only "action_intent" is active in V1. Future values are reserved and must
 * not be passed to PromptBuilder until their build paths are implemented.
 */
export type PromptPurpose =
  | "action_intent"           // Full persona + voice + style + output contract
  | "social_interpretation"   // Identity + relationship context only (reserved)
  | "background_reflection"   // Identity + relationship + memory only (reserved)
  | "spectator_recap";        // Narrator style only (reserved)
