import { describe, it, expect } from "vitest";
import { buildAgentRuntimeInput } from "../runtime-input-builder.js";
import type { EngineStepResult, PersonaConfig, AgentState } from "@perfectman/shared";

function makeAgentState(): AgentState {
  return {
    agentId: "agent_1",
    simulationId: "sim_1",
    personaId: "persona_1",
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
  };
}

const PERSONA: PersonaConfig = {
  id: "persona_1",
  name: "Test",
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

function makeStepResult(): EngineStepResult {
  const agentState = makeAgentState();
  return {
    visibleEvents: [],
    newEvents: [],
    attentionResults: {
      noticed: true,
      dueScore: 0.8,
      reasons: [],
      needsLLM: true,
      triggeringReason: "attention_event",
    },
    perceptionPacket: {
      agentId: "agent_1",
      triggeringEvent: null,
      visibleContextEvents: [], ownRecentUtterances: [],
      involvedPeople: [],
      relevantChannels: [],
      relevantMemories: [],
      translatedEmotionalState: {
        moodDescription: "neutral",
        socialContext: "",
        relationalFlavors: [],
        pressureDescriptions: [],
        inhibitionDescriptions: [],
      },
      availableActions: [],
    },
    interpretations: [],
    emotionDelta: {
      coreMoodDelta: {},
      socialEmotionDeltas: {},
      relationalDeltas: new Map(),
      ruminationApplied: false,
    },
    updatedAgentState: agentState,
    motivations: [],
    pressures: [],
    inhibitions: [],
    actionEmotions: {
      defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0,
      resentfulColdness: 0, curiousApproach: 0, anxiousOverreach: 0, pridefulPerformance: 0,
      vulnerableRetreat: 0, contemptuousDismissal: 0, strategicPatience: 0,
      impulsiveProvocation: 0, comfortSeeking: 0, dominanceAssertion: 0, repairImpulse: 0,
    },
    decision: {
      outcome: "act",
      needsLLM: true,
      initiativeProceed: false,
      privateMotiveSeed: "seed",
    },
    availableActions: [],
    initiativeCandidates: [],
    memoryProposals: [],
    noOpRecord: null,
    operatorMetrics: {
      pulseIndex: 1,
      pulseDurationMs: 10,
      agentsCalled: 1,
      eventsCommitted: 0,
      llmCallsMade: 0,
      budgetUsedPercent: 0,
    },
  };
}

describe("buildAgentRuntimeInput", () => {
  it("maps simulationId and agentId from stepResult", () => {
    const result = makeStepResult();
    const input = buildAgentRuntimeInput(result, PERSONA, "normal");
    expect(input.simulationId).toBe("sim_1");
    expect(input.agentId).toBe("agent_1");
  });

  it("attaches personaConfig", () => {
    const result = makeStepResult();
    const input = buildAgentRuntimeInput(result, PERSONA, "normal");
    expect(input.personaConfig).toBe(PERSONA);
  });

  it("maps availableActions from stepResult", () => {
    const result = makeStepResult();
    const input = buildAgentRuntimeInput(result, PERSONA, "high");
    expect(input.availableActions).toEqual(result.availableActions);
  });

  it("maps triggeringReason from attentionResults", () => {
    const result = makeStepResult();
    const input = buildAgentRuntimeInput(result, PERSONA, "normal");
    expect(input.triggeringReason).toBe("attention_event");
  });

  it("maps emotionalState from updatedAgentState", () => {
    const result = makeStepResult();
    const input = buildAgentRuntimeInput(result, PERSONA, "normal");
    expect(input.emotionalState.coreMood).toEqual(result.updatedAgentState.coreMood);
  });
});
