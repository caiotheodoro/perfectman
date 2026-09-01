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
import { cannedNoOpStep, makeAgentState, makePersona, SETTINGS, STAGNATION_METRIC_KEYS } from "./fixtures.js";
import type {
  Simulation,
  SimulationEvent,
  StagnationMetrics,
} from "@perfectman/shared";

const computeMock = vi.mocked(computeStagnationMetrics);
const detectMock = vi.mocked(detectAttractorStates);

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
  await agentStateRepo.upsert(makeAgentState());

  const rateLimitGate = new RateLimitGate(SETTINGS);
  const agentRuntime: AgentRuntime = { generateIntent: vi.fn() };
  const llmBudget: LLMBudget = { getPriority: vi.fn().mockReturnValue("normal") };

  const scheduler = new PulseScheduler({
    simulation: SIM,
    agents: [{ id: "agent_1", state: makeAgentState(), persona: makePersona("agent_1") }],
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
    for (const key of STAGNATION_METRIC_KEYS) {
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
