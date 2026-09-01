/**
 * Shared fixtures for PulseScheduler tests.
 * Defaults target the stagnation-window suite ("agent_1" in "sim_stag");
 * pass overrides to makeAgentState for other ids.
 */
import type {
  ActionEmotions,
  AgentState,
  EngineSnapshot,
  EngineStepResult,
  PersonaConfig,
  SimulationSettings,
} from "@perfectman/shared";

export const SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 20,
  llmCallBudgetPerMinute: 10,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 1_000_000,
};

export function makeAgentState(overrides: Partial<AgentState> = {}): AgentState {
  const agentId = overrides.agentId ?? "agent_1";
  return {
    agentId,
    simulationId: "sim_stag",
    personaId: `persona_${agentId}`,
    presence: "active",
    coreMood: { valence: 0, arousal: 0.5, stability: 0.8, energy: 0.6, circumplexAngle: 0, circumplexRadius: 0.5, momentumValence: 0, momentumArousal: 0 },
    socialEmotions: { jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0, resentment: 0, suspicion: 0, admiration: 0, contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0 },
    relationalStates: new Map(),
    memories: [],
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function makePersona(agentId: string): PersonaConfig {
  return {
    id: `persona_${agentId}`,
    name: `Agent ${agentId}`,
    archetype: "test",
    writingStyle: "casual",
    styleExamples: [],
    baselineValence: 0,
    baselineArousal: 0.5,
    baselineStability: 0.8,
    baselineEnergy: 0.6,
    emotionalReactivity: 0.5,
    moodInertia: 0.5,
    maxMoodRotation: 0.5,
    energyRegen: 0.05,
    exclusionSensitivity: 0.5,
    praiseSensitivity: 0.5,
    conflictSensitivity: 0.5,
    boredomSensitivity: 0.5,
    intimacySensitivity: 0.5,
    socialSensitivities: {},
  };
}

export const ZERO_ACTION: ActionEmotions = {
  defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0, resentfulColdness: 0,
  curiousApproach: 0, anxiousOverreach: 0, pridefulPerformance: 0, vulnerableRetreat: 0,
  contemptuousDismissal: 0, strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0,
  dominanceAssertion: 0, repairImpulse: 0,
};

export function cannedNoOpStep(snap: EngineSnapshot): EngineStepResult {
  const agentId = snap.agentState.agentId;
  return {
    visibleEvents: [],
    newEvents: [],
    attentionResults: { noticed: false, dueScore: 0, reasons: [], needsLLM: false, triggeringReason: "test" },
    perceptionPacket: {
      agentId, triggeringEvent: null, visibleContextEvents: [], ownRecentUtterances: [], involvedPeople: [],
      relevantChannels: [], relevantMemories: [],
      translatedEmotionalState: { summary: "", emotions: [] },
      availableActions: [],
    },
    interpretations: [],
    emotionDelta: { coreMoodDelta: {}, socialEmotionDeltas: {}, relationalDeltas: new Map(), ruminationApplied: false },
    updatedAgentState: makeAgentState({ agentId, simulationId: snap.simulation.id }),
    motivations: [],
    pressures: [],
    inhibitions: [],
    actionEmotions: ZERO_ACTION,
    decision: { outcome: "no_op", needsLLM: false, initiativeProceed: false, noOpReason: "test", privateMotiveSeed: "x" },
    availableActions: [],
    initiativeCandidates: [],
    memoryProposals: [],
    noOpRecord: null,
    operatorMetrics: { pulseIndex: 0, pulseDurationMs: 10, agentsCalled: 0, eventsCommitted: 0, llmCallsMade: 0, budgetUsedPercent: 0 },
  };
}

/** Numeric fields a stagnation_metrics operator payload must surface — the seven metric keys plus the composite score. */
export const STAGNATION_METRIC_KEYS = [
  "bdi", "rdv", "ige", "cue", "eri", "isd", "cns", "compositeScore",
] as const;
