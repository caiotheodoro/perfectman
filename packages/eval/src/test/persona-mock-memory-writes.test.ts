import { describe, expect, it } from "vitest";
import {
  ALL_PERSONAS,
  type AgentRuntimeInput,
  type MemorySeed,
  type PersonaPack,
} from "@perfectman/shared";
import type { AgentRuntimeContext, BuiltPrompt } from "@perfectman/server";
import { PersonaAwareMockProvider } from "../bench/persona-aware-mock.js";

const CONTEXT: AgentRuntimeContext = { pulseIndex: 0, now: 0 };
const PROMPT: BuiltPrompt = {
  system: "sys",
  user: "user",
  inputTokensEstimate: 10,
  purpose: "action_intent",
  version: "v1",
  templateVersion: "t1",
};

function makePack(seed: MemorySeed): PersonaPack {
  return {
    personaId: "bruno",
    displayName: "Bruno",
    archetype: "observer",
    identityFrame: "x",
    voiceGuidelines: [],
    styleExamples: ["normal gesture"],
    relationshipBiases: {},
    language: "pt-BR",
    memorySeeds: [seed],
    pendingIntentions: [],
    socialTheory: [],
    edgeProfile: {
      chaosCap: "medium",
      impulseBehaviors: [],
      triggers: [],
      maskTells: [],
      privateMotiveLexicon: ["I want to be seen."],
      hardLimits: [],
    },
    presenceProfile: {
      responseDelayMs: [2000, 15000],
      silenceTolerancePulses: 6,
      messageLength: "short",
      punctuationTells: [],
    },
    sampling: { temperature: 0.7, repetitionPenalty: 1.1, topP: 0.9, maxTokens: 256 },
  };
}

function makeInput(): AgentRuntimeInput {
  return {
    simulationId: "sim-1",
    agentId: "agent-a",
    personaConfig: ALL_PERSONAS[0]!,
    perceptionPacket: {
      agentId: "agent-a",
      triggeringEvent: null,
      visibleContextEvents: [],
      eventHandles: {},
      ownRecentUtterances: [],
      involvedPeople: [],
      relevantChannels: [],
      relevantMemories: [],
      translatedEmotionalState: {
        moodDescription: "Neutral.",
        socialContext: "Calm.",
        relationalFlavors: [],
        pressureDescriptions: [],
        inhibitionDescriptions: [],
      },
      availableActions: [],
    },
    emotionalState: {
      coreMood: {
        valence: 0,
        arousal: 0,
        stability: 0.5,
        energy: 0.5,
        circumplexAngle: 0,
        circumplexRadius: 0,
        momentumValence: 0,
        momentumArousal: 0,
      },
      socialEmotions: {
        jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0,
        resentment: 0, suspicion: 0.9, admiration: 0, contempt: 0, neediness: 0,
        socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0,
      },
      relationalStates: new Map(),
    },
    activeMotivations: [],
    activePressures: [],
    activeInhibitions: [],
    relevantMemories: [],
    availableActions: [
      { intentType: "send_message", channelTargets: ["general"], personTargets: [], blocked: false },
    ],
    budgetPriority: "normal",
    triggeringReason: "cold_start",
  };
}

type MockIntent = { intentType: string; memoryWrites: { intensity: number }[] };

describe("PersonaAwareMockProvider memory-write intensity", () => {
  it.each([
    { label: "defaults a seed without intensity to 0 (unchanged behavior)", seed: {}, expected: 0 },
    { label: "carries the seed's intensity onto the proposal", seed: { intensity: 0.7 }, expected: 0.7 },
  ])("$label", async ({ seed, expected }) => {
    const provider = new PersonaAwareMockProvider(
      makePack({
        type: "relationship",
        subjectAgentIds: ["agent-b"],
        summary: "agent-b never replies first",
        emotionalTone: "ache",
        confidence: 0.7,
        unresolved: true,
        ...seed,
      }),
      42,
    );

    const result = await provider.generateIntent(makeInput(), CONTEXT, PROMPT);
    const intent = JSON.parse(result.content) as MockIntent;

    expect(intent.intentType).toBe("send_message");
    expect(intent.memoryWrites).toHaveLength(1);
    expect(intent.memoryWrites[0]!.intensity).toBe(expected);
  });
});
