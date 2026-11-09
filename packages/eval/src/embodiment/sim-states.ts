import type { AgentState, CoreMood, RelationalState, SocialEmotions } from "@perfectman/shared";

/**
 * An actor's feelings at the start of a sim: the engine's `AgentState` with the quiet defaults filled in, so a scenario (a preset's cast
 * block, a bench scenario) only says what is not quiet.
 */
const QUIET_SOCIAL: SocialEmotions = {
  jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0, resentment: 0, suspicion: 0, admiration: 0, contempt: 0,
  neediness: 0, socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0,
};

const QUIET_MOOD: CoreMood = { valence: 0.1, arousal: 0.5, stability: 0.8, energy: 0.6, circumplexAngle: 0, circumplexRadius: 0.5, momentumValence: 0, momentumArousal: 0 };

export function quietRelation(target: string, over: Partial<RelationalState> = {}): RelationalState {
  return {
    targetAgentId: target, trust: 0.4, affection: 0.2, resentment: 0, attraction: 0.1, suspicion: 0.1, admiration: 0.1, envy: 0, comfort: 0.4, threat: 0,
    curiosity: 0.2, desireForCloseness: 0.3, desireForDistance: 0.1, interactionCount: 3, lastInteractionAt: 0, lastPositiveAt: null, lastNegativeAt: null, ...over,
  };
}

export type SeedRelations = Record<string, Partial<RelationalState>>;

export function seedState(ref: string, o: { simulationId?: string; mood?: Partial<CoreMood>; social?: Partial<SocialEmotions>; relations?: SeedRelations; others: readonly string[] }): AgentState {
  const relations = new Map<string, RelationalState>(o.others.filter((r) => r !== ref).map((r) => [r, quietRelation(r, o.relations?.[r])]));
  return {
    agentId: ref, simulationId: o.simulationId ?? "drama-sim", personaId: ref, presence: "active",
    coreMood: { ...QUIET_MOOD, ...o.mood }, socialEmotions: { ...QUIET_SOCIAL, ...o.social }, relationalStates: relations,
    memories: [], initiativeAccumulators: [], lastProcessedEventId: null, lastActionAt: null, lastRuminationPulse: null, arrivalPulse: null, createdAt: 0, updatedAt: 0,
  };
}
