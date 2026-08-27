import { describe, it, expect, vi } from "vitest";
import {
  SimulationRuntime,
  type ConfiguredInitialChannel,
} from "../simulation-runtime.js";
import { MockDeliveryGateway } from "../../delivery/mock-delivery-gateway.js";
import {
  InMemoryAgentStateRepository,
  InMemoryChannelRepository,
  InMemoryEventRepository,
  InMemorySimulationRepository,
} from "../in-memory-stores.js";
import type { AgentContext, AgentRuntime, LLMBudget } from "../pulse-scheduler.js";
import type { SimulationSettings, AgentState, PersonaConfig, EndingOffer } from "@perfectman/shared";

const SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 20,
  llmCallBudgetPerMinute: 10,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 1_000_000,
};

function makeAgentState(): AgentState {
  return {
    agentId: "agent_1",
    simulationId: "sim_goal_test",
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

const AGENT: AgentContext = {
  id: "agent_1",
  state: makeAgentState(),
  persona: PERSONA,
};

const OFFER: EndingOffer = {
  goalId: "crystal-agent_1-resolve-ch_public-1",
  reasons: ["progress plateaued"],
  epilogue: "The conversation found its footing again.",
  status: "pending",
};

const mockAgentRuntime: AgentRuntime = {
  generateIntent: vi.fn(),
};

const mockLLMBudget: LLMBudget = {
  getPriority: vi.fn().mockReturnValue("normal"),
};

function buildRuntime(): SimulationRuntime {
  return new SimulationRuntime({
    delivery: new MockDeliveryGateway(),
    agentRuntime: mockAgentRuntime,
    llmBudget: mockLLMBudget,
  });
}

async function startAndStop(
  runtime: SimulationRuntime,
  opts?: { endReason?: "operator_command" | "goal_end_offered"; endingOffer?: EndingOffer },
): Promise<{ simId: string; payload: Record<string, unknown> }> {
  const sim = await runtime.createSimulation({
    name: "goal test",
    agentContexts: [AGENT],
    settings: SETTINGS,
    seed: 42,
  });
  const simId = sim.id;
  await runtime.start(simId);
  await runtime.stop(simId, opts);
  const events = await runtime.getEventLog().getCommittedThrough(simId, Number.MAX_SAFE_INTEGER);
  const stopped = events.find(e => e.type === "simulation_stopped");
  if (stopped === undefined) {
    throw new Error("goal test run produced no simulation_stopped event");
  }
  return { simId, payload: stopped.payload as Record<string, unknown> };
}

const ATTACH_CHANNEL: ConfiguredInitialChannel = {
  id: "general",
  type: "public_channel",
  name: "general",
  default: true,
  memberAgentIds: ["agent_1"],
};

/** Explicit in-memory repos so the sim/channel row counts stay assertable. */
function buildRuntimeWithRepos(simRepo: InMemorySimulationRepository): SimulationRuntime {
  return new SimulationRuntime({
    delivery: new MockDeliveryGateway(),
    agentRuntime: mockAgentRuntime,
    llmBudget: mockLLMBudget,
    repositories: {
      eventRepo: new InMemoryEventRepository(),
      agentStateRepo: new InMemoryAgentStateRepository(),
      simRepo,
      channelRepo: new InMemoryChannelRepository(),
    },
  });
}

describe("SimulationRuntime attachExisting (T412)", () => {
  it("attachExisting on an existing id returns the stored row (get-or-create, memory mode)", async () => {
    const simRepo = new InMemorySimulationRepository();
    const runtime = buildRuntimeWithRepos(simRepo);

    const first = await runtime.createSimulation({
      id: "sim_attach",
      name: "phase one",
      agentContexts: [AGENT],
      settings: SETTINGS,
      seed: 42,
      channels: [ATTACH_CHANNEL],
    });

    // Resumed with a different name: the attach branch must return the
    // surviving row (get-or-create), not a freshly created simulation.
    const resumed = await runtime.createSimulation({
      id: "sim_attach",
      name: "phase two",
      agentContexts: [AGENT],
      settings: SETTINGS,
      seed: 42,
      channels: [ATTACH_CHANNEL],
      attachExisting: true,
    });
    expect(resumed.id).toBe(first.id);
    expect(resumed.name).toBe("phase one");
    expect(await simRepo.list()).toHaveLength(1);

    // Without the flag the create path runs; memory create is an idempotent
    // Map.set, so the row is silently overwritten — the documented repo-level
    // divergence the attach branch routes around for restart callers (sqlite
    // fails loudly with the PK instead; T412 contract rows pin that side).
    const overwritten = await runtime.createSimulation({
      id: "sim_attach",
      name: "phase three",
      agentContexts: [AGENT],
      settings: SETTINGS,
      seed: 42,
      channels: [ATTACH_CHANNEL],
    });
    expect(overwritten.name).toBe("phase three");
  });

  it("attachExisting with a missing default channel raises the named error", async () => {
    const simRepo = new InMemorySimulationRepository();
    const runtime = buildRuntimeWithRepos(simRepo);

    await runtime.createSimulation({
      id: "sim_attach",
      name: "phase one",
      agentContexts: [AGENT],
      settings: SETTINGS,
      seed: 42,
      channels: [ATTACH_CHANNEL],
    });

    await expect(
      runtime.createSimulation({
        id: "sim_attach",
        name: "phase two",
        agentContexts: [AGENT],
        settings: SETTINGS,
        seed: 42,
        attachExisting: true,
        channels: [{ ...ATTACH_CHANNEL, id: "ghost", name: "ghost" }],
      }),
    ).rejects.toThrow(/Channel ghost not found for existing simulation sim_attach/);

    // The failed attach must not have inserted anything.
    expect(await simRepo.list()).toHaveLength(1);
  });
});

describe("SimulationRuntime stop payload (T402)", () => {
  it("stop without options commits the payload WITHOUT endReason/endingOffer — operator SIGINT path unchanged", async () => {
    const { simId, payload } = await startAndStop(buildRuntime());
    expect(payload).toEqual({ simulationId: simId });
    expect("endReason" in payload).toBe(false);
    expect("endingOffer" in payload).toBe(false);
  });

  it("stop with endReason only carries endReason and no endingOffer key", async () => {
    const { simId, payload } = await startAndStop(buildRuntime(), { endReason: "operator_command" });
    expect(payload).toEqual({ simulationId: simId, endReason: "operator_command" });
    expect("endingOffer" in payload).toBe(false);
  });

  it("stop with endReason + endingOffer carries both — goal-end path", async () => {
    const { simId, payload } = await startAndStop(buildRuntime(), { endReason: "goal_end_offered", endingOffer: OFFER });
    expect(payload).toEqual({
      simulationId: simId,
      endReason: "goal_end_offered",
      endingOffer: OFFER,
    });
  });
});