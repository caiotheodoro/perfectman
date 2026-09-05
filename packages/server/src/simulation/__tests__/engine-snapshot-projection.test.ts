import { describe, it, expect } from "vitest";
import { EngineSnapshotProjection } from "../projections/engine-snapshot-projection.js";
import { createSeededRng } from "@perfectman/shared";
import type {
  AgentState,
  Simulation,
  SimulationSettings,
  PersonaConfig,
} from "@perfectman/shared";

const SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 20,
  llmCallBudgetPerMinute: 10,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 1_000_000,
};

const SIMULATION: Simulation = {
  id: "sim_1",
  name: "test",
  status: "running",
  agentIds: ["agent_1"],
  channelIds: ["ch_public"],
  settings: SETTINGS,
  seed: 42,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

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
  name: "Test Agent",
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

describe("EngineSnapshotProjection", () => {
  it("builds an EngineSnapshot with all required fields", () => {
    const projection = new EngineSnapshotProjection();
    const rng = createSeededRng(42);
    const snapshot = projection.build({
      pulseIndex: 1,
      simulation: SIMULATION,
      recentEventsWindow: [],
      now: Date.now(),
      agentState: makeAgentState(),
      persona: PERSONA,
      channels: [],
      membership: [],
      relationalStates: new Map(),
      worldSignals: {
        highArousalNearby: false,
        averageChannelArousal: 0.5,
        activeAgentCount: 1,
        timeSinceLastPublicMessage: 60,
        channelMessageRatePerMinute: 0,
        recentTopicShift: false,
      },
      rateLimitStatus: {
        agentId: "agent_1",
        messagesThisMinute: 0,
        privateChannelsCreated: 0,
        lastActionAt: null,
        blocked: false,
      },
      dt: 3.0,
      rng,
    });

    expect(snapshot.pulseIndex).toBe(1);
    expect(snapshot.simulation.id).toBe("sim_1");
    expect(snapshot.agentState.agentId).toBe("agent_1");
    expect(snapshot.dt).toBe(3.0);
    expect(snapshot.rng).toBe(rng);
    expect(snapshot.channelMembership).toEqual([]);
  });

  it("passes ownHistoryWindow through and leaves it absent when not supplied", () => {
    const projection = new EngineSnapshotProjection();
    const base = {
      pulseIndex: 1, simulation: SIMULATION, recentEventsWindow: [], now: Date.now(), agentState: makeAgentState(), persona: PERSONA,
      channels: [], membership: [], relationalStates: new Map(),
      worldSignals: { highArousalNearby: false, averageChannelArousal: 0.5, activeAgentCount: 1, timeSinceLastPublicMessage: 60, channelMessageRatePerMinute: 0, recentTopicShift: false },
      rateLimitStatus: { agentId: "agent_1", messagesThisMinute: 0, privateChannelsCreated: 0, lastActionAt: null, blocked: false },
      dt: 1, rng: createSeededRng(1),
    };
    expect(projection.build(base).ownHistoryWindow).toBeUndefined();
    const own = { ...base, ownHistoryWindow: [] as import("@perfectman/shared").CommittedEvent[] };
    expect(projection.build(own).ownHistoryWindow).toEqual([]);
  });
});
