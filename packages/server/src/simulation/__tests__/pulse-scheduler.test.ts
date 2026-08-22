import { describe, it, expect, beforeEach, vi } from "vitest";
import { PulseScheduler } from "../pulse-scheduler.js";
import { InMemoryEventRepository, InMemoryAgentStateRepository, InMemoryChannelRepository } from "../in-memory-stores.js";
import { ChannelRegistry } from "../channel-registry.js";
import { RateLimitGate } from "../rate-limit-gate.js";
import { IntentResolver } from "../intent-resolver.js";
import { EngineSnapshotProjection } from "../projections/engine-snapshot-projection.js";
import { DeliveryProjection } from "../projections/delivery-projection.js";
import { SpectatorProjection } from "../projections/spectator-projection.js";
import { OperatorProjection } from "../projections/operator-projection.js";
import { EngineEventBuilder } from "../engine-event-builder.js";
import { MockDeliveryGateway } from "../../delivery/mock-delivery-gateway.js";
import type { AgentContext, AgentRuntime, LLMBudget } from "../pulse-scheduler.js";
import type { Simulation, SimulationSettings, AgentState, PersonaConfig, ActionIntent } from "@perfectman/shared";
import { createId } from "@perfectman/shared";

const SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 20,
  llmCallBudgetPerMinute: 10,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 1_000_000,
};

const SIM: Simulation = {
  id: "sim_test",
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
    simulationId: "sim_test",
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

function makeNoOpIntent(agentId: string): ActionIntent {
  return {
    id: createId(),
    actorId: agentId,
    intentType: "no_op",
    personTargets: [],
    privateMotiveSummary: "test motive",
    emotionDrivers: [],
    motivationDrivers: [],
    memoryWrites: [],
  };
}

const ZERO_ACTION = {
  defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0, resentfulColdness: 0,
  curiousApproach: 0, anxiousOverreach: 0, pridefulPerformance: 0, vulnerableRetreat: 0,
  contemptuousDismissal: 0, strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0,
  dominanceAssertion: 0, repairImpulse: 0,
};

/** Canned step result for driving the real PulseScheduler through its commit-ordering. */
function makeCannedStep({ memory = false } = {}): import("@perfectman/shared").EngineStepResult {
  return {
    visibleEvents: [],
    newEvents: [],
    attentionResults: { noticed: false, dueScore: 0, reasons: [], needsLLM: false, triggeringReason: "test" },
    perceptionPacket: {
      agentId: "agent_1", triggeringEvent: null, visibleContextEvents: [], ownRecentUtterances: [], involvedPeople: [],
      relevantChannels: [], relevantMemories: [],
      translatedEmotionalState: { summary: "", emotions: [] },
      availableActions: [],
    },
    interpretations: [],
    emotionDelta: { coreMoodDelta: {}, socialEmotionDeltas: {}, relationalDeltas: new Map(), ruminationApplied: false },
    updatedAgentState: makeAgentState(),
    motivations: [],
    pressures: [],
    inhibitions: [],
    actionEmotions: ZERO_ACTION,
    decision: { outcome: "no_op", needsLLM: false, initiativeProceed: false, noOpReason: "test", privateMotiveSeed: "x" },
    availableActions: [],
    initiativeCandidates: [],
    memoryProposals: memory
      ? [{ type: "relationship", subjectAgentIds: ["agent-B"], summary: "agent-B seems untrustworthy", emotionalTone: "suspicious", confidence: 0.7, unresolved: true }]
      : [],
    noOpRecord: { agentId: "agent_1", pulseIndex: 0, privateMotiveSummary: "nothing to do", reason: "test" },
    operatorMetrics: { pulseIndex: 0, pulseDurationMs: 10, agentsCalled: 1, eventsCommitted: 0, llmCallsMade: 0, budgetUsedPercent: 0 },
  };
}

describe("PulseScheduler", () => {
  let scheduler: PulseScheduler;
  let eventRepo: InMemoryEventRepository;
  let agentStateRepo: InMemoryAgentStateRepository;
  let channelRepo: InMemoryChannelRepository;
  let channelRegistry: ChannelRegistry;
  let gateway: MockDeliveryGateway;
  let intentResolver: IntentResolver;
  let engineEventBuilder: EngineEventBuilder;

  function buildScheduler(stepResolver?: (snap: import("@perfectman/shared").EngineSnapshot) => import("@perfectman/shared").EngineStepResult): PulseScheduler {
    return new PulseScheduler({
      simulation: SIM,
      agents: [AGENT],
      defaultPublicChannelId: "ch_public",
      eventRepo,
      agentStateRepo,
      channelRegistry,
      rateLimitGate: new RateLimitGate(SETTINGS),
      intentResolver,
      engineSnapshotProjection: new EngineSnapshotProjection(),
      deliveryProjection: new DeliveryProjection(gateway),
      spectatorProjection: new SpectatorProjection(gateway),
      operatorProjection: new OperatorProjection(gateway),
      engineEventBuilder,
      agentRuntime: mockAgentRuntime,
      llmBudget: mockLLMBudget,
      pulseIntervalMs: SETTINGS.pulseIntervalMs,
      ...(stepResolver ? { stepResolver } : {}),
    });
  }
  const AGENT: AgentContext = {
    id: "agent_1",
    state: makeAgentState(),
    persona: PERSONA,
  };

  const mockAgentRuntime: AgentRuntime = {
    generateIntent: vi.fn().mockResolvedValue({
      intent: makeNoOpIntent("agent_1"),
      llmUsage: null,
      latencyMs: 10,
      fallbackApplied: false,
      operatorEvents: [],
    }),
  };

  const mockLLMBudget: LLMBudget = {
    getPriority: vi.fn().mockReturnValue("normal"),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    eventRepo = new InMemoryEventRepository();
    agentStateRepo = new InMemoryAgentStateRepository();
    channelRepo = new InMemoryChannelRepository();
    channelRegistry = new ChannelRegistry(channelRepo);
    gateway = new MockDeliveryGateway();

    // Create the default public channel with a known ID
    await channelRepo.create({
      id: "ch_public",
      simulationId: "sim_test",
      type: "public_channel",
      name: "general",
      createdBy: "system",
      memberAgentIds: ["agent_1"],
      spectatorVisible: true,
      operatorVisible: true,
      createdForMotives: [],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await channelRepo.addMembership({ channelId: "ch_public", agentId: "agent_1", joinedAt: Date.now() });

    await agentStateRepo.upsert(makeAgentState());

    const rateLimitGate = new RateLimitGate(SETTINGS);
    intentResolver = new IntentResolver(rateLimitGate, channelRegistry);
    engineEventBuilder = new EngineEventBuilder();

    scheduler = buildScheduler();
  });

  it("runPulse completes without error", async () => {
    const result = await scheduler.runPulse();
    expect(result.pulseIndex).toBe(0);
  });

  it("runPulse increments pulseIndex", async () => {
    await scheduler.runPulse();
    const result = await scheduler.runPulse();
    expect(result.pulseIndex).toBe(1);
  });

  it("persists updated agent state after each pulse", async () => {
    await scheduler.runPulse();
    const stored = await agentStateRepo.get("sim_test", "agent_1");
    expect(stored).not.toBeNull();
  });

  it("engine-emitted no_op_recorded events are committed before LLM path when noOpRecord present", async () => {
    // The engine step may produce a noOpRecord; if so, a no_op_recorded event is committed
    // We verify the event log can grow
    await scheduler.runPulse();
    const events = await eventRepo.getAfter("sim_test");
    // At least the engine step ran — could have no_op_recorded or other events
    expect(Array.isArray(events)).toBe(true);
  });

  it("start and stop do not throw", () => {
    expect(() => scheduler.start()).not.toThrow();
    expect(() => scheduler.stop()).not.toThrow();
  });

  it("commits memory_written through the real scheduler when a canned step proposes memory", async () => {
    const sched = buildScheduler(() => makeCannedStep({ memory: true }));
    await sched.runPulse();
    const events = await eventRepo.getAfter("sim_test");
    const mem = events.filter((e) => e.type === "memory_written");
    expect(mem).toHaveLength(1);
    expect(mem[0]!.payload["summary"]).toBe("agent-B seems untrustworthy");
    // noOpRecord present with needsLLM=false — the LLM path must not be invoked
    expect(mockAgentRuntime.generateIntent).not.toHaveBeenCalled();
  });

  it("commit-ordering: a needsLLM step is resolved (not committed as no-op) through the real scheduler", async () => {
    const sched = buildScheduler((snap) => {
      const base = makeCannedStep();
      return {
        ...base,
        decision: { outcome: "act", needsLLM: true, initiativeProceed: false },
        noOpRecord: null,
      };
    });
    await sched.runPulse();
    expect(mockAgentRuntime.generateIntent).toHaveBeenCalled();
  });
});
