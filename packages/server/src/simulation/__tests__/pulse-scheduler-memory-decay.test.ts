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
import type { Simulation, SimulationSettings, AgentState, PersonaConfig, ActionIntent, Memory } from "@perfectman/shared";
import { createId } from "@perfectman/shared";

/**
 * Issue #137 — power-law decay, emotional protection, eviction, and
 * recall reinforcement, exercised through the real PulseScheduler. Split out
 * of pulse-scheduler.test.ts to stay under the per-file test cap (Q4);
 * pure-function coverage of the decay/eviction math itself lives in
 * packages/engine/src/perception/__tests__/memory-salience.test.ts.
 */

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

function makeAgentState(agentId = "agent_1"): AgentState {
  return {
    agentId,
    simulationId: "sim_test",
    personaId: `persona_${agentId.split("_")[1] ?? "1"}`,
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
function makeCannedStep({ agentId = "agent_1" } = {}): import("@perfectman/shared").EngineStepResult {
  return {
    visibleEvents: [],
    newEvents: [],
    attentionResults: { noticed: false, dueScore: 0, reasons: [], needsLLM: false, triggeringReason: "test" },
    perceptionPacket: {
      agentId, triggeringEvent: null, visibleContextEvents: [], eventHandles: {}, ownRecentUtterances: [], involvedPeople: [],
      relevantChannels: [], relevantMemories: [],
      translatedEmotionalState: { summary: "", emotions: [] },
      availableActions: [],
    },
    interpretations: [],
    emotionDelta: { coreMoodDelta: {}, socialEmotionDeltas: {}, relationalDeltas: new Map(), ruminationApplied: false },
    updatedAgentState: makeAgentState(agentId),
    motivations: [],
    pressures: [],
    inhibitions: [],
    actionEmotions: ZERO_ACTION,
    decision: { outcome: "no_op", needsLLM: false, initiativeProceed: false, noOpReason: "test", privateMotiveSeed: "x" },
    availableActions: [],
    initiativeCandidates: [],
    memoryProposals: [],
    noOpRecord: { agentId, pulseIndex: 0, privateMotiveSummary: "nothing to do", reason: "test" },
    operatorMetrics: { pulseIndex: 0, pulseDurationMs: 10, agentsCalled: 1, eventsCommitted: 0, llmCallsMade: 0, budgetUsedPercent: 0 },
  };
}

function agedMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "mem",
    agentId: "agent_1",
    simulationId: "sim_test",
    type: "episodic",
    subjectAgentIds: [],
    sourceEventIds: [],
    summary: "a memory",
    emotionalTone: "neutral",
    confidence: 0.5,
    intensity: 0,
    unresolved: false,
    createdAt: 0,
    lastReinforcedAt: 0,
    ...overrides,
  };
}

describe("PulseScheduler memory decay, eviction, and reinforcement (issue #137)", () => {
  let scheduler: PulseScheduler;
  let eventRepo: InMemoryEventRepository;
  let agentStateRepo: InMemoryAgentStateRepository;
  let channelRepo: InMemoryChannelRepository;
  let channelRegistry: ChannelRegistry;
  let gateway: MockDeliveryGateway;
  let intentResolver: IntentResolver;
  let engineEventBuilder: EngineEventBuilder;

  function buildScheduler(stepResolver: (snap: import("@perfectman/shared").EngineSnapshot) => import("@perfectman/shared").EngineStepResult): PulseScheduler {
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
      stepResolver,
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

    scheduler = buildScheduler(() => makeCannedStep());
  });

  it("reinforces a memory surfaced by memory selection: bumps lastReinforcedAt and emits memory_reinforced", async () => {
    const surfaced = agedMemory({ id: "mem_surfaced" });
    scheduler = buildScheduler(() => ({
      ...makeCannedStep(),
      updatedAgentState: { ...makeAgentState(), memories: [surfaced] },
      perceptionPacket: { ...makeCannedStep().perceptionPacket, relevantMemories: [surfaced] },
    }));
    await scheduler.runPulse();

    const state = await agentStateRepo.get("sim_test", "agent_1");
    const persisted = state?.memories.find((m) => m.id === "mem_surfaced");
    expect(persisted?.lastReinforcedAt).toBe(SETTINGS.pulseIntervalMs); // pulse 0's simulated now

    const reinforcedEvents = gateway.operatorEvents.filter((e) => e.type === "memory_reinforced");
    expect(
      reinforcedEvents.some((e) => (e.data as { memoryId?: string } | undefined)?.memoryId === "mem_surfaced"),
    ).toBe(true);
  });

  it("does not reinforce a memory that memory selection did not surface", async () => {
    const notSurfaced = agedMemory({ id: "mem_not_surfaced" });
    scheduler = buildScheduler(() => ({
      ...makeCannedStep(),
      updatedAgentState: { ...makeAgentState(), memories: [notSurfaced] },
    }));
    await scheduler.runPulse();

    const state = await agentStateRepo.get("sim_test", "agent_1");
    const persisted = state?.memories.find((m) => m.id === "mem_not_surfaced");
    expect(persisted?.lastReinforcedAt).toBe(0);

    const reinforcedEvents = gateway.operatorEvents.filter((e) => e.type === "memory_reinforced");
    expect(
      reinforcedEvents.some((e) => (e.data as { memoryId?: string } | undefined)?.memoryId === "mem_not_surfaced"),
    ).toBe(false);
  });

  it("evicts a low-confidence, aged (>20 pulses), non-unresolved memory", async () => {
    const stale = agedMemory({
      id: "mem_stale",
      confidence: 0.03,
      unresolved: false,
      lastReinforcedAt: -100 * SETTINGS.pulseIntervalMs,
    });
    scheduler = buildScheduler(() => ({
      ...makeCannedStep(),
      updatedAgentState: { ...makeAgentState(), memories: [stale] },
    }));
    await scheduler.runPulse();

    const state = await agentStateRepo.get("sim_test", "agent_1");
    expect(state?.memories.some((m) => m.id === "mem_stale")).toBe(false);
  });

  it("keeps an unresolved memory of the same age/confidence (Zeigarnik exemption)", async () => {
    const stale = agedMemory({
      id: "mem_stale_open",
      confidence: 0.03,
      unresolved: true,
      lastReinforcedAt: -100 * SETTINGS.pulseIntervalMs,
    });
    scheduler = buildScheduler(() => ({
      ...makeCannedStep(),
      updatedAgentState: { ...makeAgentState(), memories: [stale] },
    }));
    await scheduler.runPulse();

    const state = await agentStateRepo.get("sim_test", "agent_1");
    expect(state?.memories.some((m) => m.id === "mem_stale_open")).toBe(true);
  });

  it("MAX_MEMORIES backstop evicts the lowest-strength memory on overflow", async () => {
    const memories: Memory[] = Array.from({ length: 501 }, (_, i) =>
      agedMemory({
        id: `mem_${i}`,
        confidence: (i + 1) / 501, // distinct, strictly increasing strength
        unresolved: true, // isolates the backstop from the age/confidence eviction gate
        lastReinforcedAt: SETTINGS.pulseIntervalMs, // zero age at pulse 0's now
      }),
    );
    scheduler = buildScheduler(() => ({
      ...makeCannedStep(),
      updatedAgentState: { ...makeAgentState(), memories },
    }));
    await scheduler.runPulse();

    const state = await agentStateRepo.get("sim_test", "agent_1");
    expect(state?.memories).toHaveLength(500);
    expect(state?.memories.some((m) => m.id === "mem_0")).toBe(false); // weakest — dropped
    expect(state?.memories.some((m) => m.id === "mem_500")).toBe(true); // strongest — kept
  });
});
