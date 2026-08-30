import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@perfectman/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@perfectman/engine")>();
  return {
    ...actual,
    computeStagnationMetrics: vi.fn(),
    detectAttractorStates: vi.fn(() => []),
  };
});

import { computeStagnationMetrics, detectAttractorStates } from "@perfectman/engine";
import { PulseScheduler } from "../pulse-scheduler.js";
import type { AgentRuntime, LLMBudget } from "../pulse-scheduler.js";
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
import type {
  AgentState,
  EngineSnapshot,
  EngineStepResult,
  PersonaConfig,
  Simulation,
  SimulationEvent,
  SimulationSettings,
  StagnationMetrics,
} from "@perfectman/shared";

const computeMock = vi.mocked(computeStagnationMetrics);
const detectMock = vi.mocked(detectAttractorStates);

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
  id: "sim_stag",
  name: "stagnation",
  status: "running",
  agentIds: ["agent_1"],
  channelIds: ["ch_public"],
  settings: SETTINGS,
  seed: 5,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function makeAgentState(agentId: string): AgentState {
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
  };
}

function makePersona(agentId: string): PersonaConfig {
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

const ZERO_ACTION = {
  defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0, resentfulColdness: 0,
  curiousApproach: 0, anxiousOverreach: 0, pridefulPerformance: 0, vulnerableRetreat: 0,
  contemptuousDismissal: 0, strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0,
  dominanceAssertion: 0, repairImpulse: 0,
};

function cannedNoOpStep(snap: EngineSnapshot): EngineStepResult {
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
    updatedAgentState: makeAgentState(agentId),
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

function normalMetrics(): StagnationMetrics {
  return {
    simulationId: "sim_stag",
    pulseIndex: 0,
    bdi: 0.1, rdv: 0.12, ige: 0.14, cue: 0.11, eri: 0.13, isd: 0.09, cns: 0.08,
    compositeScore: 0.11,
    level: "normal",
  };
}

interface Harness {
  scheduler: PulseScheduler;
  gateway: MockDeliveryGateway;
  eventRepo: InMemoryEventRepository;
  agentStateRepo: InMemoryAgentStateRepository;
}

async function buildScheduler(): Promise<Harness> {
  const eventRepo = new InMemoryEventRepository();
  const agentStateRepo = new InMemoryAgentStateRepository();
  const channelRepo = new InMemoryChannelRepository();
  const channelRegistry = new ChannelRegistry(channelRepo);
  const gateway = new MockDeliveryGateway();

  await channelRepo.create({
    id: "ch_public",
    simulationId: "sim_stag",
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
  await agentStateRepo.upsert(makeAgentState("agent_1"));

  const rateLimitGate = new RateLimitGate(SETTINGS);
  const agentRuntime: AgentRuntime = { generateIntent: vi.fn() };
  const llmBudget: LLMBudget = { getPriority: vi.fn().mockReturnValue("normal") };

  const scheduler = new PulseScheduler({
    simulation: SIM,
    agents: [{ id: "agent_1", state: makeAgentState("agent_1"), persona: makePersona("agent_1") }],
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
    stepResolver: cannedNoOpStep,
  });

  return { scheduler, gateway, eventRepo, agentStateRepo };
}

function seedEvent(pulseIndex: number): SimulationEvent {
  return {
    id: `seed_p${pulseIndex}`,
    simulationId: "sim_stag",
    channelId: "ch_public",
    actorId: "agent_1",
    type: "message_sent",
    payload: {},
    sourceEventIds: [],
    emotionalSalience: "low",
    pulseIndex,
    visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public_channel" },
  };
}

async function runTo(scheduler: PulseScheduler, pulseIndex: number): Promise<void> {
  for (let i = 0; i <= pulseIndex; i += 1) await scheduler.runPulse();
}

describe("PulseScheduler stagnation telemetry", () => {
  beforeEach(() => {
    computeMock.mockReset();
    detectMock.mockReset();
    computeMock.mockReturnValue(normalMetrics());
    detectMock.mockReturnValue([]);
  });

  it("emits a stagnation_metrics operator event every cadence even when level is normal", async () => {
    const h = await buildScheduler();
    await runTo(h.scheduler, 20);

    const metricsEvents = h.gateway.operatorEvents.filter((e) => e.type === "stagnation_metrics");
    expect(metricsEvents.map((e) => e.pulseIndex)).toEqual([10, 20]);

    const first = metricsEvents[0]!;
    expect(first.data?.["level"]).toBe("normal");
    for (const key of ["bdi", "rdv", "ige", "cue", "eri", "isd", "cns", "compositeScore"] as const) {
      expect(typeof first.data?.[key]).toBe("number");
    }

    expect(h.gateway.operatorEvents.some((e) => e.type === "stagnation_warning")).toBe(false);
    const committed = await h.eventRepo.getAfter("sim_stag");
    expect(committed.some((e) => e.type === "stagnation_detected")).toBe(false);
  });

  it("emits one attractor_detected operator event per detected signature", async () => {
    detectMock.mockReturnValue(["message_loop", "reaction_only"]);
    const h = await buildScheduler();
    await runTo(h.scheduler, 10);

    const attractor = h.gateway.operatorEvents.filter((e) => e.type === "attractor_detected");
    expect(attractor.map((e) => e.data?.["signature"]).sort()).toEqual(["message_loop", "reaction_only"]);
    for (const e of attractor) expect(e.pulseIndex).toBe(10);
  });

  it("does not let an attractor hit override the composite level", async () => {
    detectMock.mockReturnValue(["message_loop"]);
    const h = await buildScheduler();
    await runTo(h.scheduler, 10);

    const attractor = h.gateway.operatorEvents.filter((e) => e.type === "attractor_detected");
    expect(attractor).toHaveLength(1);

    const metricsEvent = h.gateway.operatorEvents.find((e) => e.type === "stagnation_metrics");
    expect(metricsEvent?.data?.["level"]).toBe("normal");

    const committed = await h.eventRepo.getAfter("sim_stag");
    expect(committed.some((e) => e.type === "stagnation_detected")).toBe(false);
  });

  it("bounds the stagnation detector input to the rolling window of recent pulses", async () => {
    const h = await buildScheduler();
    await h.eventRepo.append("sim_stag", [5, 8, 10, 12, 30, 49].map(seedEvent));

    await runTo(h.scheduler, 50);

    const idx = computeMock.mock.calls.findIndex((c) => c[1] === 50);
    expect(idx).toBeGreaterThanOrEqual(0);

    const passedEvents = computeMock.mock.calls[idx]![2];
    expect(passedEvents.map((e) => e.pulseIndex).sort((a, b) => a - b)).toEqual([12, 30, 49]);

    // The attractor detector is wired to the identical bounded window.
    const detectEvents = detectMock.mock.calls[idx]![0];
    expect(detectEvents).toBe(passedEvents);
  });
});
