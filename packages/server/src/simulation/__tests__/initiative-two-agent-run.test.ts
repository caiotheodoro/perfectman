import { describe, it, expect } from "vitest";
import { PulseScheduler } from "../pulse-scheduler.js";
import {
  InMemoryEventRepository,
  InMemoryAgentStateRepository,
  InMemoryChannelRepository,
} from "../in-memory-stores.js";
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
import type {
  ActionIntent,
  AgentState,
  EngineSnapshot,
  EngineStepResult,
  PersonaConfig,
  Simulation,
  SimulationSettings,
} from "@perfectman/shared";
import { BRUNO, GOULART, createId } from "@perfectman/shared";
import { runEngineStep } from "@perfectman/engine";

/**
 * Spec acceptance criterion (issue #132): over a 40-pulse 2-agent run, no
 * initiative source stays at 1.0 across consecutive pulses. The run lives at
 * the scheduler layer because the relief half of that invariant —
 * lastActionAt stamping feeding justActed on the next pulse — only exists in
 * the PulseScheduler wiring, not in the pure engine loop.
 */

const SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  // RateLimitGate's minute window runs on wall clock; sizing the cap above
  // the run's traffic keeps the seeded dynamics free of real-time influence.
  maxMessagesPerMinutePerAgent: 1000,
  llmCallBudgetPerMinute: 1000,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 1_000_000,
};

const SIM: Simulation = {
  id: "sim_initiative_run",
  name: "initiative-run",
  status: "running",
  agentIds: ["agent_bruno", "agent_goulart"],
  channelIds: ["ch_public"],
  settings: SETTINGS,
  seed: 7,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const PULSES = 40;

function makeAgentState(agentId: string, persona: PersonaConfig): AgentState {
  return {
    agentId,
    simulationId: SIM.id,
    personaId: persona.id,
    presence: "active",
    coreMood: {
      valence: persona.baselineValence,
      arousal: persona.baselineArousal,
      stability: persona.baselineStability,
      energy: persona.baselineEnergy,
      circumplexAngle: 0,
      circumplexRadius: 0.3,
      momentumValence: 0,
      momentumArousal: 0,
    },
    socialEmotions: {
      jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
      affection: 0, resentment: 0, suspicion: 0, admiration: 0,
      contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
      desireForStatus: 0, desireForIntimacy: 0,
    },
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

/** Canned LLM: every needsLLM decision becomes a committed public message. */
function makeCannedRuntime(): AgentRuntime {
  return {
    generateIntent: async (input) => ({
      intent: {
        id: createId(),
        actorId: input.agentId,
        intentType: "send_message" as ActionIntent["intentType"],
        visibleContent: `${input.agentId} breaks the silence`,
        personTargets: [],
        privateMotiveSummary: "something needs saying",
        emotionDrivers: [],
        motivationDrivers: [],
        memoryWrites: [],
      },
      llmUsage: null,
      latencyMs: 0,
      fallbackApplied: false,
      operatorEvents: [],
    }),
  };
}

const mockLLMBudget: LLMBudget = {
  getPriority: () => "normal",
};

type AccumulatorTrace = Map<string, Map<number, Map<string, number>>>;

async function runTwoAgentSimulation(): Promise<{
  trace: AccumulatorTrace;
  eventRepo: InMemoryEventRepository;
}> {
  const eventRepo = new InMemoryEventRepository();
  const agentStateRepo = new InMemoryAgentStateRepository();
  const channelRepo = new InMemoryChannelRepository();
  const channelRegistry = new ChannelRegistry(channelRepo);
  const gateway = new MockDeliveryGateway();
  const rateLimitGate = new RateLimitGate(SETTINGS);
  const intentResolver = new IntentResolver(rateLimitGate, channelRegistry);
  const engineEventBuilder = new EngineEventBuilder();

  await channelRepo.create({
    id: "ch_public",
    simulationId: SIM.id,
    type: "public_channel",
    name: "general",
    createdBy: "system",
    memberAgentIds: SIM.agentIds,
    spectatorVisible: true,
    operatorVisible: true,
    createdForMotives: [],
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  for (const agentId of SIM.agentIds) {
    await channelRepo.addMembership({ channelId: "ch_public", agentId, joinedAt: Date.now() });
  }

  const agents: AgentContext[] = [];
  for (const persona of [BRUNO, GOULART]) {
    const agentId = `agent_${persona.id}`;
    const state = makeAgentState(agentId, persona);
    await agentStateRepo.upsert(state);
    agents.push({ id: agentId, state, persona });
  }

  const trace: AccumulatorTrace = new Map();
  const stepResolver = (snapshot: EngineSnapshot): EngineStepResult => {
    const result = runEngineStep(snapshot);
    const byPulse = trace.get(snapshot.agentState.agentId) ?? new Map();
    byPulse.set(
      snapshot.pulseIndex,
      new Map(result.updatedAgentState.initiativeAccumulators.map(a => [a.source, a.value])),
    );
    trace.set(snapshot.agentState.agentId, byPulse);
    return result;
  };

  const scheduler = new PulseScheduler({
    simulation: SIM,
    agents,
    defaultPublicChannelId: "ch_public",
    eventRepo,
    agentStateRepo,
    channelRegistry,
    rateLimitGate,
    intentResolver,
    engineSnapshotProjection: new EngineSnapshotProjection(),
    deliveryProjection: new DeliveryProjection(gateway),
    spectatorProjection: new SpectatorProjection(gateway),
    operatorProjection: new OperatorProjection(gateway),
    engineEventBuilder,
    agentRuntime: makeCannedRuntime(),
    llmBudget: mockLLMBudget,
    pulseIntervalMs: SETTINGS.pulseIntervalMs,
    stepResolver,
  });

  for (let i = 0; i < PULSES; i++) {
    await scheduler.runPulse();
  }

  return { trace, eventRepo };
}

describe("40-pulse two-agent initiative run", () => {
  it("is a live run: both agents are stepped every pulse and commit messages", async () => {
    const { trace, eventRepo } = await runTwoAgentSimulation();

    const events = await eventRepo.getAfter(SIM.id);
    for (const agentId of SIM.agentIds) {
      const byPulse = trace.get(agentId);
      expect(byPulse?.size, `${agentId} observed on every pulse`).toBe(PULSES);
      expect(
        events.some(e => e.type === "message_sent" && e.actorId === agentId),
        `${agentId} committed at least one message`,
      ).toBe(true);
    }
  });

  it("no initiative source stays at 1.0 across consecutive pulses", async () => {
    const { trace } = await runTwoAgentSimulation();

    for (const [agentId, byPulse] of trace) {
      let prev: Map<string, number> | null = null;
      for (let pulse = 0; pulse < PULSES; pulse++) {
        const current = byPulse.get(pulse)!;
        if (prev) {
          for (const [source, value] of current) {
            // Unlike the engine-level silent loop, cold_start_bootstrap is
            // NOT skipped: a live run fires it, and the committed act's
            // justActed relief resets it before it can pin at the ceiling.
            const pinned = value >= 1 && prev.get(source)! >= 1;
            expect(
              pinned,
              `${agentId}/${source} pinned at 1.0 across pulses ${pulse - 1}-${pulse}`,
            ).toBe(false);
          }
        }
        prev = current;
      }
    }
  });

  it("no agent commits messages on more than 2 consecutive pulses without being mentioned", async () => {
    const { eventRepo } = await runTwoAgentSimulation();
    const events = await eventRepo.getAfter(SIM.id);
    for (const agentId of SIM.agentIds) {
      const pulses = new Set(events.filter(e => e.type === "message_sent" && e.actorId === agentId).map(e => e.pulseIndex));
      let run = 0;
      let longest = 0;
      for (let pulse = 0; pulse < PULSES; pulse++) {
        run = pulses.has(pulse) ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
      // The canned runtime never mentions anyone, so the bound is strict.
      expect(longest, `${agentId} longest run of consecutive message pulses`).toBeLessThanOrEqual(2);
    }
  });

});
