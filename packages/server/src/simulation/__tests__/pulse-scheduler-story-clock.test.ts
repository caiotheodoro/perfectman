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
import type { AgentState, CommittedEvent, PersonaConfig, Simulation, SimulationSettings } from "@perfectman/shared";

vi.mock("@perfectman/engine", () => ({
  filterVisibleEventsForAgent: (events: CommittedEvent[]) => events,
  computeStagnationMetrics: () => ({ level: "normal" }),
  runEngineStep: (snapshot: { agentState: AgentState }) => ({
    visibleEvents: [],
    newEvents: [],
    attentionResults: {},
    perceptionPacket: {},
    interpretations: [],
    emotionDelta: { coreMoodDelta: {} },
    updatedAgentState: snapshot.agentState,
    motivations: [],
    pressures: {},
    inhibitions: {},
    actionEmotions: {
      impulsiveProvocation: 0,
      dominanceAssertion: 0,
      defensiveness: 0,
      resentfulColdness: 0,
      anxiousOverreach: 0,
    },
    decision: { needsLLM: true, initiativeProceed: false, outcome: "respond" },
    availableActions: [],
    initiativeCandidates: [],
    memoryProposals: [],
    noOpRecord: null,
    operatorMetrics: {},
  }),
}));

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

describe("PulseScheduler story clock", () => {
  async function schedulerWith(
    agentRuntime: AgentRuntime,
    storyClock?: { start: string; minutesPerPulse: number },
  ): Promise<PulseScheduler> {
    const eventRepo = new InMemoryEventRepository();
    const agentStateRepo = new InMemoryAgentStateRepository();
    const channelRepo = new InMemoryChannelRepository();
    const channelRegistry = new ChannelRegistry(channelRepo);
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
    const gateway = new MockDeliveryGateway();
    const agent: AgentContext = { id: "agent_1", state: makeAgentState(), persona: PERSONA };
    const llmBudget: LLMBudget = { getPriority: vi.fn().mockReturnValue("normal") };

    return new PulseScheduler({
      simulation: SIM,
      agents: [agent],
      defaultPublicChannelId: "ch_public",
      eventRepo,
      agentStateRepo,
      channelRegistry,
      rateLimitGate,
      intentResolver: new IntentResolver(rateLimitGate, channelRegistry),
      engineSnapshotProjection: new EngineSnapshotProjection(),
      deliveryProjection: new DeliveryProjection(gateway),
      spectatorProjection: new SpectatorProjection(gateway),
      operatorProjection: new OperatorProjection(gateway),
      engineEventBuilder: new EngineEventBuilder(),
      agentRuntime,
      llmBudget,
      pulseIntervalMs: SETTINGS.pulseIntervalMs,
      ...(storyClock ? { storyClock } : {}),
    });
  }

  it("stamps each agent's input with the scene clock for that pulse", async () => {
    const generateIntent = vi.fn().mockRejectedValue(new Error("not needed"));
    const scheduler = await schedulerWith({ generateIntent }, { start: "23:40", minutesPerPulse: 4 });

    await scheduler.runPulse();
    await scheduler.runPulse();

    expect(generateIntent.mock.calls.map(([input]) => input.storyClock)).toEqual(["11:40pm", "11:44pm"]);
  });

  it("leaves the input unstamped when the scene has no clock", async () => {
    const generateIntent = vi.fn().mockRejectedValue(new Error("not needed"));
    const scheduler = await schedulerWith({ generateIntent });

    await scheduler.runPulse();

    expect(generateIntent.mock.calls[0]?.[0].storyClock).toBeUndefined();
  });
});
