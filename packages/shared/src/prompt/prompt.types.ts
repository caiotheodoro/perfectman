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
