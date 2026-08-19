/**
 * Shared fixtures for engine dynamics branch tests (derive-motivations,
 * compute-inhibitions, compute-pressures, emotion functions).
 */
import type {
  CoreMood,
  SocialEmotions,
  ActionEmotions,
  RelationalState,
  AgentState,
  PersonaConfig,
  CommittedEvent,
} from "@perfectman/shared";
import { CAIO } from "@perfectman/shared";

export const BASE_MOOD: CoreMood = {
  valence: 0.0,
  arousal: 0.5,
  stability: 0.5,
  energy: 0.5,
  circumplexAngle: 0,
  circumplexRadius: 0.4,
  momentumValence: 0,
  momentumArousal: 0,
};

export const ZERO_SOCIAL: SocialEmotions = {
  jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
  affection: 0, resentment: 0, suspicion: 0, admiration: 0, contempt: 0,
  neediness: 0, socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0,
};

export const ZERO_ACTION: ActionEmotions = {
  defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0, resentfulColdness: 0,
  curiousApproach: 0, anxiousOverreach: 0, pridefulPerformance: 0, vulnerableRetreat: 0,
  contemptuousDismissal: 0, strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0,
  dominanceAssertion: 0, repairImpulse: 0,
};

export function makeSocial(overrides: Partial<SocialEmotions> = {}): SocialEmotions {
  return { ...ZERO_SOCIAL, ...overrides };
}

export function makeMood(overrides: Partial<CoreMood> = {}): CoreMood {
  return { ...BASE_MOOD, ...overrides };
}

export function makeActionEmotions(overrides: Partial<ActionEmotions> = {}): ActionEmotions {
  return { ...ZERO_ACTION, ...overrides };
}

export function makeRelational(overrides: Partial<RelationalState> = {}): RelationalState {
  return {
    targetAgentId: "other",
    trust: 0, affection: 0, resentment: 0, attraction: 0, suspicion: 0, admiration: 0,
    envy: 0, comfort: 0, threat: 0, curiosity: 0, desireForCloseness: 0, desireForDistance: 0,
    interactionCount: 0, lastInteractionAt: null, lastPositiveAt: null, lastNegativeAt: null,
    ...overrides,
  };
}

export function makeRels(...states: Partial<RelationalState>[]): Map<string, RelationalState> {
  const map = new Map<string, RelationalState>();
  for (const s of states) {
    const r = makeRelational(s);
    if (r.targetAgentId) map.set(r.targetAgentId, r);
  }
  return map;
}

export function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    agentId: "a1",
    simulationId: "sim1",
    personaId: "caio",
    presence: "active",
    coreMood: { ...BASE_MOOD },
    socialEmotions: { ...ZERO_SOCIAL },
    relationalStates: new Map(),
    memories: [],
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

export function makePersona(overrides: Partial<PersonaConfig> = {}): PersonaConfig {
  return {
    ...CAIO,
    ...overrides,
    // Default sensitivities high enough that single-signal thresholds trip
    socialSensitivities: {
      ...CAIO.socialSensitivities,
      ...(overrides.socialSensitivities ?? {}),
    },
  };
}

export function makeEvent(
  type: CommittedEvent["type"],
  overrides: Partial<CommittedEvent> = {},
): CommittedEvent {
  return {
    simulationId: "sim1",
    channelId: "ch1",
    actorId: "other",
    type,
    payload: {},
    sourceEventIds: [],
    emotionalSalience: "low",
    pulseIndex: 0,
    id: `evt-${Math.random()}`,
    createdAt: 1_700_000_000_000,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public",
    },
    ...overrides,
  };
}
