import { describe, expect, it } from "vitest";
import type {
  ActionIntent,
  AgentState,
  CommittedEvent,
  EmergentGoal,
  PersonaConfig,
  SelfVerdict,
  SimulationEvent,
  SimulationSettings,
  WorldVerdict,
} from "@perfectman/shared";
import { createId } from "@perfectman/shared";
import { evaluateEndCondition } from "@perfectman/engine";
import { SimulationRuntime } from "../../simulation-runtime.js";
import {
  InMemoryAgentStateRepository,
  InMemoryChannelRepository,
  InMemoryEventRepository,
  InMemorySimulationRepository,
} from "../../in-memory-stores.js";
import { ChannelRegistry } from "../../channel-registry.js";
import { MockDeliveryGateway } from "../../../delivery/mock-delivery-gateway.js";
import { LLMBudgetTracker } from "../../../llm/llm-budget.js";
import { GoalRegistry } from "../goal-registry.js";
import { WorldEvaluator, resolveGoalLayerConfig } from "../world-evaluator.js";
import type { GoalLayerRuntime, WorldLLMRuntime } from "../world-evaluator.js";
import { GoalLayerLLMClient } from "../goal-layer-llm.js";
import type { GoalLayerCallInput, GoalLayerLLMOutcome } from "../goal-layer-llm.js";
import type { GoalLayerClientFactory } from "../goal-synthesizer.js";
import type { AgentRuntime } from "../../pulse-scheduler.js";
import type { AgentRuntimeOutput } from "../../agent/agent-runtime.types.js";
import {
  buildConfiguredSimulation,
  parseSimulationConfig,
  type ConfiguredSimulationHandle,
  type SimulationAppConfig,
} from "../../../config/simulation-config.js";

type RuntimeWithActiveSims = SimulationRuntime & { active: Map<string, unknown> };
function activeSimulationIds(runtime: SimulationRuntime): Map<string, unknown> {
  return (runtime as RuntimeWithActiveSims).active;
}

const SIM_ID = "sim_goal_e2e";
const CHANNEL_ID = "general";
const AGENT_ID = "ana";

const SEQUENCE = [
  "goal_proposed",
  "goal_accepted",
  "world_verdict",
  "delusion_gap_sampled",
  "ending_offered",
  "simulation_stopped",
] as const;

function makeConfig(): SimulationAppConfig {
  return parseSimulationConfig({
    simulation: {
      id: SIM_ID,
      name: "Goal Layer E2E",
      seed: 42,
      settings: {
        omniscientSpectatorMode: false,
        allowPrivateChannels: true,
        maxPrivateChannelsPerAgent: 3,
        maxMessagesPerMinutePerAgent: 30,
        llmCallBudgetPerMinute: 100,
        pulseIntervalMs: 1000,
        tokenBudgetPerHour: 1_000_000,
      },
    },
    persistence: { type: "memory" },
    deliveryGateways: [{ id: "mock", type: "mock" }],
    channels: [{
      id: CHANNEL_ID,
      type: "public_channel",
      name: "general",
      default: true,
      memberAgentIds: [AGENT_ID],
    }],
    agents: [{
      id: AGENT_ID,
      persona: {
        id: AGENT_ID,
        name: "Ana",
        archetype: "observer",
        writingStyle: "brief and careful",
        styleExamples: ["oi", "entendi"],
      },
      promptProfile: {
        personaId: AGENT_ID,
        displayName: "Ana",
        identityFrame: "You are Ana.",
        voiceGuidelines: ["Keep it short."],
        styleExamples: ["oi"],
        relationshipBiases: {},
        language: "pt-BR",
      },
      llm: {
        providerType: "mock",
        modelName: "mock-model",
        maxInputTokens: 2048,
        maxOutputTokens: 512,
        temperature: 0.7,
        timeoutMs: 5000,
        retryCount: 1,
      },
    }],
    goalLayer: { enabled: true, reviewEveryPulses: 1 },
  });
}

function blockedEvent(index: number): SimulationEvent {
  return {
    simulationId: SIM_ID,
    channelId: CHANNEL_ID,
    actorId: AGENT_ID,
    type: "intent_blocked",
    payload: {
      intentType: "send_message",
      violations: [{ type: "rate_limited" }],
      intentId: `intent_${index}`,
    },
    sourceEventIds: [],
    emotionalSalience: "low",
    pulseIndex: 0,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public",
    },
  };
}

async function waitForEnd(
  handle: ConfiguredSimulationHandle,
  timeoutMs: number,
): Promise<CommittedEvent> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const log = await handle.repositories.eventRepo.getCommittedThrough(
      handle.simulationId,
      Number.MAX_SAFE_INTEGER,
    );
    const stopped = log.find((event) => event.type === "simulation_stopped");
    const active = activeSimulationIds(handle.runtime);
    if (stopped && !active.has(handle.simulationId)) return stopped;
    if (Date.now() > deadline) {
      throw new Error(
        `goal-layer e2e timeout: simulation_stopped not committed within ${timeoutMs}ms for ${handle.simulationId}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe("goal layer end-to-end", () => {
  it(
    "crystallizes a resolve goal from seeded blocked intents, reviews it, and stops with endReason + epilogue",
    async () => {
      const handle = await buildConfiguredSimulation(makeConfig());
      try {
        const seeds: SimulationEvent[] = [1, 2, 3].map(blockedEvent);
        await handle.runtime.getEventLog().append(handle.simulationId, seeds);
        await handle.runtime.start(handle.simulationId);

        const stopped = await waitForEnd(handle, 15_000);
        const log = await handle.repositories.eventRepo.getCommittedThrough(
          handle.simulationId,
          Number.MAX_SAFE_INTEGER,
        );

        const indexOf = (type: string): number =>
          log.findIndex((event) => event.type === type);

        for (let i = 1; i < SEQUENCE.length; i++) {
          expect(indexOf(SEQUENCE[i]!)).toBeGreaterThan(indexOf(SEQUENCE[i - 1]!));
        }

        const goalProposed = log.find((event) => event.type === "goal_proposed")!;
        expect(goalProposed.payload["synthesizer"]).toBe("deterministic");
        expect(typeof goalProposed.payload["narrativeFraming"]).toBe("string");
        expect((goalProposed.payload["narrativeFraming"] as string).length).toBeGreaterThan(0);
        expect(goalProposed.payload["confidence"]).toBe(1);
        const proposal = goalProposed.payload["proposal"] as { id?: string };
        expect(proposal?.id).toMatch(/^crystal-ana-resolve-general/);
        expect(goalProposed.visibility.visibleToAgents).toContain(AGENT_ID);
        expect(goalProposed.visibility.visibleToSpectators).toBe(true);

        for (const type of ["world_verdict", "delusion_gap_sampled"]) {
          const events = log.filter((event) => event.type === type);
          expect(events.length).toBeGreaterThan(0);
          for (const event of events) {
            expect(event.pulseIndex).toBeGreaterThanOrEqual(1);
            expect(event.createdAt).toBeGreaterThan(0);
          }
        }

        expect(stopped.payload["endReason"]).toBe("goal_end_offered");
        const offer = stopped.payload["endingOffer"] as {
          epilogue?: string;
          reasons?: string[];
          status?: string;
          goalId?: string;
        };
        expect(typeof offer?.goalId).toBe("string");
        expect((offer?.epilogue ?? "").length).toBeGreaterThan(0);
        expect(offer?.status).toBe("pending");
        // Pinned branch: the story-holds ending (world verdict reached + beat
        // + meaning) — the plateau epilogue would flag a regression to the
        // degraded ending path.
        expect(offer?.epilogue).toContain("the story holds");
        expect(offer?.reasons).toContain("world verdict: reached");

        const active = activeSimulationIds(handle.runtime);
        expect(active.has(handle.simulationId)).toBe(false);
      } finally {
        const active = activeSimulationIds(handle.runtime);
        if (active.has(handle.simulationId)) {
          await handle.runtime.stop(handle.simulationId);
        }
        await handle.close();
      }
    },
    20_000,
  );
});

const BEN_ID = "ben";

const LLM_SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 30,
  llmCallBudgetPerMinute: 100,
  pulseIntervalMs: 1000,
  tokenBudgetPerHour: 1_000_000,
};

const BEN_PERSONA = {
  id: BEN_ID,
  name: "Ben",
  archetype: "critic",
  writingStyle: "pointed and direct",
  styleExamples: ["hmm"],
};

function makeAgentState(agentId: string): AgentState {
  return {
    agentId,
    simulationId: SIM_ID,
    personaId: agentId,
    presence: "active",
    coreMood: {
      valence: 0,
      arousal: 0.5,
      stability: 0.8,
      energy: 0.6,
      circumplexAngle: 0,
      circumplexRadius: 0.5,
      momentumValence: 0,
      momentumArousal: 0,
    },
    socialEmotions: {
      jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0,
      resentment: 0, suspicion: 0, admiration: 0, contempt: 0, neediness: 0,
      socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0,
    },
    relationalStates: new Map(),
    memories: [],
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makePersona(id: string, name: string): PersonaConfig {
  return {
    id,
    name,
    archetype: "observer",
    writingStyle: "brief and careful",
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

function makeNoOpIntent(actorId: string): ActionIntent {
  return {
    id: createId(),
    actorId,
    intentType: "no_op",
    personTargets: [],
    privateMotiveSummary: "nothing to do",
    emotionDrivers: [],
    motivationDrivers: [],
    memoryWrites: [],
  };
}

/** Deterministic agent runtime: every LLM decision resolves to a no-op, so
 *  the loop never authors organic messages and records no usage — the goal
 *  call class is the only budget consumer in these drives. */
const noOpAgentRuntime: AgentRuntime = {
  async generateIntent(input: import("@perfectman/shared").AgentRuntimeInput): Promise<AgentRuntimeOutput> {
    return {
      intent: makeNoOpIntent(input.agentId),
      llmUsage: null,
      latencyMs: 5,
      fallbackApplied: false,
      operatorEvents: [],
    };
  },
};

const MOCK_LLM = {
  providerType: "mock" as const,
  modelName: "mock-model",
  baseUrl: "http://localhost",
  maxInputTokens: 2048,
  maxOutputTokens: 512,
  temperature: 0.7,
  timeoutMs: 5000,
  retryCount: 1,
};

function makeWitnessedEvent(index: number): SimulationEvent {
  return {
    simulationId: SIM_ID,
    channelId: `ch_w${index}`,
    actorId: BEN_ID,
    type: "message_sent",
    payload: { content: "the storm passed quickly" },
    sourceEventIds: [],
    emotionalSalience: "high",
    pulseIndex: 0,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public",
    },
  };
}

function makeRidiculeEvent(): SimulationEvent {
  return {
    simulationId: SIM_ID,
    channelId: CHANNEL_ID,
    actorId: BEN_ID,
    type: "reaction_sent",
    payload: { emoji: "👎", targetEventId: "seed-1" },
    sourceEventIds: [],
    emotionalSalience: "low",
    pulseIndex: 0,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public",
    },
  };
}

/** Deluded canned outcome: a genuine LLM "reached" claim for every active goal (D-19/D-23). */
function deludedLlmOutcome(input: GoalLayerCallInput): GoalLayerLLMOutcome {
  return {
    result: {
      proposals: input.candidates.map((candidate) => ({
        proposal: candidate,
        narrativeFraming: `${candidate.title} — ${candidate.targetState.description}`,
        confidence: 0.8,
        synthesizer: "llm" as const,
      })),
      selfVerdicts: input.activeGoals.map((goal) => ({
        agentId: goal.agentId,
        goalId: goal.id,
        claim: "reached" as const,
        confidence: 1,
        feltSignal: 0.8,
        narrative: `${goal.title}: reached`,
      })),
    },
    operatorEvents: [],
  };
}

class CountingBudgetTracker extends LLMBudgetTracker {
  goalCalls = 0;
  goalPulses: number[] = [];

  override recordUsage(usage: import("@perfectman/shared").LLMUsage): void {
    if (usage.callType === "goal") {
      this.goalCalls += 1;
      this.goalPulses.push(usage.pulseIndex);
    }
    super.recordUsage(usage);
  }
}

describe("goal layer end-to-end — LLM self-verdicts (TT502)", () => {
  it(
    "(a) a deluded achiever (LLM claims reached, world says not_reached) never terminates through the real scheduler path",
    async () => {
      const resolveGoalId = `crystal-${AGENT_ID}-resolve-${CHANNEL_ID}`;
      // Branch pin (A-2): the deluded branch (not_reached + self reached)
      // orders before the plateau branch in evaluateEndCondition, so the
      // property below holds against that ordering, not a weakened assertion.
      const branch = evaluateEndCondition(
        {
          id: resolveGoalId,
          agentId: AGENT_ID,
          title: "Overcome the repeated block in general",
          targetState: {
            id: "predicate-resolve-general",
            description: `no more blocked intents from ${AGENT_ID} in ${CHANNEL_ID}`,
            observableCriteria: [`no more blocked intents from ${AGENT_ID} in ${CHANNEL_ID}`],
          },
          kind: "resolve",
          status: "active",
          origin: "crystallized_from",
          sourceEventIds: ["seed-1"],
          createdAt: 3000,
        },
        {
          agentId: AGENT_ID,
          goalId: resolveGoalId,
          claim: "reached",
          confidence: 1,
          feltSignal: 0.8,
          narrative: "Overcome the repeated block in general: reached",
        },
        {
          goalId: resolveGoalId,
          objective: { distanceToTarget: 0.5, progressRate: 0, plateaued: false },
          consensus: "rejected",
          determination: "not_reached",
          confidence: 0.75,
        },
        { completionBeatPresent: false, meaningMade: false, nextGoalAvailable: true },
      );
      expect(branch.kind).toBe("re_goal");

      const eventRepo = new InMemoryEventRepository();
      const agentStateRepo = new InMemoryAgentStateRepository();
      const channelRepo = new InMemoryChannelRepository();
      const simRepo = new InMemorySimulationRepository();
      const runtime = new SimulationRuntime({
        delivery: new MockDeliveryGateway(),
        agentRuntime: noOpAgentRuntime,
        llmBudget: new LLMBudgetTracker(),
        repositories: { eventRepo, agentStateRepo, simRepo, channelRepo },
      });
      const registry = new GoalRegistry();
      const config = resolveGoalLayerConfig({
        enabled: true,
        reviewEveryPulses: 1,
        synthesizer: {
          mode: "llm",
          intervalPulses: 1,
          maxCandidatesPerReview: 10,
          maxSelfVerdictsPerReview: 3,
        },
      });
      const clientFactory: GoalLayerClientFactory = (params) => {
        const caller = Object.create(GoalLayerLLMClient.prototype) as GoalLayerLLMClient;
        caller.call = async (input: GoalLayerCallInput): Promise<GoalLayerLLMOutcome> =>
          deludedLlmOutcome(input);
        return caller;
      };
      const goalLayer: GoalLayerRuntime = {
        config,
        evaluator: new WorldEvaluator(
          eventRepo,
          agentStateRepo,
          new ChannelRegistry(channelRepo),
          registry,
          config,
          {
            simulationId: SIM_ID,
            llmConfigs: new Map([
              [AGENT_ID, MOCK_LLM],
              [BEN_ID, MOCK_LLM],
            ]),
            budget: new LLMBudgetTracker(),
            clientFactory,
          },
        ),
      };

      await runtime.createSimulation({
        id: SIM_ID,
        name: "Deluded Achiever E2E",
        seed: 7,
        settings: LLM_SETTINGS,
        agentContexts: [
          { id: AGENT_ID, state: makeAgentState(AGENT_ID), persona: makePersona(AGENT_ID, "Ana") },
          { id: BEN_ID, state: makeAgentState(BEN_ID), persona: makePersona(BEN_ID, "Ben") },
        ],
        channels: [{
          id: CHANNEL_ID,
          type: "public_channel",
          name: "general",
          default: true,
          memberAgentIds: [AGENT_ID, BEN_ID],
        }],
        goalLayer,
      });

      await runtime.getEventLog().append(SIM_ID, [1, 2, 3].map(blockedEvent));
      await runtime.getEventLog().append(SIM_ID, [makeRidiculeEvent()]);

      try {
        // Pulse 0 is review-exempt; drive it first so reviews run on
        // pulses 1..8 below.
        await runtime.runPulse(SIM_ID);
        for (let pulse = 1; pulse <= 8; pulse += 1) {
          // A fresh witnessed event per review keeps a next goal pending, so
          // the plateau branch never arms; the arc stays on the deluded
          // re_goal branch for all eight reviews (A-2 precondition).
          await runtime.getEventLog().append(SIM_ID, [makeWitnessedEvent(pulse)]);
          await runtime.runPulse(SIM_ID);
          const log = await eventRepo.getCommittedThrough(SIM_ID, Number.MAX_SAFE_INTEGER);
          expect(log.some((event) => event.type === "ending_offered")).toBe(false);
          expect(log.some((event) => event.type === "simulation_stopped")).toBe(false);
          expect(log.some((event) => event.type === "goal_proposed")).toBe(true);
        }
        expect(activeSimulationIds(runtime).has(SIM_ID)).toBe(true);

        // The flagships hold after 8 reviews: world verdict never flips to
        // reached, the LLM belief persists as "reached", and every gap
        // sample for the resolve goal carries the full divergence.
        expect(registry.getLatestVerdict(resolveGoalId)?.determination).toBe("not_reached");
        expect(registry.getSelfVerdict(resolveGoalId)?.verdict.claim).toBe("reached");
        const log = await eventRepo.getCommittedThrough(SIM_ID, Number.MAX_SAFE_INTEGER);
        const resolveGaps = log.filter(
          (event) =>
            event.type === "delusion_gap_sampled" &&
            event.payload["goalId"] === resolveGoalId,
        );
        expect(resolveGaps.length).toBeGreaterThanOrEqual(6);
        for (const gap of resolveGaps) {
          expect(gap.payload["divergenceFromWorld"]).toBe(1);
          expect((gap.payload["magnitude"] as number) > 0).toBe(true);
        }
      } finally {
        if (activeSimulationIds(runtime).has(SIM_ID)) {
          await runtime.stop(SIM_ID);
        }
      }
    },
    20_000,
  );

  it(
    "(b) llm mode runs on the mock leg through buildConfiguredSimulation: goal calls match the interval cadence",
    async () => {
      const budget = new CountingBudgetTracker();
      const handle = await buildConfiguredSimulation(makeLlmModeConfig(), {
        llmBudget: budget,
        agentRuntimeFactory: () => noOpAgentRuntime,
      });
      try {
        await handle.runtime.getEventLog().append(handle.simulationId, [1, 2, 3].map(blockedEvent));
        // Pulses 0..4: reviews run on pulses 1..4; intervalPulses 2 puts the
        // combined calls on reviews 2 and 4. The drive stops before review 5,
        // where the resolve goal's third snapshot would arm the plateau
        // window — the budget/cadence proof needs no ending.
        for (let pulse = 0; pulse <= 4; pulse += 1) {
          await handle.runtime.runPulse(handle.simulationId);
        }

        const log = await handle.repositories.eventRepo.getCommittedThrough(
          handle.simulationId,
          Number.MAX_SAFE_INTEGER,
        );
        const proposed = log.filter((event) => event.type === "goal_proposed");
        expect(proposed.length).toBeGreaterThanOrEqual(1);
        for (const event of proposed) {
          // D-16: the mock leg's parsing path keeps provenance honest.
          expect(event.payload["synthesizer"]).toBe("llm");
          expect(typeof event.payload["narrativeFraming"]).toBe("string");
        }
        expect(log.some((event) => event.type === "ending_offered")).toBe(false);
        expect(log.some((event) => event.type === "simulation_stopped")).toBe(false);
        expect(activeSimulationIds(handle.runtime).has(handle.simulationId)).toBe(true);

        // Exact cadence: 5 pulses (reviews on 1..4), goal calls only on the
        // interval reviews 2 and 4 (no per-pulse calls, one combined call
        // per agent per interval review). The injected tracker counted every
        // "goal" callType usage and nothing else could land on it (the canned
        // agent runtime records llmUsage null).
        expect(budget.goalCalls).toBe(2);
        expect(budget.goalPulses).toEqual([2, 4]);
      } finally {
        const active = activeSimulationIds(handle.runtime);
        if (active.has(handle.simulationId)) {
          await handle.runtime.stop(handle.simulationId);
        }
        await handle.close();
      }
    },
    20_000,
  );
});

function makeLlmModeConfig(): SimulationAppConfig {
  return parseSimulationConfig({
    simulation: {
      id: SIM_ID,
      name: "Goal Layer LLM Mode",
      seed: 43,
      settings: {
        omniscientSpectatorMode: false,
        allowPrivateChannels: true,
        maxPrivateChannelsPerAgent: 3,
        maxMessagesPerMinutePerAgent: 30,
        llmCallBudgetPerMinute: 100,
        pulseIntervalMs: 1000,
        tokenBudgetPerHour: 1_000_000,
      },
    },
    persistence: { type: "memory" },
    deliveryGateways: [{ id: "mock", type: "mock" }],
    channels: [{
      id: CHANNEL_ID,
      type: "public_channel",
      name: "general",
      default: true,
      memberAgentIds: [AGENT_ID, BEN_ID],
    }],
    agents: [
      {
        id: AGENT_ID,
        persona: {
          id: AGENT_ID,
          name: "Ana",
          archetype: "observer",
          writingStyle: "brief and careful",
          styleExamples: ["oi", "entendi"],
        },
        promptProfile: {
          personaId: AGENT_ID,
          displayName: "Ana",
          identityFrame: "You are Ana.",
          voiceGuidelines: ["Keep it short."],
          styleExamples: ["oi"],
          relationshipBiases: {},
          language: "pt-BR",
        },
        llm: {
          providerType: "mock",
          modelName: "mock-model",
          maxInputTokens: 2048,
          maxOutputTokens: 512,
          temperature: 0.7,
          timeoutMs: 5000,
          retryCount: 1,
        },
      },
      {
        id: BEN_ID,
        persona: BEN_PERSONA,
        promptProfile: {
          personaId: BEN_ID,
          displayName: "Ben",
          identityFrame: "You are Ben.",
          voiceGuidelines: ["Be direct."],
          styleExamples: ["hmm"],
          relationshipBiases: {},
          language: "en",
        },
        llm: {
          providerType: "mock",
          modelName: "mock-model",
          maxInputTokens: 2048,
          maxOutputTokens: 512,
          temperature: 0.7,
          timeoutMs: 5000,
          retryCount: 1,
        },
      },
    ],
    goalLayer: {
      enabled: true,
      reviewEveryPulses: 1,
      synthesizer: { mode: "llm", intervalPulses: 2 },
    },
  });
}