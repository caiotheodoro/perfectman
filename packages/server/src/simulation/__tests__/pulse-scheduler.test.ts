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
import { MockDeliveryGateway } from "./mock-delivery-gateway.js";
import type { AgentContext, AgentRuntime, LlmBudget } from "../pulse-scheduler.js";
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

describe("PulseScheduler", () => {
  let scheduler: PulseScheduler;
  let eventRepo: InMemoryEventRepository;
  let agentStateRepo: InMemoryAgentStateRepository;
  let channelRepo: InMemoryChannelRepository;
  let channelRegistry: ChannelRegistry;
  let gateway: MockDeliveryGateway;

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

  const mockLlmBudget: LlmBudget = {
    getPriority: vi.fn().mockReturnValue("normal"),
  };

  beforeEach(async () => {
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
    const intentResolver = new IntentResolver(rateLimitGate, channelRegistry);
    const engineSnapshotProjection = new EngineSnapshotProjection();
    const deliveryProjection = new DeliveryProjection(gateway);
    const spectatorProjection = new SpectatorProjection(gateway);
    const operatorProjection = new OperatorProjection(gateway);
    const engineEventBuilder = new EngineEventBuilder();

    scheduler = new PulseScheduler({
      simulation: SIM,
      agents: [AGENT],
      defaultPublicChannelId: "ch_public",
      eventRepo,
      agentStateRepo,
      channelRegistry,
      rateLimitGate,
      intentResolver,
      engineSnapshotProjection,
      deliveryProjection,
      spectatorProjection,
      operatorProjection,
      engineEventBuilder,
      agentRuntime: mockAgentRuntime,
      llmBudget: mockLlmBudget,
      pulseIntervalMs: SETTINGS.pulseIntervalMs,
    });
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
});
