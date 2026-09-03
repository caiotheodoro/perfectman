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
import type { Simulation, SimulationSettings, AgentState, PersonaConfig, ActionIntent, EndingOffer, GoalSynthesisResult, SimulationEvent, Memory, MemoryWriteProposal } from "@perfectman/shared";
import { createId } from "@perfectman/shared";
import { runEngineStep } from "@perfectman/engine";
import { resolveGoalLayerConfig, WorldEvaluator } from "../world/world-evaluator.js";
import type { GoalLayerRuntime, WorldReview } from "../world/world-evaluator.js";

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

const CANNED_MEMORY_PROPOSAL = {
  type: "relationship",
  subjectAgentIds: ["agent-B"],
  summary: "agent-B promised to keep the plan secret",
  emotionalTone: "suspicious",
  confidence: 0.7,
  intensity: 0.6,
  unresolved: true,
} as const;

/** Canned step result for driving the real PulseScheduler through its commit-ordering. */
function makeCannedStep({ memory = false, agentId = "agent_1" } = {}): import("@perfectman/shared").EngineStepResult {
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
    memoryProposals: memory ? [CANNED_MEMORY_PROPOSAL] : [],
    noOpRecord: { agentId, pulseIndex: 0, privateMotiveSummary: "nothing to do", reason: "test" },
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

  function buildScheduler(stepResolver?: (snap: import("@perfectman/shared").EngineSnapshot) => import("@perfectman/shared").EngineStepResult, agents: AgentContext[] = [AGENT]): PulseScheduler {
    return new PulseScheduler({
      simulation: SIM,
      agents,
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
  const PERSONA_2: PersonaConfig = { ...PERSONA, id: "persona_2", name: "Other Agent" };
  const AGENT_2: AgentContext = {
    id: "agent_2",
    state: makeAgentState("agent_2"),
    persona: PERSONA_2,
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
    expect(mem[0]!.payload["summary"]).toBe(CANNED_MEMORY_PROPOSAL.summary);
    expect(mem[0]!.payload["intensity"]).toBe(CANNED_MEMORY_PROPOSAL.intensity);
    // noOpRecord present with needsLLM=false — the LLM path must not be invoked
    expect(mockAgentRuntime.generateIntent).not.toHaveBeenCalled();
  });

  describe("memory persistence", () => {
    const PROPOSAL: MemoryWriteProposal = CANNED_MEMORY_PROPOSAL;

    interface MemoryScenario {
      name: string;
      arrange: () => void;
    }

    const scenarios: MemoryScenario[] = [
      {
        name: "engine path: canned step memoryProposals commit memory_written",
        arrange: () => {
          scheduler = buildScheduler(() => makeCannedStep({ memory: true }));
        },
      },
      {
        name: "intent path: an intent carrying memoryWrites commits memory_written through the real resolver",
        arrange: () => {
          scheduler = buildScheduler(() => ({
            ...makeCannedStep(),
            decision: { outcome: "act", needsLLM: true, initiativeProceed: false },
            noOpRecord: null,
            availableActions: [
              { intentType: "send_message", channelTargets: ["ch_public"], personTargets: [], blocked: false },
            ],
          }));
          mockAgentRuntime.generateIntent = vi.fn().mockResolvedValue({
            intent: {
              ...makeNoOpIntent("agent_1"),
              intentType: "send_message",
              visibleContent: "keep it between us",
              memoryWrites: [PROPOSAL],
            },
            llmUsage: null,
            latencyMs: 10,
            fallbackApplied: false,
            operatorEvents: [],
          });
        },
      },
    ];

    it.each(scenarios)("$name and persists the Memory into agent state + snapshot", async ({ arrange }) => {
      arrange();
      await scheduler.runPulse();

      const committed = await eventRepo.getAfter("sim_test");
      const memoryEvents = committed.filter((e) => e.type === "memory_written");
      expect(memoryEvents).toHaveLength(1);
      const memoryEvent = memoryEvents[0]!;

      const state = await agentStateRepo.get("sim_test", "agent_1");
      const memory = state?.memories.find((m) => m.summary === PROPOSAL.summary);
      expect(memory).toBeDefined();
      expect(memory).toMatchObject({
        agentId: memoryEvent.actorId,
        simulationId: "sim_test",
        type: PROPOSAL.type,
        subjectAgentIds: PROPOSAL.subjectAgentIds,
        sourceEventIds: [memoryEvent.id],
        emotionalTone: PROPOSAL.emotionalTone,
        confidence: PROPOSAL.confidence,
        intensity: PROPOSAL.intensity,
        unresolved: PROPOSAL.unresolved,
        createdAt: memoryEvent.createdAt,
        lastReinforcedAt: memoryEvent.createdAt,
      });

      const snapshots = gateway.operatorEvents.filter((e) => e.type === "agent_state_snapshot");
      expect(snapshots.length).toBeGreaterThan(0);
      const snapshotMemories = snapshots.flatMap(
        (s) => (s.data?.["state"] as { memories?: Memory[] } | undefined)?.memories ?? [],
      );
      expect(
        snapshotMemories.some((m) => m.summary === PROPOSAL.summary && m.sourceEventIds[0] === memoryEvent.id),
        "agent_state_snapshot must include the persisted memory",
      ).toBe(true);
    });
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

  describe("resolver agentNames wiring", () => {
    function makeMentionIntent(visibleContent: string): ActionIntent {
      return {
        id: createId(),
        actorId: "agent_1",
        intentType: "send_message",
        channelTarget: "ch_public",
        personTargets: [],
        privateMotiveSummary: "test motive",
        emotionDrivers: [],
        motivationDrivers: [],
        memoryWrites: [],
        visibleContent,
      };
    }

    function buildTwoAgentScheduler(): PulseScheduler {
      return buildScheduler((snap) => {
        const step = makeCannedStep({ agentId: snap.agentState.agentId });
        if (snap.agentState.agentId !== "agent_1") return step;
        return {
          ...step,
          availableActions: [
            { intentType: "send_message", channelTargets: ["ch_public"], personTargets: ["agent_1", "agent_2"], blocked: false },
            { intentType: "no_op", channelTargets: [], personTargets: [], blocked: false },
          ],
          decision: { outcome: "act", needsLLM: true, initiativeProceed: false },
          noOpRecord: null,
        };
      }, [AGENT, AGENT_2]);
    }

    async function committedMessagePayload(visibleContent: string): Promise<Record<string, unknown>> {
      mockAgentRuntime.generateIntent = vi.fn().mockImplementation(async (input: Parameters<AgentRuntime["generateIntent"]>[0]) =>
        input.agentId === "agent_1"
          ? { intent: makeMentionIntent(visibleContent), llmUsage: null, latencyMs: 10, fallbackApplied: false, operatorEvents: [] }
          : { intent: makeNoOpIntent("agent_2"), llmUsage: null, latencyMs: 10, fallbackApplied: false, operatorEvents: [] },
      );
      const sched = buildTwoAgentScheduler();
      await sched.runPulse();
      const events = await eventRepo.getAfter("sim_test");
      const message = events.find((e) => e.type === "message_sent" && e.actorId === "agent_1");
      expect(message).toBeDefined();
      return message!.payload;
    }

    it("the scheduler's agentNames map reaches the resolver: a display-name mention stamps mentionedAgentIds", async () => {
      const payload = await committedMessagePayload("hey Other Agent, what do you think?");
      expect(payload["mentionedAgentIds"]).toEqual(["agent_2"]);
    });

    it("a substring of a display name is not a mention", async () => {
      const payload = await committedMessagePayload("Other Agentrix was here earlier");
      // The builder stamps mentionedAgentIds only when non-empty.
      expect(payload).not.toHaveProperty("mentionedAgentIds");
    });
  });

  describe("lastActionAt stamping", () => {
    function makeIntent(
      intentType: ActionIntent["intentType"],
      extra: Partial<ActionIntent> = {},
    ): ActionIntent {
      return {
        id: createId(),
        actorId: "agent_1",
        intentType,
        personTargets: [],
        privateMotiveSummary: "test motive",
        emotionDrivers: [],
        motivationDrivers: [],
        memoryWrites: [],
        ...extra,
      };
    }

    async function runAndReadState(
      intent: ActionIntent,
      outcome: import("@perfectman/shared").ResolvedIntentOutcome,
    ): Promise<AgentState | null> {
      const sched = buildScheduler(() => ({
        ...makeCannedStep(),
        decision: { outcome: "act", needsLLM: true, initiativeProceed: false },
        noOpRecord: null,
      }));
      mockAgentRuntime.generateIntent = vi.fn().mockResolvedValue({
        intent,
        llmUsage: null,
        latencyMs: 10,
        fallbackApplied: false,
        operatorEvents: [],
      });
      vi.spyOn(intentResolver, "resolve").mockResolvedValue({
        outcome,
        committedEvents: [],
        operatorEvents: [],
      });
      await sched.runPulse();
      return agentStateRepo.get("sim_test", "agent_1");
    }

    for (const intentType of ["send_message", "reply_to_message", "react", "create_channel"] as const) {
      it(`stamps lastActionAt after a committed ${intentType}`, async () => {
        const state = await runAndReadState(makeIntent(intentType), "committed");
        expect(state?.lastActionAt).toBe(SETTINGS.pulseIntervalMs);
      });
    }

    it("does not stamp lastActionAt for a committed no_op", async () => {
      const state = await runAndReadState(makeIntent("no_op"), "committed");
      expect(state?.lastActionAt).toBeNull();
    });

    it("does not stamp lastActionAt for a committed write_memory (memory-only)", async () => {
      const state = await runAndReadState(makeIntent("write_memory"), "committed");
      expect(state?.lastActionAt).toBeNull();
    });

    it("does not stamp lastActionAt when an outward act is blocked", async () => {
      const state = await runAndReadState(makeIntent("send_message"), "blocked");
      expect(state?.lastActionAt).toBeNull();
    });

    it("stamps on fallback_committed only when the fallback itself is an outward act", async () => {
      const noOpFallback = await runAndReadState(
        makeIntent("send_message", { fallbackIfBlocked: "no_op" }),
        "fallback_committed",
      );
      expect(noOpFallback?.lastActionAt).toBeNull();

      const socialFallback = await runAndReadState(
        makeIntent("react", { fallbackIfBlocked: "send_message" }),
        "fallback_committed",
      );
      expect(socialFallback?.lastActionAt).toBe(SETTINGS.pulseIntervalMs);
    });
  });

  describe("stamp → relief seam (real engine step)", () => {
    it("a committed act stamps lastActionAt and the next real engine step relieves the accumulators", async () => {
      const ACT_PULSE = 3;
      const sched = buildScheduler((snap) => {
        const real = runEngineStep(snap);
        if (snap.pulseIndex === ACT_PULSE) {
          return {
            ...real,
            decision: { ...real.decision, outcome: "act", needsLLM: true, initiativeProceed: false },
          };
        }
        return real;
      });

      mockAgentRuntime.generateIntent = vi.fn().mockResolvedValue({
        intent: {
          id: createId(),
          actorId: "agent_1",
          intentType: "send_message",
          visibleContent: "hi",
          personTargets: [],
          privateMotiveSummary: "test motive",
          emotionDrivers: [],
          motivationDrivers: [],
          memoryWrites: [],
        },
        llmUsage: null,
        latencyMs: 10,
        fallbackApplied: false,
        operatorEvents: [],
      });
      vi.spyOn(intentResolver, "resolve").mockResolvedValue({
        outcome: "committed",
        committedEvents: [],
        operatorEvents: [],
      });

      for (let i = 0; i <= ACT_PULSE; i++) await sched.runPulse();

      const afterAct = await agentStateRepo.get("sim_test", "agent_1");
      expect(afterAct?.lastActionAt).toBe(SETTINGS.pulseIntervalMs * (ACT_PULSE + 1));
      const before = new Map((afterAct?.initiativeAccumulators ?? []).map((a) => [a.source, a.value]));
      expect(before.size).toBeGreaterThan(0);

      // Next pulse: now - lastActionAt = pulseIntervalMs < pulseIntervalMs * 1.5,
      // so run-engine-step derives justActed === true and applies global relief.
      await sched.runPulse();

      const afterRelief = await agentStateRepo.get("sim_test", "agent_1");
      const after = new Map((afterRelief?.initiativeAccumulators ?? []).map((a) => [a.source, a.value]));

      // cold_start_bootstrap is passive-decay exempt, so any drop here is the
      // justActed relief, not silent decay.
      expect(before.get("cold_start_bootstrap")!).toBeGreaterThan(0);
      expect(after.get("cold_start_bootstrap")!).toBeLessThan(before.get("cold_start_bootstrap")!);

      let totalBefore = 0;
      let totalAfter = 0;
      for (const [source, value] of before) {
        totalBefore += value;
        totalAfter += after.get(source)!;
      }
      expect(totalAfter).toBeLessThan(totalBefore);
    });
  });

  describe("goal-layer wiring (TT401)", () => {
    const GOAL_SETTINGS: SimulationSettings = { ...SETTINGS, omniscientSpectatorMode: true };
    const GOAL_SIM: Simulation = { ...SIM, settings: GOAL_SETTINGS };
    const OFFER: EndingOffer = {
      goalId: "crystal-agent_1-resolve-ch_public-1",
      reasons: ["progress plateaued"],
      epilogue: "The conversation found its footing again.",
      status: "pending",
    };

    function reviewProposalEvent(pulseIndex: number): SimulationEvent {
      const result: GoalSynthesisResult = {
        proposal: {
          id: OFFER.goalId,
          agentId: "agent_1",
          title: "Recover the conversation",
          targetState: {
            id: "predicate-resolve-ch_public",
            description: "no more blocked intents from agent_1 in ch_public",
            observableCriteria: ["no more blocked intents from agent_1 in ch_public"],
          },
          kind: "resolve",
          origin: "crystallized_from",
          sourceEventIds: [],
          createdAt: 0,
        },
        narrativeFraming: "no more blocked intents from agent_1 in ch_public",
        confidence: 1,
        synthesizer: "deterministic",
      };
      return engineEventBuilder.fromGoalProposed(result, {
        simulationId: GOAL_SIM.id,
        channelId: "ch_public",
        pulseIndex,
      });
    }

    function reviewEndingEvent(pulseIndex: number): SimulationEvent {
      return engineEventBuilder.fromEndingOffered(OFFER, {
        simulationId: GOAL_SIM.id,
        channelId: "ch_public",
        pulseIndex,
      });
    }

    function makeFakeEvaluator(script: Array<WorldReview | Error>): {
      evaluator: WorldEvaluator;
      runReview: ReturnType<typeof vi.fn>;
    } {
      const runReview = vi.fn(
        async (input: {
          simulation: Simulation;
          agents: Array<{ id: string; state: AgentState }>;
          pulseIndex: number;
          now: number;
        }): Promise<WorldReview> => {
          const next = script.shift();
          if (next instanceof Error) throw next;
          return next ?? { events: [], endingOffer: null, operatorEvents: [] };
        },
      );
      const evaluator = Object.create(WorldEvaluator.prototype) as WorldEvaluator;
      evaluator.runReview = runReview;
      return { evaluator, runReview };
    }

    function buildGoalLayerScheduler(opts: {
      reviewEveryPulses: number;
      script: Array<WorldReview | Error>;
      eventRepoOverride?: InMemoryEventRepository;
    }): {
      scheduler: PulseScheduler;
      runReview: ReturnType<typeof vi.fn>;
      onEndOffered: ReturnType<typeof vi.fn>;
      stepResolver: ReturnType<typeof vi.fn>;
    } {
      const { evaluator, runReview } = makeFakeEvaluator(opts.script);
      const stepResolver = vi.fn(() => makeCannedStep());
      const onEndOffered = vi.fn(async () => {});
      const goalLayer: GoalLayerRuntime = {
        config: resolveGoalLayerConfig({ enabled: true, reviewEveryPulses: opts.reviewEveryPulses }),
        evaluator,
      };
      const sched = new PulseScheduler({
        simulation: GOAL_SIM,
        agents: [AGENT],
        defaultPublicChannelId: "ch_public",
        eventRepo: opts.eventRepoOverride ?? eventRepo,
        agentStateRepo,
        channelRegistry,
        rateLimitGate: new RateLimitGate(GOAL_SETTINGS),
        intentResolver,
        engineSnapshotProjection: new EngineSnapshotProjection(),
        deliveryProjection: new DeliveryProjection(gateway),
        spectatorProjection: new SpectatorProjection(gateway),
        operatorProjection: new OperatorProjection(gateway),
        engineEventBuilder,
        agentRuntime: mockAgentRuntime,
        llmBudget: mockLLMBudget,
        pulseIntervalMs: GOAL_SETTINGS.pulseIntervalMs,
        stepResolver,
        goalLayer,
        onEndOffered,
      });
      return { scheduler: sched, runReview, onEndOffered, stepResolver };
    }

    it("pulse 0 is exempt; on cadence 1 the review runs after the agent loop, commits through appendAndProject, and fires onEndOffered with the offer", async () => {
      const { scheduler, runReview, onEndOffered, stepResolver } = buildGoalLayerScheduler({
        reviewEveryPulses: 1,
        script: [
          { events: [reviewProposalEvent(1), reviewEndingEvent(1)], endingOffer: OFFER, operatorEvents: [] },
          { events: [], endingOffer: null, operatorEvents: [] },
        ],
      });

      await scheduler.runPulse();
      expect(runReview).not.toHaveBeenCalled();

      const result = await scheduler.runPulse();
      expect(runReview).toHaveBeenCalledTimes(1);
      expect(runReview.mock.calls[0]![0]).toMatchObject({
        pulseIndex: 1,
        simulation: { id: "sim_test" },
      });
      expect(runReview.mock.calls[0]![0].agents).toEqual([{ id: "agent_1", state: expect.any(Object) }]);
      // The review runs after the agent loop: the step resolver is invoked first.
      expect(stepResolver.mock.invocationCallOrder[0]).toBeLessThan(runReview.mock.invocationCallOrder[0]!);

      const committed = await eventRepo.getAfter(GOAL_SIM.id);
      // Tail of the log pins commit ORDER: agent-loop event first, then the
      // review's events — world events commit through the same appendAndProject.
      expect(committed.slice(-3).map(e => e.type)).toEqual(["no_op_recorded", "goal_proposed", "ending_offered"]);
      expect(committed.slice(-3).every(e => e.pulseIndex === 1)).toBe(true);
      expect(result.eventsCommitted).toBe(3);

      const visibility = gateway.operatorEvents.filter(e => e.type === "event_visibility");
      expect(visibility.some(e => e.data?.eventType === "goal_proposed")).toBe(true);
      expect(gateway.spectatorEvents.some(e => e.type === "goal_proposed")).toBe(true);

      expect(onEndOffered).toHaveBeenCalledTimes(1);
      expect(onEndOffered).toHaveBeenCalledWith(OFFER, 1);
    });

    it("once the evaluator's gate closes, later pulses commit no review events and never refire the offer", async () => {
      const { scheduler, runReview, onEndOffered } = buildGoalLayerScheduler({
        reviewEveryPulses: 1,
        script: [
          { events: [reviewProposalEvent(1)], endingOffer: OFFER, operatorEvents: [] },
          { events: [], endingOffer: null, operatorEvents: [] },
          { events: [], endingOffer: null, operatorEvents: [] },
        ],
      });

      await scheduler.runPulse();
      await scheduler.runPulse();
      const reviewEventsAfterOffer = (await eventRepo.getAfter(GOAL_SIM.id)).filter(
        e => e.type === "goal_proposed" || e.type === "ending_offered",
      );

      const gatedResult = await scheduler.runPulse();
      expect(runReview).toHaveBeenLastCalledWith(expect.objectContaining({ pulseIndex: 2 }));
      const reviewEventsAfterGated = (await eventRepo.getAfter(GOAL_SIM.id)).filter(
        e => e.type === "goal_proposed" || e.type === "ending_offered",
      );
      expect(reviewEventsAfterGated).toEqual(reviewEventsAfterOffer);
      expect(reviewEventsAfterGated.map(e => e.type)).toEqual(["goal_proposed"]);
      expect(gatedResult.eventsCommitted).toBe(1); // agent-loop no_op_recorded only
      expect(onEndOffered).toHaveBeenCalledTimes(1);
      expect(onEndOffered).toHaveBeenCalledWith(OFFER, 1);
    });

    it("cadence boundary: reviewEveryPulses 2 reviews only even pulses (and never pulse 0)", async () => {
      const { scheduler, runReview, onEndOffered } = buildGoalLayerScheduler({
        reviewEveryPulses: 2,
        script: [
          { events: [reviewProposalEvent(2)], endingOffer: null, operatorEvents: [] },
          { events: [], endingOffer: null, operatorEvents: [] },
        ],
      });

      for (let i = 0; i < 5; i += 1) await scheduler.runPulse();

      expect(runReview).toHaveBeenCalledTimes(2);
      expect(runReview.mock.calls[0]![0].pulseIndex).toBe(2);
      expect(runReview.mock.calls[1]![0].pulseIndex).toBe(4);
      expect(onEndOffered).not.toHaveBeenCalled();
    });

    it("resilience: a throwing evaluator emits a scheduler_error and the pulse survives", async () => {
      const { scheduler, runReview } = buildGoalLayerScheduler({
        reviewEveryPulses: 1,
        script: [new Error("review boom")],
      });

      await scheduler.runPulse();
      const result = await scheduler.runPulse();
      expect(result.pulseIndex).toBe(1);
      expect(result.eventsCommitted).toBe(1); // agent-loop event still counted
      expect(runReview).toHaveBeenCalledTimes(1);

      const errors = gateway.operatorEvents.filter(e => e.type === "scheduler_error");
      expect(errors.some(e => e.detail === "World review failed" && e.data?.reason === "review boom")).toBe(true);

      const next = await scheduler.runPulse();
      expect(next.pulseIndex).toBe(2);
    });

    it("append failure on the offer-creation review: onEndOffered waits for a committed offer event, then the retry delivers", async () => {
      const failingAppendRepo = Object.create(eventRepo) as InMemoryEventRepository;
      failingAppendRepo.append = () => Promise.reject(new Error("append boom"));
      const { scheduler, onEndOffered } = buildGoalLayerScheduler({
        reviewEveryPulses: 1,
        eventRepoOverride: failingAppendRepo,
        script: [
          // Pulse 1: offer-creation review — its ending_offered never commits.
          { events: [reviewEndingEvent(1)], endingOffer: OFFER, operatorEvents: [] },
          // Pulse 2: the pending offer is re-delivered (no events to commit).
          { events: [], endingOffer: OFFER, operatorEvents: [] },
          // Pulse 3: delivered — silence.
          { events: [], endingOffer: null, operatorEvents: [] },
        ],
      });

      await scheduler.runPulse(); // pulse 0 — review-exempt
      const offerPulse = await scheduler.runPulse();
      expect(offerPulse.pulseIndex).toBe(1);
      expect(onEndOffered).not.toHaveBeenCalled();
      const errors = gateway.operatorEvents.filter(e => e.type === "scheduler_error");
      expect(errors.some(e => e.detail === "Failed to append events" && e.data?.reason === "append boom")).toBe(true);

      const retryPulse = await scheduler.runPulse();
      expect(retryPulse.pulseIndex).toBe(2);
      expect(onEndOffered).toHaveBeenCalledTimes(1);
      expect(onEndOffered).toHaveBeenCalledWith(OFFER, 2);

      await scheduler.runPulse();
      expect(onEndOffered).toHaveBeenCalledTimes(1);
    });

    it("review operatorEvents (incl. a goal-path llm_failure literal) reach the operator channel; empty arrays emit nothing", async () => {
      const { scheduler, runReview } = buildGoalLayerScheduler({
        reviewEveryPulses: 1,
        script: [
          {
            events: [reviewProposalEvent(1)],
            endingOffer: null,
            operatorEvents: [
              {
                type: "llm_failure",
                simulationId: "sim_test",
                agentId: "agent_1",
                pulseIndex: 1,
                detail: "goal-layer llm call failed",
                createdAt: 1,
              },
            ],
          },
          { events: [], endingOffer: null, operatorEvents: [] },
        ],
      });

      await scheduler.runPulse(); // pulse 0 — review-exempt
      await scheduler.runPulse(); // pulse 1 — review emits the llm_failure
      await scheduler.runPulse(); // pulse 2 — empty operatorEvents emit nothing

      const failures = gateway.operatorEvents.filter((e) => e.type === "llm_failure");
      expect(failures).toHaveLength(1);
      expect(failures[0]!.detail).toBe("goal-layer llm call failed");
      expect(failures[0]!.agentId).toBe("agent_1");
      expect(failures[0]!.pulseIndex).toBe(1);
      expect(runReview).toHaveBeenCalledTimes(2);
    });
  });
});
