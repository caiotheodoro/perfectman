import { describe, it, expect } from "vitest";
import type {
  AgentState,
  Channel,
  CommittedEvent,
  EmergentGoal,
  GoalProposal,
  Memory,
  OperatorEvent,
  SelfVerdict,
  Simulation,
  SimulationEvent,
  WorldVerdict,
} from "@perfectman/shared";
import { evaluateEndCondition } from "@perfectman/engine";
import {
  InMemoryAgentStateRepository,
  InMemoryChannelRepository,
  InMemoryEventRepository,
} from "../../in-memory-stores.js";
import { ChannelRegistry } from "../../channel-registry.js";
import type { IEventRepository } from "../../../persistence/repositories.js";
import { GoalRegistry } from "../goal-registry.js";
import {
  WorldEvaluator,
  buildAgentContextDigest,
  resolveGoalLayerConfig,
} from "../world-evaluator.js";
import type { GoalLayerRuntimeConfig, WorldLLMRuntime } from "../world-evaluator.js";
import { GoalLayerLLMClient, deterministicPassthrough } from "../goal-layer-llm.js";
import type { GoalLayerCallInput, GoalLayerLLMOutcome } from "../goal-layer-llm.js";
import type { GoalLayerClientFactory } from "../goal-synthesizer.js";
import type { LLMConfig } from "../../../llm/llm-config.js";
import { LLMBudgetTracker } from "../../../llm/llm-budget.js";

const SIM_ID = "sim_1";
const CHANNEL_ID = "ch_public";
const AGENT_1 = "agent_1";
const AGENT_2 = "agent_2";
const RESOLVE_GOAL_ID = `crystal-${AGENT_1}-resolve-${CHANNEL_ID}`;

type Harness = {
  eventRepo: IEventRepository;
  sim: Simulation;
  agents: Array<{ id: string; state: AgentState }>;
  evaluator: WorldEvaluator;
  registry: GoalRegistry;
};

function makeAgentState(agentId: string, memories: Memory[] = []): AgentState {
  return {
    agentId,
    simulationId: SIM_ID,
    personaId: "persona-mia",
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
    memories,
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeSim(): Simulation {
  return {
    id: SIM_ID,
    name: "goal-layer-test",
    status: "running",
    agentIds: [AGENT_1, AGENT_2],
    channelIds: [CHANNEL_ID],
    settings: {
      omniscientSpectatorMode: false,
      allowPrivateChannels: false,
      maxPrivateChannelsPerAgent: 0,
      maxMessagesPerMinutePerAgent: 5,
      llmCallBudgetPerMinute: 10,
      pulseIntervalMs: 2000,
      tokenBudgetPerHour: 10000,
    },
    seed: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

async function makeHarness(
  config?: GoalLayerRuntimeConfig,
  llmRuntime?: WorldLLMRuntime,
): Promise<Harness> {
  const eventRepo = new InMemoryEventRepository();
  const agentStateRepo = new InMemoryAgentStateRepository();
  const channelRepo = new InMemoryChannelRepository();
  const channelRegistry = new ChannelRegistry(channelRepo);
  const channel: Channel = {
    id: CHANNEL_ID,
    simulationId: SIM_ID,
    type: "public_channel",
    name: "public",
    createdBy: "system",
    memberAgentIds: [AGENT_1, AGENT_2],
    spectatorVisible: true,
    operatorVisible: true,
    createdForMotives: [],
    status: "active",
    createdAt: 0,
    updatedAt: 0,
  };
  await channelRepo.create(channel);
  await channelRepo.addMembership({ channelId: CHANNEL_ID, agentId: AGENT_1, joinedAt: 0 });
  await channelRepo.addMembership({ channelId: CHANNEL_ID, agentId: AGENT_2, joinedAt: 0 });
  const agents = [
    { id: AGENT_1, state: makeAgentState(AGENT_1) },
    { id: AGENT_2, state: makeAgentState(AGENT_2) },
  ];
  for (const agent of agents) {
    await agentStateRepo.upsert(agent.state);
  }
  const registry = new GoalRegistry();
  const evaluator = new WorldEvaluator(
    eventRepo,
    agentStateRepo,
    channelRegistry,
    registry,
    config ?? resolveGoalLayerConfig({ enabled: true, reviewEveryPulses: 1 }),
    llmRuntime,
  );
  return { eventRepo, sim: makeSim(), agents, evaluator, registry };
}

function publicVisibility(): SimulationEvent["visibility"] {
  return {
    visibleToAgents: [],
    visibleToSpectators: true,
    visibleToOperators: true,
    visibilityReason: "public",
  };
}

function makeBlockedEvent(id: string, createdAt: number): CommittedEvent {
  return {
    id,
    simulationId: SIM_ID,
    channelId: CHANNEL_ID,
    actorId: AGENT_1,
    type: "intent_blocked",
    payload: { reason: "rate limited" },
    sourceEventIds: [],
    emotionalSalience: "low",
    pulseIndex: 0,
    createdAt,
    visibility: publicVisibility(),
  };
}

function makeGazeEvent(id: string, createdAt: number, actorId = AGENT_2): CommittedEvent {
  return {
    id,
    simulationId: SIM_ID,
    channelId: CHANNEL_ID,
    actorId,
    type: "message_sent",
    payload: { content: `solid effort from ${AGENT_1} here` },
    sourceEventIds: [],
    emotionalSalience: "low",
    pulseIndex: 0,
    createdAt,
    visibility: publicVisibility(),
  };
}

function makeWitnessedEvent(
  id: string,
  createdAt: number,
  channelId = CHANNEL_ID,
): CommittedEvent {
  return {
    id,
    simulationId: SIM_ID,
    channelId,
    actorId: AGENT_2,
    type: "message_sent",
    payload: { content: "the storm passed quickly" },
    sourceEventIds: [],
    emotionalSalience: "high",
    pulseIndex: 0,
    createdAt,
    visibility: publicVisibility(),
  };
}

function makeRidiculeEvent(id: string, createdAt: number): CommittedEvent {
  return {
    id,
    simulationId: SIM_ID,
    channelId: CHANNEL_ID,
    actorId: AGENT_2,
    type: "reaction_sent",
    payload: { emoji: "👎", targetEventId: "seed-1" },
    sourceEventIds: [],
    emotionalSalience: "low",
    pulseIndex: 0,
    createdAt,
    visibility: publicVisibility(),
  };
}

function makeStagnationEvent(
  id: string,
  level: "red" | "critical",
  createdAt: number,
): CommittedEvent {
  return {
    id,
    simulationId: SIM_ID,
    channelId: CHANNEL_ID,
    actorId: "system",
    type: "stagnation_detected",
    payload: {
      level,
      compositeScore: 0.9,
      metrics: {
        simulationId: SIM_ID,
        pulseIndex: 10,
        bdi: 0.2, rdv: 0.1, ige: 0.3, cue: 0.2, eri: 0.2, isd: 0.1, cns: 0.2,
        compositeScore: 0.9,
        level,
      },
    },
    sourceEventIds: [],
    emotionalSalience: level === "critical" ? "critical" : "high",
    pulseIndex: 10,
    createdAt,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: false,
      visibleToOperators: true,
      visibilityReason: "operator_only",
    },
  };
}

async function seedBlocks(eventRepo: IEventRepository): Promise<void> {
  await eventRepo.append(SIM_ID, [
    makeBlockedEvent("seed-1", 1000),
    makeBlockedEvent("seed-2", 2000),
    makeBlockedEvent("seed-3", 3000),
  ]);
}

async function seedGazes(eventRepo: IEventRepository): Promise<void> {
  // Other-agent gazes: crystallize an affiliation goal for their author, so
  // a next goal is pending on the review the plateau window closes.
  const at = Date.now();
  await eventRepo.append(SIM_ID, [
    makeGazeEvent("gaze-1", at),
    makeGazeEvent("gaze-2", at + 1),
    makeGazeEvent("gaze-3", at + 2),
  ]);
}

async function seedWitnessed(eventRepo: IEventRepository): Promise<void> {
  // A high-salience other-agent event: keeps a legacy candidate pending so
  // the plateaued resolve goal does not offer until the review after.
  await eventRepo.append(SIM_ID, [makeWitnessedEvent("witness-1", Date.now())]);
}

async function runReview(
  harness: Harness,
  pulseIndex: number,
  now: number,
): Promise<{
  events: SimulationEvent[];
  endingOffer: WorldReviewEnding;
  operatorEvents: OperatorEvent[];
}> {
  const result = await harness.evaluator.runReview({
    simulation: harness.sim,
    agents: harness.agents,
    pulseIndex,
    now,
  });
  if (result.events.length > 0) {
    await harness.eventRepo.append(SIM_ID, result.events);
  }
  return result;
}

type WorldReviewEnding = { goalId: string; reasons: string[]; epilogue: string } | null;

function asEndingOffer(value: unknown): WorldReviewEnding {
  if (value === null || typeof value !== "object") return null;
  const offer = value as { goalId?: unknown; reasons?: unknown; epilogue?: unknown };
  if (offer.goalId === undefined) return null;
  return {
    goalId: String(offer.goalId),
    reasons: Array.isArray(offer.reasons) ? offer.reasons.map(String) : [],
    epilogue: String(offer.epilogue ?? ""),
  };
}

function makeProposal(id: string): GoalProposal {
  return {
    id,
    agentId: AGENT_1,
    title: `Goal ${id}`,
    targetState: {
      id: `predicate-${id}`,
      description: `no more blocked intents from ${AGENT_1} in ${CHANNEL_ID}`,
      observableCriteria: [`no more blocked intents from ${AGENT_1} in ${CHANNEL_ID}`],
    },
    kind: "resolve",
    origin: "crystallized_from",
    sourceEventIds: [],
    createdAt: 1000,
  };
}

const FAKE_MOCK_LLM: LLMConfig = {
  providerType: "mock",
  modelName: "mock-model",
  baseUrl: "http://localhost",
  maxInputTokens: 2000,
  maxOutputTokens: 512,
  temperature: 1,
  timeoutMs: 5000,
  retryCount: 0,
};

type FakeCallRecord = {
  params: { agentId: string; pulseIndex: number };
  input: GoalLayerCallInput;
};

/** Deterministic canned outcome mirroring the client's mock leg (D-19). */
function cannedLlmOutcome(input: GoalLayerCallInput): GoalLayerLLMOutcome {
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
        claim: "in_progress" as const,
        confidence: 0.8,
        feltSignal: 0.5,
        narrative: `${goal.title}: in progress`,
      })),
    },
    operatorEvents: [],
  };
}

/** Deluded canned outcome: a genuine LLM claim of "reached" for every active goal (D-19/D-23). */
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

/** Budget-blocked canned outcome: passthrough + no verdicts, nothing stored (D-19). */
function blockedLlmOutcome(input: GoalLayerCallInput): GoalLayerLLMOutcome {
  return {
    result: deterministicPassthrough(input.candidates),
    operatorEvents: [
      {
        type: "llm_budget_exceeded",
        simulationId: SIM_ID,
        agentId: AGENT_1,
        pulseIndex: 1,
        detail: `LLM budget pre-check blocked goal synthesis for agent ${AGENT_1}`,
        createdAt: 1000,
      },
    ],
  };
}

function makeFakeLLMRuntime(opts: {
  throwOnCall?: boolean;
  outcome?: (input: GoalLayerCallInput) => GoalLayerLLMOutcome;
}): { llmRuntime: WorldLLMRuntime; calls: FakeCallRecord[] } {
  const calls: FakeCallRecord[] = [];
  const clientFactory: GoalLayerClientFactory = (params) => {
    const caller = Object.create(GoalLayerLLMClient.prototype) as GoalLayerLLMClient;
    caller.call = async (input: GoalLayerCallInput): Promise<GoalLayerLLMOutcome> => {
      calls.push({ params: { agentId: params.agentId, pulseIndex: params.pulseIndex }, input });
      if (opts.throwOnCall) throw new Error("client boom");
      return opts.outcome ? opts.outcome(input) : cannedLlmOutcome(input);
    };
    return caller;
  };
  return {
    llmRuntime: {
      simulationId: SIM_ID,
      llmConfigs: new Map([
        [AGENT_1, FAKE_MOCK_LLM],
        [AGENT_2, FAKE_MOCK_LLM],
      ]),
      budget: new LLMBudgetTracker(),
      clientFactory,
    },
    calls,
  };
}

describe("WorldEvaluator.runReview — deterministic gate timeline", () => {
  it("(a) review 1 proposes the crystallized goal to its agent", async () => {
    const harness = await makeHarness();
    await seedBlocks(harness.eventRepo);

    const review = await runReview(harness, 1, 1 * 1000);
    expect(review.events.map((e) => e.type)).toEqual(["goal_proposed"]);
    expect(review.endingOffer).toBeNull();

    const proposed = review.events[0]!;
    expect(proposed.actorId).toBe("system");
    expect(proposed.visibility.visibleToAgents).toEqual([AGENT_1]);
    expect(proposed.visibility.visibleToSpectators).toBe(true);
    expect(proposed.visibility.visibilityReason).toBe("goal_proposal");
    expect(proposed.payload["goalId"]).toBe(RESOLVE_GOAL_ID);
    const proposal = proposed.payload["proposal"] as Record<string, unknown>;
    expect(proposal["id"]).toBe(RESOLVE_GOAL_ID);
    expect(proposal["sourceEventIds"]).toEqual(["seed-1", "seed-2", "seed-3"]);
    expect(proposed.payload["narrativeFraming"]).toBe(
      (proposal["targetState"] as Record<string, unknown>)["description"],
    );
    expect(proposed.payload["confidence"]).toBe(1);
    expect(proposed.payload["synthesizer"]).toBe("deterministic");
  });

  it("(b) review 2 accepts the proposal and opens the verdict pipeline", async () => {
    const harness = await makeHarness();
    await seedBlocks(harness.eventRepo);
    await runReview(harness, 1, 1 * 1000);

    const review = await runReview(harness, 2, 2 * 1000);
    const types = review.events.map((e) => e.type);
    expect(types).toContain("goal_accepted");
    expect(types).toContain("world_verdict");
    expect(types).toContain("delusion_gap_sampled");

    const accepted = review.events.find((e) => e.type === "goal_accepted")!;
    expect(accepted.payload["goalId"]).toBe(RESOLVE_GOAL_ID);
    const goal = accepted.payload["goal"] as Record<string, unknown>;
    expect(goal["status"]).toBe("active");
    expect(accepted.visibility.visibleToAgents).toEqual([AGENT_1]);

    const verdictEvent = review.events.find((e) => e.type === "world_verdict")!;
    expect(verdictEvent.visibility.visibilityReason).toBe("goal_layer");
    expect(verdictEvent.visibility.visibleToAgents).toEqual([]);
    const verdict = verdictEvent.payload["verdict"] as Record<string, unknown>;
    expect(verdict["goalId"]).toBe(RESOLVE_GOAL_ID);
    expect(verdict["determination"]).toBe("contested");
    expect((verdict["objective"] as Record<string, unknown>)["distanceToTarget"]).toBe(0.5);
    expect((verdict["objective"] as Record<string, unknown>)["plateaued"]).toBe(false);

    const gapEvent = review.events.find((e) => e.type === "delusion_gap_sampled")!;
    expect(gapEvent.payload["goalId"]).toBe(RESOLVE_GOAL_ID);
    expect(gapEvent.payload["agentId"]).toBe(AGENT_1);
    expect(gapEvent.payload["magnitude"]).toBe(0);
    expect(gapEvent.payload["divergenceFromLog"]).toBe(0);
    expect(gapEvent.payload["divergenceFromWorld"]).toBe(0);
    expect(typeof gapEvent.payload["at"]).toBe("number");
  });

  it("(c) reviews 3–5 commit verdicts; the plateau closes with a next goal pending", async () => {
    const harness = await makeHarness();
    await seedBlocks(harness.eventRepo);
    await runReview(harness, 1, 1 * 1000);
    await runReview(harness, 2, 2 * 1000);

    // Review 3 re-crystallizes the already-active resolve goal and nothing
    // else: the active-goal dedupe and the world-layer event filter both
    // hold, so exactly verdict + gap commit.
    const r3 = await runReview(harness, 3, 3 * 1000);
    expect(r3.events.map((e) => e.type)).toEqual(["world_verdict", "delusion_gap_sampled"]);
    expect((r3.events[0]!.payload["verdict"] as Record<string, unknown>)["objective"]).toMatchObject({ plateaued: false });

    await seedGazes(harness.eventRepo);

    // Other-agent gazes crystallize an affiliation goal for their author
    // (distinct agent id) — pending, so the plateaued goal does not offer.
    const r4 = await runReview(harness, 4, 4 * 1000);
    expect(r4.events.map((e) => e.type)).toEqual([
      "goal_proposed",
      "world_verdict",
      "delusion_gap_sampled",
    ]);
    expect(r4.events[0]!.payload["goalId"]).toBe(
      `crystal-${AGENT_2}-affiliation-${CHANNEL_ID}`,
    );
    expect(
      (r4.events[1]!.payload["verdict"] as Record<string, unknown>)["objective"],
    ).toMatchObject({ plateaued: true });

    await seedWitnessed(harness.eventRepo);

    // A witnessed high-salience event from another agent keeps a legacy
    // candidate pending, so the verdicts keep committing without an offer.
    const r5 = await runReview(harness, 5, 5 * 1000);
    expect(r5.events.map((e) => e.type)).toEqual([
      "goal_accepted",
      "goal_proposed",
      "world_verdict",
      "delusion_gap_sampled",
      "world_verdict",
      "delusion_gap_sampled",
    ]);
    expect(r5.events[0]!.payload["goalId"]).toBe(
      `crystal-${AGENT_2}-affiliation-${CHANNEL_ID}`,
    );
    expect(r5.events[1]!.payload["goalId"]).toBe(
      `crystal-${AGENT_1}-legacy-${CHANNEL_ID}`,
    );
    expect(
      (r5.events[2]!.payload["verdict"] as Record<string, unknown>)["objective"],
    ).toMatchObject({ plateaued: true });
  });

  it("(d) review 6 offers the plateau ending; review 7 is gated empty", async () => {
    const harness = await makeHarness();
    await seedBlocks(harness.eventRepo);
    await runReview(harness, 1, 1 * 1000);
    await runReview(harness, 2, 2 * 1000);
    await runReview(harness, 3, 3 * 1000);
    await seedGazes(harness.eventRepo);
    await runReview(harness, 4, 4 * 1000);
    await seedWitnessed(harness.eventRepo);
    await runReview(harness, 5, 5 * 1000);

    const r6 = await runReview(harness, 6, 6 * 1000);
    const types = r6.events.map((e) => e.type);
    expect(types).toContain("ending_offered");
    expect(types).toContain("goal_accepted"); // the witnessed legacy proposal is promoted this review
    expect(r6.events.find((e) => e.type === "ending_offered")!.visibility.visibilityReason).toBe("goal_layer");
    expect(r6.events.find((e) => e.type === "ending_offered")!.payload["goalId"]).toBe(RESOLVE_GOAL_ID);
    expect(r6.endingOffer).not.toBeNull();
    const offer = asEndingOffer(r6.endingOffer)!;
    expect(offer.goalId).toBe(RESOLVE_GOAL_ID);
    expect(offer.reasons).toContain("progress plateaued");
    expect(offer.epilogue.length).toBeGreaterThan(0);

    const r7 = await runReview(harness, 7, 7 * 1000);
    expect(r7.events).toEqual([]);
    expect(r7.endingOffer).toBeNull();
  });

  it("(e) an empty log produces no events and no offer (G1 — nothing seeded)", async () => {
    const harness = await makeHarness();
    const review = await runReview(harness, 1, 1 * 1000);
    expect(review.events).toEqual([]);
    expect(review.endingOffer).toBeNull();
  });

  it("(f) a deluded achiever re-goals; a world-not-reached arc never terminates", async () => {
    const goal: EmergentGoal = {
      id: RESOLVE_GOAL_ID,
      agentId: AGENT_1,
      title: "Overcome the repeated block in ch_public",
      targetState: {
        id: "predicate-resolve-ch_public",
        description: "no more blocked intents from agent_1 in ch_public",
        observableCriteria: ["no more blocked intents from agent_1 in ch_public"],
      },
      kind: "resolve",
      status: "active",
      origin: "crystallized_from",
      sourceEventIds: ["seed-1"],
      createdAt: 3000,
    };
    const selfVerdict: SelfVerdict = {
      agentId: AGENT_1,
      goalId: RESOLVE_GOAL_ID,
      claim: "reached",
      confidence: 0.9,
      feltSignal: 0.8,
      narrative: "Overcome the repeated block in ch_public: reached",
    };
    const worldVerdict: WorldVerdict = {
      goalId: RESOLVE_GOAL_ID,
      objective: { distanceToTarget: 0.5, progressRate: 0, plateaued: false },
      consensus: "rejected",
      determination: "not_reached",
      confidence: 0.75,
    };
    // The flagship G5 branch: claim reached vs world not_reached ⇒ re_goal.
    const result = evaluateEndCondition(goal, selfVerdict, worldVerdict, {
      completionBeatPresent: false,
      meaningMade: false,
      nextGoalAvailable: true,
    });
    expect(result.kind).toBe("re_goal");

    // runReview: an arc the world keeps failing never offers — the ridicule
    // keeps the verdict not_reached, and a fresh witnessed proposal lands
    // every review, so the plateau-story-over branch (plateaued && no next
    // goal) can never close while a next goal is pending (G5).
    const harness = await makeHarness(
      resolveGoalLayerConfig({
        enabled: true,
        reviewEveryPulses: 1,
        // The arc accumulates one legacy bucket per review; the candidate
        // cap must hold them all so a next goal stays pending every review.
        synthesizer: { mode: "deterministic", intervalPulses: 1, maxCandidatesPerReview: 10 },
      }),
    );
    await seedBlocks(harness.eventRepo);
    await harness.eventRepo.append(SIM_ID, [makeRidiculeEvent("ridicule-1", 1500)]);
    await runReview(harness, 1, 1 * 1000);
    await runReview(harness, 2, 2 * 1000);
    for (let pulse = 3; pulse <= 8; pulse += 1) {
      // A fresh channel per witness keeps each legacy proposal distinct, so
      // a next goal stays pending on every review of the arc.
      await harness.eventRepo.append(SIM_ID, [
        makeWitnessedEvent(`witness-${pulse}`, Date.now(), `ch_w${pulse}`),
      ]);
      const review = await runReview(harness, pulse, pulse * 1000);
      expect(review.events.some((e) => e.type === "goal_proposed")).toBe(true);
      expect(review.events.some((e) => e.type === "ending_offered")).toBe(false);
      expect(review.endingOffer).toBeNull();
    }
  });

  it("(g) buildAgentContextDigest carries persona, capped memories, newest motives", () => {
    const memories: Memory[] = [];
    for (let i = 0; i < 12; i += 1) {
      memories.push({
        id: `mem-${i}`,
        agentId: AGENT_1,
        simulationId: SIM_ID,
        type: "episodic",
        subjectAgentIds: [],
        sourceEventIds: [`src-${i}`],
        summary: `memory summary ${i}`,
        emotionalTone: "neutral",
        confidence: 0.8,
        unresolved: false,
        createdAt: 100 + i,
        lastReinforcedAt: 100 + i,
      });
    }
    const agentState = makeAgentState(AGENT_1, memories);
    const log: CommittedEvent[] = [];
    for (let i = 1; i <= 7; i += 1) {
      log.push({
        id: `noop-${i}`,
        simulationId: SIM_ID,
        channelId: CHANNEL_ID,
        actorId: AGENT_1,
        type: "no_op_recorded",
        payload: { privateMotiveSummary: `motive-${i}` },
        sourceEventIds: [],
        emotionalSalience: "low",
        pulseIndex: 0,
        createdAt: 1000 * i,
        visibility: publicVisibility(),
      });
    }
    log.push({
      id: "noop-other",
      simulationId: SIM_ID,
      channelId: CHANNEL_ID,
      actorId: AGENT_2,
      type: "no_op_recorded",
      payload: { privateMotiveSummary: "other-agent-motive" },
      sourceEventIds: [],
      emotionalSalience: "low",
      pulseIndex: 0,
      createdAt: 9000,
      visibility: publicVisibility(),
    });

    const digest = buildAgentContextDigest(agentState, log);
    expect(digest.personaId).toBe("persona-mia");
    expect(digest.recentMemories).toHaveLength(10);
    expect(digest.recentMemories[0]).toEqual({
      summary: "memory summary 11",
      sourceEventIds: ["src-11"],
    });
    expect(digest.privateMotiveSummaries).toEqual([
      "motive-7",
      "motive-6",
      "motive-5",
      "motive-4",
      "motive-3",
    ]);
  });

  it("(h) synthesis cadence skips off-interval reviews and caps candidates", async () => {
    const harness = await makeHarness(
      resolveGoalLayerConfig({
        enabled: true,
        reviewEveryPulses: 1,
        synthesizer: { mode: "deterministic", intervalPulses: 2, maxCandidatesPerReview: 1 },
      }),
    );
    await seedBlocks(harness.eventRepo);
    // Three outbound messages by the agent crystallize a second candidate.
    await harness.eventRepo.append(SIM_ID, [
      makeGazeEvent("out-1", 4000, AGENT_1),
      makeGazeEvent("out-2", 5000, AGENT_1),
      makeGazeEvent("out-3", 6000, AGENT_1),
    ]);

    const r1 = await runReview(harness, 1, 1 * 1000);
    expect(r1.events.some((e) => e.type === "goal_proposed")).toBe(false);

    const r2 = await runReview(harness, 2, 2 * 1000);
    const proposals = r2.events.filter((e) => e.type === "goal_proposed");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.payload["goalId"]).toBe(RESOLVE_GOAL_ID);
  });

  it("(i) offerAcceptPulses: 2 holds the offer until the accept window closes", async () => {
    const harness = await makeHarness(
      resolveGoalLayerConfig({
        enabled: true,
        reviewEveryPulses: 1,
        ending: { offerAcceptPulses: 2 },
      }),
    );
    await seedBlocks(harness.eventRepo);
    await runReview(harness, 1, 1 * 1000);
    await runReview(harness, 2, 2 * 1000);
    await runReview(harness, 3, 3 * 1000);
    await seedGazes(harness.eventRepo);
    await runReview(harness, 4, 4 * 1000);
    await seedWitnessed(harness.eventRepo);
    await runReview(harness, 5, 5 * 1000);

    const r6 = await runReview(harness, 6, 6 * 1000);
    expect(r6.events.map((e) => e.type)).toContain("ending_offered");
    expect(r6.endingOffer).toBeNull(); // window of 2 not yet elapsed

    const r7 = await runReview(harness, 7, 7 * 1000);
    expect(r7.events).toEqual([]); // single-offer gate: nothing commits while pending
    expect(r7.endingOffer).toBeNull();

    const r8 = await runReview(harness, 8, 8 * 1000);
    expect(r8.events).toEqual([]);
    expect(asEndingOffer(r8.endingOffer)?.goalId).toBe(RESOLVE_GOAL_ID);

    const r9 = await runReview(harness, 9, 9 * 1000);
    expect(r9.events).toEqual([]);
    expect(r9.endingOffer).toBeNull(); // delivered exactly once
  });

  it("(j) red/critical stagnation diagnostics never crystallize — agent-blocked system events stay out of organic history", async () => {
    const harness = await makeHarness();
    await seedBlocks(harness.eventRepo);
    await harness.eventRepo.append(SIM_ID, [
      makeStagnationEvent("stagnation-1", "critical", Date.now()),
    ]);

    const review = await runReview(harness, 1, 1000);
    // Only the organic resolve proposal crystallizes; the critical
    // operator_only stagnation event is not witnessed by any agent.
    expect(review.events.map((e) => e.type)).toEqual(["goal_proposed"]);
    expect(review.events[0]!.payload["goalId"]).toBe(RESOLVE_GOAL_ID);
  });

  it("(k) production time shape: sim-scale now with wall-scale seeds — a mid-window follow-up reaches the story-holds ending", async () => {
    const harness = await makeHarness();
    const wall = Date.now();
    await harness.eventRepo.append(SIM_ID, [
      makeBlockedEvent("seed-1", wall),
      makeBlockedEvent("seed-2", wall + 1),
      makeBlockedEvent("seed-3", wall + 2),
    ]);
    await runReview(harness, 1, 1000);
    await runReview(harness, 2, 2000);
    // The agent's follow-up lands between reviews — this pulse's agent-loop
    // events must count in the CURRENT review's window.
    await harness.eventRepo.append(SIM_ID, [
      makeGazeEvent("follow-up-1", wall + 3, AGENT_1),
    ]);

    const r3 = await runReview(harness, 3, 3000);
    const verdict = r3.events.find((e) => e.type === "world_verdict")!;
    expect(
      (verdict.payload["verdict"] as Record<string, unknown>)["determination"],
    ).toBe("reached");
    expect(r3.endingOffer).not.toBeNull();
    expect(asEndingOffer(r3.endingOffer)?.reasons).toContain("world verdict: reached");
    expect(asEndingOffer(r3.endingOffer)?.epilogue).toContain("the story holds");
  });

  it("(l) a failed offer-creation commit leaves the offer re-deliverable, never silently lost", async () => {
    const harness = await makeHarness();
    await seedBlocks(harness.eventRepo);
    await runReview(harness, 1, 1000);
    await runReview(harness, 2, 2000);
    await runReview(harness, 3, 3000);
    await seedGazes(harness.eventRepo);
    await runReview(harness, 4, 4000);
    await seedWitnessed(harness.eventRepo);
    await runReview(harness, 5, 5000);

    // The offer-creation review runs but its commit fails — the scheduler's
    // appendAndProject drops the batch; simulate that by not appending.
    const r6 = await harness.evaluator.runReview({
      simulation: harness.sim,
      agents: harness.agents,
      pulseIndex: 6,
      now: 6000,
    });
    expect(r6.events.some((e) => e.type === "ending_offered")).toBe(true);
    expect(r6.endingOffer).not.toBeNull();

    // With no ending_offered in the log the offer is still owed: the next
    // review re-delivers it instead of going permanently silent.
    const r7 = await harness.evaluator.runReview({
      simulation: harness.sim,
      agents: harness.agents,
      pulseIndex: 7,
      now: 7000,
    });
    expect(r7.events).toEqual([]);
    expect(asEndingOffer(r7.endingOffer)?.goalId).toBe(RESOLVE_GOAL_ID);
  });
});

describe("WorldEvaluator.runReview — llm-mode wiring (TT301)", () => {
  const LLM_INTERVAL_CONFIG = (extra: {
    intervalPulses?: number;
    maxSelfVerdictsPerReview?: number;
    maxCandidatesPerReview?: number;
  }) =>
    resolveGoalLayerConfig({
      enabled: true,
      reviewEveryPulses: 1,
      synthesizer: {
        mode: "llm",
        intervalPulses: extra.intervalPulses ?? 1,
        maxCandidatesPerReview: extra.maxCandidatesPerReview ?? 10,
        maxSelfVerdictsPerReview: extra.maxSelfVerdictsPerReview,
      },
    });

  it("(a) interval cadence gates the combined call: zero off-interval, one per agent on interval with candidates AND active goals", async () => {
    const fake = makeFakeLLMRuntime({});
    const harness = await makeHarness(LLM_INTERVAL_CONFIG({ intervalPulses: 2 }), fake.llmRuntime);
    await seedBlocks(harness.eventRepo);

    await runReview(harness, 1, 1000);
    expect(fake.calls).toHaveLength(0);

    await runReview(harness, 2, 2000);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.params.pulseIndex).toBe(2);

    // Review 3 (off-interval) accepts the proposal — a goal becomes active,
    // yet no new client call happens off-cadence.
    await runReview(harness, 3, 3000);
    expect(fake.calls).toHaveLength(1);
    expect(harness.registry.getGoals()).toHaveLength(1);

    // Review 4 (interval) re-crystallizes the same candidate AND has an
    // active goal: exactly one call — the combined call (#94-8), not 1 + n.
    await runReview(harness, 4, 4000);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.params.pulseIndex).toBe(4);
    expect(fake.calls[1]!.input.candidates.length).toBeGreaterThan(0);
    expect(fake.calls[1]!.input.activeGoals).toHaveLength(1);
  });

  it("(b) maxSelfVerdictsPerReview caps the active goals fed to the client", async () => {
    const fake = makeFakeLLMRuntime({});
    const harness = await makeHarness(LLM_INTERVAL_CONFIG({ maxSelfVerdictsPerReview: 1 }), fake.llmRuntime);
    harness.registry.recordProposal(makeProposal("goal-1"));
    harness.registry.promoteProposal("goal-1");
    harness.registry.recordProposal(makeProposal("goal-2"));
    harness.registry.promoteProposal("goal-2");
    expect(harness.registry.getGoals()).toHaveLength(2);

    await seedBlocks(harness.eventRepo);
    await runReview(harness, 1, 1000);

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.input.candidates.length).toBeGreaterThan(0);
    expect(fake.calls[0]!.input.activeGoals).toHaveLength(1);
  });

  it("(c) a throwing client is contained: deterministic proposals emit, llm_failure surfaces, nothing is recorded", async () => {
    const fake = makeFakeLLMRuntime({ throwOnCall: true });
    const harness = await makeHarness(LLM_INTERVAL_CONFIG({}), fake.llmRuntime);
    await seedBlocks(harness.eventRepo);

    const review = await runReview(harness, 1, 1000);
    const proposed = review.events.find((e) => e.type === "goal_proposed")!;
    expect(proposed.payload["synthesizer"]).toBe("deterministic");
    const failure = review.operatorEvents.find((e) => e.type === "llm_failure");
    expect(failure).toBeDefined();
    expect(failure!.detail).toContain("client boom");
    const proposalId = (proposed.payload["proposal"] as { id: string }).id;
    expect(harness.registry.getSelfVerdict(proposalId)).toBeUndefined();
  });

  it("(d) a budget-blocked client outcome surfaces llm_budget_exceeded and records nothing", async () => {
    const fake = makeFakeLLMRuntime({
      outcome: (input) => ({
        result: {
          proposals: input.candidates.map((candidate) => ({
            proposal: candidate,
            narrativeFraming: candidate.targetState.description,
            confidence: 1,
            synthesizer: "deterministic" as const,
          })),
          selfVerdicts: [],
        },
        operatorEvents: [
          {
            type: "llm_budget_exceeded" as const,
            simulationId: SIM_ID,
            agentId: AGENT_1,
            pulseIndex: 1,
            detail: "LLM budget pre-check blocked goal synthesis for agent " + AGENT_1,
            createdAt: 1000,
          },
        ],
      }),
    });
    const harness = await makeHarness(LLM_INTERVAL_CONFIG({}), fake.llmRuntime);
    await seedBlocks(harness.eventRepo);

    const review = await runReview(harness, 1, 1000);
    const exceeded = review.operatorEvents.find((e) => e.type === "llm_budget_exceeded");
    expect(exceeded).toBeDefined();
    expect(review.operatorEvents.some((e) => e.type === "llm_failure")).toBe(false);
    const proposed = review.events.find((e) => e.type === "goal_proposed");
    expect(proposed).toBeDefined();
    const proposalId = (proposed!.payload["proposal"] as { id: string }).id;
    expect(harness.registry.getSelfVerdict(proposalId)).toBeUndefined();
  });

  it("(e) deterministic mode never invokes the client factory and keeps operatorEvents empty", async () => {
    const fake = makeFakeLLMRuntime({});
    const harness = await makeHarness(
      resolveGoalLayerConfig({
        enabled: true,
        reviewEveryPulses: 1,
        synthesizer: { mode: "deterministic", intervalPulses: 1, maxCandidatesPerReview: 10 },
      }),
      fake.llmRuntime,
    );
    await seedBlocks(harness.eventRepo);

    const review = await runReview(harness, 1, 1000);
    expect(review.events.some((e) => e.type === "goal_proposed")).toBe(true);
    expect(fake.calls).toHaveLength(0);
    expect(review.operatorEvents).toEqual([]);
  });
});

describe("WorldEvaluator.runReview — agent-mode acceptance (TT402)", () => {
  const AGENT_CONFIG = () =>
    resolveGoalLayerConfig({
      enabled: true,
      reviewEveryPulses: 1,
      acceptance: { mode: "agent" },
    });

  function makeEngagementEvent(
    id: string,
    createdAt: number,
    opts: {
      type?: "message_sent" | "reply_sent" | "reaction_sent";
      actorId?: string;
      channelId?: string;
    } = {},
  ): CommittedEvent {
    return {
      id,
      simulationId: SIM_ID,
      channelId: opts.channelId ?? CHANNEL_ID,
      actorId: opts.actorId ?? AGENT_1,
      type: opts.type ?? "message_sent",
      payload:
        opts.type === "reaction_sent"
          ? { emoji: "👍", targetEventId: "seed-1" }
          : { content: "I will fix this" },
      sourceEventIds: [],
      emotionalSalience: "low",
      pulseIndex: 0,
      createdAt,
      visibility: publicVisibility(),
    };
  }

  it("(a) accepts on post-proposal engagement: goal_proposed reaches the target agent and review N+1 promotes", async () => {
    const harness = await makeHarness(AGENT_CONFIG());
    await seedBlocks(harness.eventRepo);

    // Review 1 proposes; D-11 keeps acceptance at review N+1 — no goal
    // event commits on the proposing review.
    const r1 = await runReview(harness, 1, 1000);
    expect(r1.events.map((e) => e.type)).toEqual(["goal_proposed"]);
    const proposed = r1.events[0]!;
    expect(proposed.payload["goalId"]).toBe(RESOLVE_GOAL_ID);
    // Perception leg (#94-2): the proposal is visible to the target agent only.
    expect(proposed.visibility.visibleToAgents).toEqual([AGENT_1]);
    expect(proposed.visibility.visibilityReason).toBe("goal_proposal");

    // The agent engages its channel between reviews. reaction_sent counts
    // as engagement but crystallizes no new proposal.
    await harness.eventRepo.append(SIM_ID, [
      makeEngagementEvent("engage-1", Date.now(), { type: "reaction_sent" }),
    ]);

    const r2 = await runReview(harness, 2, 2000);
    const accepted = r2.events.find((e) => e.type === "goal_accepted");
    expect(accepted).toBeDefined();
    expect(accepted!.payload["goalId"]).toBe(RESOLVE_GOAL_ID);
    expect((accepted!.payload["goal"] as { status: string }).status).toBe("active");
    expect(harness.registry.getGoals()).toHaveLength(1);
    expect(harness.registry.getGoal(RESOLVE_GOAL_ID)?.status).toBe("active");
    // Promoted, not re-proposed: the proposal left the pending set.
    expect(harness.registry.getProposals()).toHaveLength(0);
  });

  it("(b) declines without engagement: goal_declined commits and the registry never promotes — accept vs decline differ", async () => {
    const harness = await makeHarness(AGENT_CONFIG());
    await seedBlocks(harness.eventRepo);
    await runReview(harness, 1, 1000);

    const r2 = await runReview(harness, 2, 2000);
    expect(r2.events[0]!.type).toBe("goal_declined");
    expect(r2.events[0]!.payload["goalId"]).toBe(RESOLVE_GOAL_ID);
    expect(harness.registry.getGoal(RESOLVE_GOAL_ID)).toBeUndefined();
    // The latent lack re-crystallizes on the same review, so the goal can
    // surface again once the agent engages — decline is not a ban.
    expect(r2.events[1]!.type).toBe("goal_proposed");
  });

  it("(c) engagement by a different agent is not ownership — declined", async () => {
    const harness = await makeHarness(AGENT_CONFIG());
    await seedBlocks(harness.eventRepo);
    await runReview(harness, 1, 1000);

    await harness.eventRepo.append(SIM_ID, [
      makeEngagementEvent("engage-other", Date.now(), {
        type: "message_sent",
        actorId: AGENT_2,
      }),
    ]);

    const r2 = await runReview(harness, 2, 2000);
    expect(r2.events[0]!.type).toBe("goal_declined");
    expect(harness.registry.getGoal(RESOLVE_GOAL_ID)).toBeUndefined();
  });

  it("(d) engagement in a different channel is not ownership — declined", async () => {
    const harness = await makeHarness(AGENT_CONFIG());
    await seedBlocks(harness.eventRepo);
    await runReview(harness, 1, 1000);

    await harness.eventRepo.append(SIM_ID, [
      makeEngagementEvent("engage-elsewhere", Date.now(), {
        type: "reaction_sent",
        channelId: "ch_other",
      }),
    ]);

    const r2 = await runReview(harness, 2, 2000);
    expect(r2.events[0]!.type).toBe("goal_declined");
    expect(harness.registry.getGoal(RESOLVE_GOAL_ID)).toBeUndefined();
  });

  it("(e) window boundary: engagement before the proposal commit position is excluded (ADR-0009 positional rule)", async () => {
    const harness = await makeHarness(AGENT_CONFIG());
    await seedBlocks(harness.eventRepo);
    // The agent messaged before the goal was proposed — pre-perception
    // behavior sits before the goal_proposed commit position in the log.
    await harness.eventRepo.append(SIM_ID, [
      makeEngagementEvent("early-1", Date.now(), { type: "reply_sent" }),
    ]);
    await runReview(harness, 1, 1000);

    const r2 = await runReview(harness, 2, 2000);
    expect(r2.events[0]!.type).toBe("goal_declined");
    expect(harness.registry.getGoal(RESOLVE_GOAL_ID)).toBeUndefined();
  });
});

describe("WorldEvaluator.runReview — LLM self-verdicts (TT501)", () => {
  const LLM_CONFIG = (extra: {
    intervalPulses?: number;
    maxSelfVerdictsPerReview?: number;
    maxCandidatesPerReview?: number;
  }) =>
    resolveGoalLayerConfig({
      enabled: true,
      reviewEveryPulses: 1,
      synthesizer: {
        mode: "llm",
        intervalPulses: extra.intervalPulses ?? 1,
        maxCandidatesPerReview: extra.maxCandidatesPerReview ?? 10,
        maxSelfVerdictsPerReview: extra.maxSelfVerdictsPerReview,
      },
    });

  function seedRidicule(harness: Harness): Promise<void> {
    return harness.eventRepo.append(SIM_ID, [makeRidiculeEvent("ridicule-1", 1500)]);
  }

  it("(a) an LLM 'reached' claim drives the delusion gap while the world verdict stays not_reached", async () => {
    const fake = makeFakeLLMRuntime({ outcome: deludedLlmOutcome });
    const harness = await makeHarness(LLM_CONFIG({ intervalPulses: 1 }), fake.llmRuntime);
    await seedBlocks(harness.eventRepo);
    await runReview(harness, 1, 1000);
    await seedRidicule(harness);

    const r2 = await runReview(harness, 2, 2000);
    const verdictEvent = r2.events.find((e) => e.type === "world_verdict")!;
    expect(
      (verdictEvent.payload["verdict"] as Record<string, unknown>)["determination"],
    ).toBe("not_reached");

    // The stored LLM belief drives the gap: divergenceFromWorld 1 (reached vs
    // not_reached), magnitude > 0 — the two-verdict divergence stays legible.
    const gapEvent = r2.events.find((e) => e.type === "delusion_gap_sampled")!;
    expect(gapEvent.payload["divergenceFromWorld"]).toBe(1);
    expect(gapEvent.payload["magnitude"]).toBeGreaterThan(0);
    const stored = harness.registry.getSelfVerdict(RESOLVE_GOAL_ID)!;
    expect(stored.verdict.claim).toBe("reached");
    expect(stored.source).toBe("llm");
  });

  it("(b) the interval-2 arc: structural V1 before the first success, stored 'reached', persistence, clobber protection", async () => {
    let callCount = 0;
    const fake = makeFakeLLMRuntime({
      outcome: (input) => {
        callCount += 1;
        // Call 1 (review 2) rides no active goal; call 2 (review 4) is the
        // genuine success storing the deluded claim; call 3 (review 6) is
        // budget-blocked and must record nothing (D-19 record gate).
        return callCount === 3 ? blockedLlmOutcome(input) : deludedLlmOutcome(input);
      },
    });
    const harness = await makeHarness(LLM_CONFIG({ intervalPulses: 2 }), fake.llmRuntime);
    await seedBlocks(harness.eventRepo);
    await runReview(harness, 1, 1000); // off-interval: no synthesis
    await seedRidicule(harness);
    await runReview(harness, 2, 2000); // interval: proposes only; call 1
    expect(fake.calls).toHaveLength(1);

    // Review 3 (off-interval) accepts; no genuine outcome has stored
    // anything, so the verdict block serves structural V1: claim in_progress
    // ⇒ divergenceFromWorld 0, magnitude 0.
    const r3 = await runReview(harness, 3, 3000);
    expect(harness.registry.getSelfVerdict(RESOLVE_GOAL_ID)).toBeUndefined();
    expect(fake.calls).toHaveLength(1);
    const r3Gap = r3.events.find((e) => e.type === "delusion_gap_sampled")!;
    expect(r3Gap.payload["divergenceFromWorld"]).toBe(0);
    expect(r3Gap.payload["magnitude"]).toBe(0);

    // A genuine interval success at review 4 stores the deluded claim, which
    // immediately drives the gap against the not_reached world verdict.
    const r4 = await runReview(harness, 4, 4000);
    expect(fake.calls).toHaveLength(2);
    expect(harness.registry.getSelfVerdict(RESOLVE_GOAL_ID)?.verdict.claim).toBe("reached");
    expect(
      r4.events.find((e) => e.type === "delusion_gap_sampled")!.payload["divergenceFromWorld"],
    ).toBe(1);

    // Fresh witnessed events keep a next goal pending so the plateau branch
    // never arms on the later reviews (A-2 precondition).
    await harness.eventRepo.append(SIM_ID, [makeWitnessedEvent("witness-5", Date.now(), "ch_w5")]);

    // Review 5 (off-interval): zero new calls, yet the stored claim still
    // drives the gap — belief persistence across intervals.
    const r5 = await runReview(harness, 5, 5000);
    expect(fake.calls).toHaveLength(2);
    expect(
      r5.events.find((e) => e.type === "delusion_gap_sampled")!.payload["divergenceFromWorld"],
    ).toBe(1);
    expect(r5.events.some((e) => e.type === "ending_offered")).toBe(false);

    await harness.eventRepo.append(SIM_ID, [makeWitnessedEvent("witness-6", Date.now(), "ch_w6")]);

    // Review 6 (interval): the budget-blocked outcome records nothing — the
    // persisted "reached" belief survives (V-1/D-19) and stored-first keeps
    // serving it.
    const r6 = await runReview(harness, 6, 6000);
    expect(harness.registry.getSelfVerdict(RESOLVE_GOAL_ID)?.verdict.claim).toBe("reached");
    expect(r6.operatorEvents.some((e) => e.type === "llm_budget_exceeded")).toBe(true);
    expect(r6.operatorEvents.some((e) => e.type === "llm_failure")).toBe(false);
    expect(
      r6.events.find((e) => e.type === "delusion_gap_sampled")!.payload["divergenceFromWorld"],
    ).toBe(1);
    expect(r6.events.some((e) => e.type === "ending_offered")).toBe(false);
  });

  it("(e) deterministic mode never consults or populates the self-verdict junction (V1 unchanged)", async () => {
    const fake = makeFakeLLMRuntime({ outcome: deludedLlmOutcome });
    const harness = await makeHarness(
      resolveGoalLayerConfig({
        enabled: true,
        reviewEveryPulses: 1,
        synthesizer: { mode: "deterministic", intervalPulses: 1, maxCandidatesPerReview: 10 },
      }),
      fake.llmRuntime,
    );
    await seedBlocks(harness.eventRepo);
    await runReview(harness, 1, 1000);

    const r2 = await runReview(harness, 2, 2000);
    expect(fake.calls).toHaveLength(0);
    expect(harness.registry.getSelfVerdict(RESOLVE_GOAL_ID)).toBeUndefined();
    // Structural V1 claim (in_progress): divergenceFromWorld 0, magnitude 0 —
    // byte-identical to the pre-slice verdict block (G9).
    const gapEvent = r2.events.find((e) => e.type === "delusion_gap_sampled")!;
    expect(gapEvent.payload["divergenceFromWorld"]).toBe(0);
    expect(gapEvent.payload["magnitude"]).toBe(0);
  });
});