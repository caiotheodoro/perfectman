/**
 * Shared fixtures + factory for SQLite repository tests (:memory:, no file I/O).
 * Each repository test file owns its describe + contract run; this module only
 * provides the shared arrangement so all suites stay in sync.
 */

import type {
  SimulationSettings,
  Channel,
  SimulationEvent,
  AgentState,
  Memory,
  CoreMood,
  SocialEmotions,
  RelationalState,
} from "@perfectman/shared";
import { openDatabase, closeDatabase, type DB } from "../sqlite/database.js";
import { SqliteSimulationRepository } from "../sqlite/simulation-repository.js";

export const DEFAULT_SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 10,
  llmCallBudgetPerMinute: 20,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 50000,
};

export function makeSimulationInput(id: string) {
  return {
    id,
    name: `Sim ${id}`,
    agentIds: ["a1", "a2"],
    channelIds: ["ch1"],
    settings: DEFAULT_SETTINGS,
    seed: 42,
  };
}

export function makeChannel(id: string, simulationId: string): Channel {
  return {
    id,
    simulationId,
    type: "public_channel",
    name: `#${id}`,
    createdBy: "system",
    memberAgentIds: ["a1", "a2"],
    spectatorVisible: true,
    operatorVisible: true,
    createdForMotives: [],
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const BASE_MOOD: CoreMood = {
  valence: 0.2,
  arousal: 0.4,
  stability: 0.7,
  energy: 0.6,
  circumplexAngle: 0.3,
  circumplexRadius: 0.4,
  momentumValence: 0,
  momentumArousal: 0,
};

const ZERO_SOCIAL: SocialEmotions = {
  jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
  affection: 0.3, resentment: 0, suspicion: 0, admiration: 0.2,
  contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
  desireForStatus: 0, desireForIntimacy: 0,
};

function makeRelationalState(targetAgentId: string): RelationalState {
  return {
    targetAgentId,
    trust: 0.5,
    affection: 0.4,
    resentment: 0.1,
    attraction: 0.2,
    suspicion: 0.1,
    admiration: 0.3,
    envy: 0,
    comfort: 0.6,
    threat: 0,
    curiosity: 0.4,
    desireForCloseness: 0.5,
    desireForDistance: 0.1,
    interactionCount: 5,
    lastInteractionAt: Date.now() - 60000,
    lastPositiveAt: Date.now() - 30000,
    lastNegativeAt: null,
  };
}

export function makeAgentState(agentId: string, simulationId: string): AgentState {
  return {
    agentId,
    simulationId,
    personaId: "caio",
    presence: "active",
    coreMood: { ...BASE_MOOD },
    socialEmotions: { ...ZERO_SOCIAL },
    relationalStates: new Map([
      ["a2", makeRelationalState("a2")],
      ["a3", makeRelationalState("a3")],
    ]),
    memories: [],
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function makeMemory(id: string, agentId: string, simulationId: string): Memory {
  return {
    id,
    agentId,
    simulationId,
    type: "episodic",
    subjectAgentIds: ["a2"],
    sourceEventIds: ["evt1"],
    summary: "a2 was friendly to me",
    emotionalTone: "positive",
    confidence: 0.9,
    unresolved: false,
    createdAt: Date.now(),
    lastReinforcedAt: Date.now(),
  };
}

export function makeEvent(
  simulationId: string,
  channelId: string = "ch1",
  actorId: string = "a1",
  type: SimulationEvent["type"] = "message_sent",
): SimulationEvent {
  return {
    simulationId,
    channelId,
    actorId,
    type,
    payload: { content: "hello" },
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public_channel",
    },
  };
}

/** Builds a repository-contract factory over a fresh :memory: DB seeded with simulations. */
export function makeSqliteFactory<T>(
  makeRepo: (db: DB) => T,
  simIds: string[] = ["sim1"],
) {
  return async () => {
    const db = openDatabase(":memory:");
    const simRepo = new SqliteSimulationRepository(db);
    for (const id of simIds) {
      await simRepo.create({
        id,
        name: `Test Sim ${id}`,
        agentIds: ["a1", "a2"],
        channelIds: ["ch1"],
        settings: {
          omniscientSpectatorMode: false,
          allowPrivateChannels: true,
          maxPrivateChannelsPerAgent: 3,
          maxMessagesPerMinutePerAgent: 10,
          llmCallBudgetPerMinute: 20,
          pulseIntervalMs: 3000,
          tokenBudgetPerHour: 50000,
        },
        seed: 42,
      });
    }
    return {
      repo: makeRepo(db),
      teardown: async () => closeDatabase(db),
    };
  };
}
