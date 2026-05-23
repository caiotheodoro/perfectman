/** Layer 1: Core mood on the circumplex */
export type CoreMood = {
    valence: number;
    arousal: number;
    stability: number;
    energy: number;
    circumplexAngle: number;
    circumplexRadius: number;
    momentumValence: number;
    momentumArousal: number;
};
/** Layer 2: Social emotions — 15 dimensions [0, 1] */
export type SocialEmotions = {
    jealousy: number;
    envy: number;
    humiliation: number;
    pride: number;
    shame: number;
    affection: number;
    resentment: number;
    suspicion: number;
    admiration: number;
    contempt: number;
    neediness: number;
    socialAnxiety: number;
    fearOfExclusion: number;
    desireForStatus: number;
    desireForIntimacy: number;
};
/** Layer 3: Relational state per subject-target pair, asymmetric */
export type RelationalState = {
    targetAgentId: string;
    trust: number;
    affection: number;
    resentment: number;
    attraction: number;
    suspicion: number;
    admiration: number;
    envy: number;
    comfort: number;
    threat: number;
    curiosity: number;
    desireForCloseness: number;
    desireForDistance: number;
    interactionCount: number;
    lastInteractionAt: number | null;
    lastPositiveAt: number | null;
    lastNegativeAt: number | null;
};
/** Layer 4: Action emotions — 15 tendencies [0, 1], computed not persisted */
export type ActionEmotions = {
    defensiveness: number;
    warmth: number;
    jealousInspection: number;
    shameWithdrawal: number;
    resentfulColdness: number;
    curiousApproach: number;
    anxiousOverreach: number;
    pridefulPerformance: number;
    vulnerableRetreat: number;
    contemptuousDismissal: number;
    strategicPatience: number;
    impulsiveProvocation: number;
    comfortSeeking: number;
    dominanceAssertion: number;
    repairImpulse: number;
};
/** Impulse from event-to-impulse table */
export type MoodImpulse = {
    deltaValence: number;
    deltaArousal: number;
    magnitude: number;
    sourceEventId: string;
};
/** Change in emotional state after processing */
export type EmotionDelta = {
    coreMoodDelta: Partial<CoreMood>;
    socialEmotionDeltas: Partial<SocialEmotions>;
    relationalDeltas: Map<string, Partial<RelationalState>>;
    ruminationApplied: boolean;
};
/** Flattened emotional state (subset of AgentState for prompt assembly) */
export type EmotionalState = {
    coreMood: CoreMood;
    socialEmotions: SocialEmotions;
    relationalStates: Map<string, RelationalState>;
};
//# sourceMappingURL=emotion.types.d.ts.map