import { describe, it, expect } from "vitest";
import type {
  EngineSnapshot,
  AgentState,
  Channel,
  ChannelMembership,
  CommittedEvent,
  CoreMood,
  SocialEmotions,
  Simulation,
  SimulationSettings,
  RateLimitStatus,
  WorldSignals,
} from "@perfectman/shared";
import { CAIO, BRUNO, createSeededRng } from "@perfectman/shared";
import { runEngineStep } from "../step/run-engine-step.js";

// --- Helpers ---
const DEFAULT_SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 10,
  llmCallBudgetPerMinute: 20,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 200000,
};

const DEFAULT_SIMULATION: Simulation = {
  id: "sim1",
  name: "Test Sim",
  status: "running",
  agentIds: ["a1", "a2"],
  channelIds: ["ch1"],
  settings: DEFAULT_SETTINGS,
  seed: 42,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

const BASE_MOOD: CoreMood = {
  valence: 0.1, arousal: 0.4, stability: 0.6, energy: 0.6,
  circumplexAngle: 0.5, circumplexRadius: 0.4,
  momentumValence: 0.0, momentumArousal: 0.0,
};

const ZERO_SOCIAL: SocialEmotions = {
  jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
  affection: 0, resentment: 0, suspicion: 0, admiration: 0,
  contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
  desireForStatus: 0, desireForIntimacy: 0,
};

function makeAgent(id: string): AgentState {
  return {
    agentId: id,
    simulationId: "sim1",
    personaId: "caio",
    presence: "active",
    coreMood: BASE_MOOD,
    socialEmotions: ZERO_SOCIAL,
    relationalStates: new Map(),
    memories: [],
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}

function makeChannel(id: string): Channel {
  return {
    id,
    simulationId: "sim1",
    type: "public_channel",
    name: `#${id}`,
    createdBy: "system",
    memberAgentIds: ["a1", "a2"],
    spectatorVisible: true,
    operatorVisible: true,
    createdForMotives: [],
    status: "active",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}

function makeMembership(channelId: string, agentId: string): ChannelMembership {
  return { channelId, agentId, joinedAt: 1700000000000 };
}

function makeEvent(id: string, overrides?: Partial<CommittedEvent>): CommittedEvent {
  return {
    id,
    simulationId: "sim1",
    channelId: "ch1",
    actorId: "a2",
    type: "message_sent",
    payload: {},
    createdAt: 1700000000000,
    pulseIndex: 1,
    sourceEventIds: [],
    emotionalSalience: "medium",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public_channel",
    },
    ...overrides,
  };
}

const DEFAULT_WORLD: WorldSignals = {
  highArousalNearby: false,
  averageChannelArousal: 0.4,
  activeAgentCount: 2,
  timeSinceLastPublicMessage: 30,
  channelMessageRatePerMinute: 3,
  recentTopicShift: false,
};

const DEFAULT_RATE_LIMIT: RateLimitStatus = {
  agentId: "a1",
  messagesThisMinute: 0,
  privateChannelsCreated: 0,
  lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
  blocked: false,
};

function makeSnapshot(overrides?: Partial<EngineSnapshot>): EngineSnapshot {
  return {
    pulseIndex: 1,
    simulation: DEFAULT_SIMULATION,
    recentEventsWindow: [],
    agentState: makeAgent("a1"),
    persona: CAIO,
    channels: [makeChannel("ch1")],
    channelMembership: [makeMembership("ch1", "a1"), makeMembership("ch1", "a2")],
    relationalStates: new Map(),
    worldSignals: DEFAULT_WORLD,
    rateLimitStatus: DEFAULT_RATE_LIMIT,
    dt: 3,
    rng: createSeededRng(42),
    now: 1_700_000_000_000,
    ...overrides,
  };
}

// --- Tests ---
describe("runEngineStep", () => {
  it("updatedState has same agentId as input", () => {
    const result = runEngineStep(makeSnapshot());
    expect(result.updatedAgentState.agentId).toBe("a1");
  });

  it("offline agent returns all actions blocked", () => {
    const snapshot = makeSnapshot({
      agentState: makeAgent("a1"),
    });
    snapshot.agentState = { ...snapshot.agentState, presence: "offline" };
    const result = runEngineStep(snapshot);
    expect(result.attentionResults.noticed).toBe(false);
    expect(result.availableActions.every(a => a.blocked)).toBe(true);
  });

  it("direct mention increases attention dueScore", () => {
    const noMentionResult = runEngineStep(makeSnapshot({ recentEventsWindow: [] }));

    const mentionEvent = makeEvent("e1", {
      actorId: "a2",
      payload: { mentionedAgentIds: ["a1"] },
      emotionalSalience: "high",
    });
    const withMentionResult = runEngineStep(makeSnapshot({ recentEventsWindow: [mentionEvent] }));

    expect(withMentionResult.attentionResults.dueScore)
      .toBeGreaterThan(noMentionResult.attentionResults.dueScore);
  });

  it("newEvents advances lastProcessedEventId", () => {
    const event = makeEvent("event-100");
    const result = runEngineStep(makeSnapshot({ recentEventsWindow: [event] }));
    expect(result.updatedAgentState.lastProcessedEventId).toBe("event-100");
  });

  it("no events → lastProcessedEventId stays null", () => {
    const result = runEngineStep(makeSnapshot({ recentEventsWindow: [] }));
    expect(result.updatedAgentState.lastProcessedEventId).toBeNull();
  });

  it("initiative candidates has 17 entries", () => {
    const result = runEngineStep(makeSnapshot());
    expect(result.initiativeCandidates).toHaveLength(17);
  });

  it("action emotions all in [0, 1]", () => {
    const result = runEngineStep(makeSnapshot());
    for (const [key, val] of Object.entries(result.actionEmotions)) {
      expect(val, key).toBeGreaterThanOrEqual(0);
      expect(val, key).toBeLessThanOrEqual(1);
    }
  });

  it("decision has needsLLM true when direct mention event", () => {
    const mentionEvent = makeEvent("e1", {
      actorId: "a2",
      payload: { mentionedAgentIds: ["a1"] },
      emotionalSalience: "high",
    });
    const result = runEngineStep(makeSnapshot({ recentEventsWindow: [mentionEvent] }));
    // High salience mention should produce needsLLM=true
    expect(result.decision.needsLLM).toBe(true);
  });

  it("noOpRecord is null when decision is act", () => {
    // Force act decision by using a very salient mention
    const mentionEvent = makeEvent("e1", {
      actorId: "a2",
      payload: { mentionedAgentIds: ["a1"] },
      emotionalSalience: "critical",
    });
    const result = runEngineStep(makeSnapshot({ recentEventsWindow: [mentionEvent] }));
    if (result.decision.outcome === "act") {
      expect(result.noOpRecord).toBeNull();
    }
  });

  it("noOpRecord is set when decision is no_op", () => {
    // Empty events + no initiative = no_op
    const result = runEngineStep(makeSnapshot({ recentEventsWindow: [] }));
    if (result.decision.outcome === "no_op") {
      expect(result.noOpRecord).not.toBeNull();
      expect(result.noOpRecord!.agentId).toBe("a1");
    }
  });

  it("perceptionPacket.agentId matches snapshot agentState", () => {
    const result = runEngineStep(makeSnapshot());
    expect(result.perceptionPacket.agentId).toBe("a1");
  });

  it("availableActions contains 10 intent types", () => {
    const result = runEngineStep(makeSnapshot());
    expect(result.availableActions).toHaveLength(10);
  });

  it("deterministic output for same seed and inputs", () => {
    const snapshot1 = makeSnapshot();
    const snapshot2 = makeSnapshot();
    // Note: rumination uses module-level cooldown so can differ; focus on
    // deterministic non-rumination outputs
    const result1 = runEngineStep(snapshot1);
    const result2 = runEngineStep(snapshot2);
    expect(result1.attentionResults.dueScore).toBe(result2.attentionResults.dueScore);
    expect(result1.decision.outcome).toBe(result2.decision.outcome);
  });
});

describe("decision owns needsLLM (ADR-0015)", () => {
  it("an own high-salience event does not make attention demand the LLM", () => {
    const own = makeEvent("e1", { actorId: "a1", emotionalSalience: "high" });
    const result = runEngineStep(makeSnapshot({ recentEventsWindow: [own] }));
    expect(result.attentionResults.needsLLM).toBe(false);
  });

  it("needsLLM is exactly outcome === act, and a delay is recorded like a no-op", () => {
    const windows = [
      [],
      [makeEvent("e1", { actorId: "a1", emotionalSalience: "high" })],
      [makeEvent("e2", { actorId: "a2", emotionalSalience: "critical", payload: { mentionedAgentIds: ["a1"] } })],
    ];
    for (const recentEventsWindow of windows) {
      const result = runEngineStep(makeSnapshot({ recentEventsWindow }));
      expect(result.decision.needsLLM).toBe(result.decision.outcome === "act");
      if (result.decision.outcome === "delay") expect(result.noOpRecord).not.toBeNull();
    }
  });
});
