import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
import { StdoutDeliveryGateway } from "../../delivery/stdout-delivery-gateway.js";
import { STAGNATION_METRIC_KEYS } from "./fixtures.js";
import { serializeAgentState } from "../../agent/agent-state-serializer.js";
import type { AgentRuntime, LLMBudget } from "../pulse-scheduler.js";
import type {
  Simulation,
  SimulationSettings,
  AgentState,
  PersonaConfig,
  ActionIntent,
  EngineStepResult,
  EngineSnapshot,
  OperatorEvent,
  CommittedEvent,
  SimulationEvent,
  AgentRuntimeInput,
} from "@perfectman/shared";
import { createId } from "@perfectman/shared";
import { computeStagnationMetrics } from "@perfectman/engine";

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
  id: "sim_obs",
  name: "observability",
  status: "running",
  agentIds: ["agent_1", "agent_2"],
  channelIds: ["ch_public"],
  settings: SETTINGS,
  seed: 7,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function makeAgentState(agentId: string): AgentState {
  return {
    agentId,
    simulationId: "sim_obs",
    personaId: `persona_${agentId}`,
    presence: "active",
    coreMood: { valence: 0, arousal: 0.5, stability: 0.8, energy: 0.6, circumplexAngle: 0, circumplexRadius: 0.5, momentumValence: 0, momentumArousal: 0 },
    socialEmotions: { jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0, resentment: 0, suspicion: 0, admiration: 0, contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0 },
    relationalStates: new Map([["agent_2", { warmth: 0.2, intimacy: 0.1, powerDifference: 0, trust: 0.5, rivalry: 0, history: [] }]]),
    memories: [{ id: "mem_1", type: "observation", summary: "agent_2 seems guarded", emotionalTone: "curious", confidence: 0.6, createdAt: 1, sourceEventId: "ev_0", subjects: ["agent_2"] }],
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

function makeCannedStep(agentId: string): EngineStepResult {
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

function makeNoOpIntent(agentId: string): ActionIntent {
  return {
    id: createId(),
    actorId: agentId,
    intentType: "no_op",
    personTargets: [],
    privateMotiveSummary: "nothing worth doing",
    emotionDrivers: [],
    motivationDrivers: [],
    memoryWrites: [],
  };
}

function makeSendMessageIntent(agentId: string, content: string): ActionIntent {
  return {
    id: createId(),
    actorId: agentId,
    intentType: "send_message",
    personTargets: [],
    visibleContent: content,
    privateMotiveSummary: "I have something to say",
    emotionDrivers: ["curiosity"],
    motivationDrivers: ["connection"],
    memoryWrites: [],
  };
}

function makeCreateChannelIntent(agentId: string): ActionIntent {
  return {
    id: createId(),
    actorId: agentId,
    intentType: "create_channel",
    personTargets: ["agent_2"],
    channelName: "secret-lair",
    channelType: "private_channel",
    privateMotiveSummary: "I need a private space",
    emotionDrivers: ["caution"],
    motivationDrivers: ["privacy"],
    invitedAgentIds: ["agent_2"],
    memoryWrites: [],
  };
}

const SEND_MESSAGE_SLOT = { intentType: "send_message" as const, channelTargets: [], personTargets: [], blocked: false };
const CREATE_CHANNEL_SLOT = { intentType: "create_channel" as const, channelTargets: [], personTargets: [], blocked: false };

/** Canned step driving agent_1 through the LLM path; agent_2 stays no-LLM. */
function llmStep(extra: Partial<EngineStepResult> = {}): (snap: EngineSnapshot) => EngineStepResult {
  return (snap) => {
    const base = makeCannedStep(snap.agentState.agentId);
    if (snap.agentState.agentId !== "agent_1") return base;
    return {
      ...base,
      decision: { outcome: "act", needsLLM: true, initiativeProceed: false },
      ...extra,
    };
  };
}

function runtimeWith(output: (agentId: string) => ActionIntent, fallbackApplied = false): AgentRuntime {
  return {
    generateIntent: vi.fn().mockImplementation((input: AgentRuntimeInput) =>
      Promise.resolve({
        intent: output(input.agentId),
        llmUsage: null,
        latencyMs: 10,
        fallbackApplied,
        operatorEvents: [],
      }),
    ),
  };
}

interface SchedulerHarness {
  scheduler: PulseScheduler;
  gateway: MockDeliveryGateway;
  eventRepo: InMemoryEventRepository;
  agentStateRepo: InMemoryAgentStateRepository;
}

describe("PulseScheduler observability events", () => {
  let stdoutSpy: { mockRestore(): void } | null = null;

  async function buildScheduler(options: {
    step?: (snap: EngineSnapshot) => EngineStepResult;
    runtime?: AgentRuntime;
    gateway?: MockDeliveryGateway | StdoutDeliveryGateway;
    intentResolver?: IntentResolver;
  } = {}): Promise<SchedulerHarness> {
    const eventRepo = new InMemoryEventRepository();
    const agentStateRepo = new InMemoryAgentStateRepository();
    const channelRepo = new InMemoryChannelRepository();
    const channelRegistry = new ChannelRegistry(channelRepo);
    const gateway = options.gateway ?? new MockDeliveryGateway();

    await channelRepo.create({
      id: "ch_public",
      simulationId: "sim_obs",
      type: "public_channel",
      name: "general",
      createdBy: "system",
      memberAgentIds: ["agent_1", "agent_2"],
      spectatorVisible: true,
      operatorVisible: true,
      createdForMotives: [],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await channelRepo.addMembership({ channelId: "ch_public", agentId: "agent_1", joinedAt: Date.now() });
    await channelRepo.addMembership({ channelId: "ch_public", agentId: "agent_2", joinedAt: Date.now() });
    await agentStateRepo.upsert(makeAgentState("agent_1"));
    await agentStateRepo.upsert(makeAgentState("agent_2"));

    const rateLimitGate = new RateLimitGate(SETTINGS);
    const agentRuntime: AgentRuntime = options.runtime ?? runtimeWith(() => makeNoOpIntent("agent_1"));
    const llmBudget: LLMBudget = { getPriority: vi.fn().mockReturnValue("normal") };

    const scheduler = new PulseScheduler({
      simulation: SIM,
      agents: ["agent_1", "agent_2"].map((id) => ({ id, state: makeAgentState(id), persona: makePersona(id) })),
      defaultPublicChannelId: "ch_public",
      eventRepo,
      agentStateRepo,
      channelRegistry,
      rateLimitGate,
      intentResolver: options.intentResolver ?? new IntentResolver(rateLimitGate, channelRegistry),
      engineSnapshotProjection: new EngineSnapshotProjection(),
      deliveryProjection: new DeliveryProjection(gateway),
      spectatorProjection: new SpectatorProjection(gateway),
      operatorProjection: new OperatorProjection(gateway),
      engineEventBuilder: new EngineEventBuilder(),
      agentRuntime,
      llmBudget,
      pulseIntervalMs: SETTINGS.pulseIntervalMs,
      ...(options.step ? { stepResolver: options.step } : {}),
    });

    return {
      scheduler,
      // A non-mock gateway (stdout NDJSON test) asserts via captured writes,
      // never through this harness field — keep the type stable for callers.
      gateway: gateway instanceof MockDeliveryGateway ? gateway : new MockDeliveryGateway(),
      eventRepo,
      agentStateRepo,
    };
  }

  afterEach(() => {
    if (stdoutSpy) {
      stdoutSpy.mockRestore();
      stdoutSpy = null;
    }
  });

  function snapshots(events: OperatorEvent[]): OperatorEvent[] {
    return events.filter((e) => e.type === "agent_state_snapshot");
  }

  function intents(events: OperatorEvent[]): OperatorEvent[] {
    return events.filter((e) => e.type === "action_intent");
  }

  function visibility(events: OperatorEvent[]): OperatorEvent[] {
    return events.filter((e) => e.type === "event_visibility");
  }

  it("emits exactly one state snapshot per agent per pulse with serialized state parity", async () => {
    const state1 = makeAgentState("agent_1");
    const state2 = makeAgentState("agent_2");
    const h = await buildScheduler({
      step: (snap) => ({
        ...makeCannedStep(snap.agentState.agentId),
        updatedAgentState: snap.agentState.agentId === "agent_1" ? state1 : state2,
      }),
    });
    await h.scheduler.runPulse();
    await h.scheduler.runPulse();

    const snaps = snapshots(h.gateway.operatorEvents);
    expect(snaps).toHaveLength(4); // 2 agents × 2 pulses
    expect(snaps.filter((s) => s.pulseIndex === 0)).toHaveLength(2);
    expect(snaps.filter((s) => s.pulseIndex === 1)).toHaveLength(2);
    expect(snaps.filter((s) => s.agentId === "agent_1")).toHaveLength(2);
    expect(snaps.filter((s) => s.agentId === "agent_2")).toHaveLength(2);

    expect(snaps[0]!.data?.["state"]).toEqual(serializeAgentState(state1));
    expect(snaps[1]!.data?.["state"]).toEqual(serializeAgentState(state2));
    expect(snaps[0]!.data?.["state"]).toEqual(
      serializeAgentState(await h.agentStateRepo.get("sim_obs", "agent_1")),
    );
    expect(snaps[0]!.simulationId).toBe("sim_obs");
    expect(snaps[0]!.pulseIndex).toBe(0);
  });

  it("still emits exactly one snapshot per agent on the LLM path", async () => {
    const h = await buildScheduler({
      runtime: runtimeWith(() => makeSendMessageIntent("agent_1", "hello from the LLM path")),
      step: llmStep({ availableActions: [SEND_MESSAGE_SLOT] }),
    });
    await h.scheduler.runPulse();

    expect(snapshots(h.gateway.operatorEvents)).toHaveLength(2);
    const intentEvents = intents(h.gateway.operatorEvents);
    expect(intentEvents).toHaveLength(1);
    expect(intentEvents[0]!.agentId).toBe("agent_1");
  });

  it("emits a snapshot but no action_intent when the provider rejects", async () => {
    const h = await buildScheduler({
      runtime: { generateIntent: vi.fn().mockRejectedValue(new Error("provider timeout")) },
      step: llmStep(),
    });
    await h.scheduler.runPulse();

    expect(snapshots(h.gateway.operatorEvents)).toHaveLength(2);
    expect(intents(h.gateway.operatorEvents)).toHaveLength(0);
    expect(h.gateway.operatorEvents.some((e) => e.type === "llm_failure")).toBe(true);
  });

  it("emits a snapshot but no action_intent when the intent resolver fails", async () => {
    const rateLimitGate = new RateLimitGate(SETTINGS);
    const channelRegistryForResolver = new ChannelRegistry(new InMemoryChannelRepository());
    const broken = new IntentResolver(rateLimitGate, channelRegistryForResolver);
    vi.spyOn(broken, "resolve").mockRejectedValueOnce(new Error("resolver exploded"));

    const h = await buildScheduler({
      runtime: runtimeWith(() => makeSendMessageIntent("agent_1", "doomed")),
      step: llmStep({ availableActions: [SEND_MESSAGE_SLOT] }),
      intentResolver: broken,
    });
    await h.scheduler.runPulse();

    expect(snapshots(h.gateway.operatorEvents)).toHaveLength(2);
    expect(intents(h.gateway.operatorEvents)).toHaveLength(0);
    expect(h.gateway.operatorEvents.some((e) => e.type === "scheduler_error" && e.detail === "Intent resolver failed")).toBe(true);
  });

  it("carries the five intent fields verbatim in action_intent", async () => {
    const h = await buildScheduler({
      runtime: runtimeWith((agentId) => ({
        ...makeSendMessageIntent(agentId, "the visible content"),
        visibleContent: "the visible content",
        emotionDrivers: ["curiosity", "warmth"],
        motivationDrivers: ["connection", "status"],
      })),
      step: llmStep({ availableActions: [SEND_MESSAGE_SLOT] }),
    });
    await h.scheduler.runPulse();

    const intentEvents = intents(h.gateway.operatorEvents);
    expect(intentEvents).toHaveLength(1);
    const ev = intentEvents[0]!;
    expect(ev.agentId).toBe("agent_1");
    expect(ev.pulseIndex).toBe(0);
    expect(ev.data?.["intentType"]).toBe("send_message");
    expect(ev.data?.["visibleContent"]).toBe("the visible content");
    expect(ev.data?.["privateMotiveSummary"]).toBe("I have something to say");
    expect(ev.data?.["emotionDrivers"]).toEqual(["curiosity", "warmth"]);
    expect(ev.data?.["motivationDrivers"]).toEqual(["connection", "status"]);
  });

  it("emits a truthful no_op action_intent when a fallback intent was produced", async () => {
    const h = await buildScheduler({
      runtime: runtimeWith((agentId) => makeNoOpIntent(agentId), true),
      step: llmStep(),
    });
    await h.scheduler.runPulse();

    const intentEvents = intents(h.gateway.operatorEvents);
    expect(intentEvents).toHaveLength(1);
    expect(intentEvents[0]!.data?.["intentType"]).toBe("no_op");
    expect(intentEvents[0]!.data?.["privateMotiveSummary"]).toBe("nothing worth doing");
    expect(intentEvents[0]!.data?.["emotionDrivers"]).toEqual([]);
    expect(intentEvents[0]!.data?.["visibleContent"]).toBeUndefined();
  });

  it("emits no action_intent for an uncalled agent in the same pulse", async () => {
    const h = await buildScheduler({
      runtime: runtimeWith(() => makeSendMessageIntent("agent_1", "only I speak")),
      step: llmStep({ availableActions: [SEND_MESSAGE_SLOT] }),
    });
    await h.scheduler.runPulse();

    const intentEvents = intents(h.gateway.operatorEvents);
    expect(intentEvents).toHaveLength(1);
    expect(intentEvents[0]!.agentId).toBe("agent_1");
    expect(snapshots(h.gateway.operatorEvents)).toHaveLength(2);
  });

  it("defaults missing emotionDrivers and motivationDrivers to empty arrays", async () => {
    const h = await buildScheduler({
      runtime: runtimeWith((agentId) => {
        const bare = makeSendMessageIntent(agentId, "bare");
        return {
          id: bare.id,
          actorId: bare.actorId,
          intentType: "send_message" as const,
          personTargets: bare.personTargets,
          visibleContent: bare.visibleContent,
          privateMotiveSummary: bare.privateMotiveSummary,
          memoryWrites: bare.memoryWrites,
        } as ActionIntent;
      }),
      step: llmStep({ availableActions: [SEND_MESSAGE_SLOT] }),
    });
    await h.scheduler.runPulse();

    const intentEvents = intents(h.gateway.operatorEvents);
    expect(intentEvents[0]!.data?.["emotionDrivers"]).toEqual([]);
    expect(intentEvents[0]!.data?.["motivationDrivers"]).toEqual([]);
  });

  it("emits one event_visibility per committed engine event (no_op_recorded)", async () => {
    const h = await buildScheduler({
      step: (snap) => ({
        ...makeCannedStep(snap.agentState.agentId),
        noOpRecord: { agentId: snap.agentState.agentId, pulseIndex: 0, privateMotiveSummary: "quiet", reason: "nothing due" },
      }),
    });
    await h.scheduler.runPulse();

    const visEvents = visibility(h.gateway.operatorEvents);
    expect(visEvents).toHaveLength(2); // one per agent's no_op_recorded
    const first = visEvents[0]!;
    expect(first.data?.["eventType"]).toBe("no_op_recorded");
    expect(first.data?.["actorId"]).toBe(first.agentId);
    expect(first.data?.["visibleToAgents"]).toEqual([]);
    expect(first.data?.["content"]).toBeUndefined();
    expect(first.data?.["channelName"]).toBeUndefined();
    expect(first.pulseIndex).toBe(0);
  });

  it("carries content in event_visibility for committed message_sent events", async () => {
    const h = await buildScheduler({
      runtime: runtimeWith(() => makeSendMessageIntent("agent_1", "the committed content")),
      step: llmStep({ availableActions: [SEND_MESSAGE_SLOT] }),
    });
    await h.scheduler.runPulse();

    const committed = await h.eventRepo.getAfter("sim_obs");
    const messageEvent = committed.find((e): e is CommittedEvent => e.type === "message_sent");
    expect(messageEvent).toBeDefined();

    const visEvents = visibility(h.gateway.operatorEvents);
    const msgVis = visEvents.find((e) => e.data?.["eventType"] === "message_sent");
    expect(msgVis).toBeDefined();
    expect(msgVis!.data?.["eventId"]).toBe(messageEvent!.id);
    expect(msgVis!.data?.["content"]).toBe("the committed content");
    expect(msgVis!.data?.["channelId"]).toBe("ch_public");
    expect(msgVis!.data?.["visibleToAgents"]).toEqual(messageEvent!.visibility.visibleToAgents);
  });

  it("carries channelName and members for committed channel_created events", async () => {
    const h = await buildScheduler({
      runtime: runtimeWith((agentId) => makeCreateChannelIntent(agentId)),
      step: llmStep({ availableActions: [CREATE_CHANNEL_SLOT] }),
    });
    await h.scheduler.runPulse();

    const committed = await h.eventRepo.getAfter("sim_obs");
    const created = committed.find((e): e is CommittedEvent => e.type === "channel_created");
    expect(created).toBeDefined();
    const invited = committed.find((e): e is CommittedEvent => e.type === "agent_invited");
    expect(invited).toBeDefined();

    const visEvents = visibility(h.gateway.operatorEvents);
    expect(visEvents).toHaveLength(2); // channel_created + agent_invited
    const createdVis = visEvents.find((e) => e.data?.["eventType"] === "channel_created");
    expect(createdVis).toBeDefined();
    expect(createdVis!.data?.["eventId"]).toBe(created!.id);
    expect(createdVis!.data?.["channelName"]).toBe("secret-lair");
    expect(createdVis!.data?.["visibleToAgents"]).toEqual(created!.visibility.visibleToAgents);
    const invitedVis = visEvents.find((e) => e.data?.["eventType"] === "agent_invited");
    expect(invitedVis).toBeDefined();
    expect(invitedVis!.data?.["channelName"]).toBeUndefined();
    expect(invitedVis!.data?.["visibleToAgents"]).toEqual(invited!.visibility.visibleToAgents);
  });

  it("writes one agent_state_snapshot NDJSON line per agent per pulse on a debug stdout gateway", async () => {
    const writes: string[] = [];
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    const h = await buildScheduler({
      gateway: new StdoutDeliveryGateway(true),
      step: (snap) => makeCannedStep(snap.agentState.agentId),
    });
    await h.scheduler.runPulse();
    await h.scheduler.runPulse();

    const snapshotLines = writes
      .map((line) => JSON.parse(line) as { type: string; payload: { type?: string } })
      .filter((parsed) => parsed.type === "operator_event" && parsed.payload.type === "agent_state_snapshot");
    expect(snapshotLines).toHaveLength(4); // 2 pulses × 2 agents, one snapshot per agent per pulse
    for (const line of snapshotLines) {
      expect(line.payload.type).toBe("agent_state_snapshot");
    }
  });

  it("emits per-cadence stagnation_metrics and a distinct attractor_detected on a message-loop run", async () => {
    const h = await buildScheduler({
      step: (snap) => makeCannedStep(snap.agentState.agentId),
    });

    const seeds: SimulationEvent[] = [];
    for (let p = 1; p <= 9; p += 1) {
      seeds.push({
        id: `seed_${p}`,
        simulationId: "sim_obs",
        channelId: "ch_public",
        actorId: p % 2 === 0 ? "agent_1" : "agent_2",
        type: "message_sent",
        payload: { content: "so anyway what do you think" },
        sourceEventIds: [],
        emotionalSalience: "low",
        pulseIndex: p,
        visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public_channel" },
      });
    }
    const committed = await h.eventRepo.append("sim_obs", seeds);

    for (let i = 0; i < 11; i += 1) await h.scheduler.runPulse();

    const metricsEvents = h.gateway.operatorEvents.filter((e) => e.type === "stagnation_metrics");
    expect(metricsEvents).toHaveLength(1);
    const m = metricsEvents[0]!;
    expect(m.pulseIndex).toBe(10);
    for (const key of STAGNATION_METRIC_KEYS) {
      expect(typeof m.data?.[key]).toBe("number");
    }
    expect(["normal", "yellow", "red", "critical"]).toContain(m.data?.["level"]);

    const attractorEvents = h.gateway.operatorEvents.filter((e) => e.type === "attractor_detected");
    expect(attractorEvents.some((e) => e.data?.["signature"] === "message_loop")).toBe(true);
    for (const e of attractorEvents) expect(e.pulseIndex).toBe(10);

    // level and composite ride the composite pipeline untouched — the attractor
    // hit produces its own event and never overrides them.
    const agentStates = new Map([
      ["agent_1", (await h.agentStateRepo.get("sim_obs", "agent_1"))!],
      ["agent_2", (await h.agentStateRepo.get("sim_obs", "agent_2"))!],
    ]);
    const independent = computeStagnationMetrics("sim_obs", 10, committed, agentStates);
    expect(m.data?.["level"]).toBe(independent.level);
    expect(m.data?.["compositeScore"]).toBe(independent.compositeScore);
  });
});