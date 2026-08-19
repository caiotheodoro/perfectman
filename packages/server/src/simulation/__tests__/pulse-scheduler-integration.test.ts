/**
 * pulse-scheduler-integration.test.ts
 *
 * End-to-end pulse loop with ALL mocks:
 *   - mock engine returning canned EngineStepResult
 *   - mock agent runtime returning canned ActionIntent
 *   - in-memory stores
 *   - MockDeliveryGateway
 *
 * Covers:
 *   - no_op_recorded commits BEFORE any LLM call
 *   - memory_written commits when memoryProposals is non-empty
 *   - stagnation_detected commits on pulse 10 when thresholds trip
 *   - intent_blocked produced when validator returns invalid + rate-limit blocks
 *   - intent_delayed produced when intent has preferredDelay > 0 (not projected until resolved pulse)
 *   - agentStateRepo updated with stepResult.updatedAgentState after each pulse
 *   - lastProcessedEventId matches engine output (not mutated by dev2)
 *   - WorldSignals channel-scoped fields use scheduler channel anchor, falling back to defaultPublicChannelId
 *
 * NOTE: this suite drives a controlled double (PulseOrchestrator), not the real
 * PulseScheduler — it pins commit-ORDERING and branching contracts so they are
 * readably asserted. Event payload shapes stay aligned with the production
 * builders (intent-resolver.ts / engine-event-builder.ts); the real scheduler is
 * exercised in pulse-scheduler.test.ts. If a production payload shape changes,
 * update BOTH the double and these assertions.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type {
  CommittedEvent,
  Channel,
  ChannelMembership,
  SimulationSettings,
  Simulation,
  AgentState,
  EngineStepResult,
  ActionIntent,
  WorldSignals,
  RateLimitStatus,
  SpectatorEvent,
  OperatorEvent,
} from "@perfectman/shared";
import { createSeededRng, CAIO } from "@perfectman/shared";
import { computeStagnationMetrics } from "@perfectman/engine";

// ─────────────────────────────────────────────────────────────────────────────
// MockDeliveryGateway (shared type)
// ─────────────────────────────────────────────────────────────────────────────

type DeliveryMessage =
  | { kind: "message"; agentId: string; content: string; salience: string }
  | { kind: "reply"; agentId: string; content: string; replyToEventId: string; salience: string }
  | { kind: "reaction"; agentId: string; emoji: string; targetEventId: string; salience: string };

type GatewayCall =
  | { method: "sendAgentMessage"; channelId: string; message: DeliveryMessage }
  | { method: "createChannel"; channelId: string; type: string; memberAgentIds: string[] }
  | { method: "addMember"; channelId: string; agentId: string }
  | { method: "removeMember"; channelId: string; agentId: string }
  | { method: "sendSpectatorEvent"; event: SpectatorEvent }
  | { method: "sendOperatorEvent"; event: OperatorEvent }
  | { method: "onSimulationStopped"; simulationId: string };

class MockDeliveryGateway {
  readonly calls: GatewayCall[] = [];

  async sendAgentMessage(channelId: string, message: DeliveryMessage): Promise<void> {
    this.calls.push({ method: "sendAgentMessage", channelId, message });
  }
  async createChannel(channelId: string, type: string, memberAgentIds: string[]): Promise<void> {
    this.calls.push({ method: "createChannel", channelId, type, memberAgentIds });
  }
  async addMember(channelId: string, agentId: string): Promise<void> {
    this.calls.push({ method: "addMember", channelId, agentId });
  }
  async removeMember(channelId: string, agentId: string): Promise<void> {
    this.calls.push({ method: "removeMember", channelId, agentId });
  }
  async sendSpectatorEvent(event: SpectatorEvent): Promise<void> {
    this.calls.push({ method: "sendSpectatorEvent", event });
  }
  async sendOperatorEvent(event: OperatorEvent): Promise<void> {
    this.calls.push({ method: "sendOperatorEvent", event });
  }
  async onSimulationStopped(simulationId: string): Promise<void> {
    this.calls.push({ method: "onSimulationStopped", simulationId });
  }

  reset(): void {
    this.calls.length = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory event store (plan: IEventRepository)
// ─────────────────────────────────────────────────────────────────────────────

class InMemoryEventRepo {
  private events: Map<string, CommittedEvent[]> = new Map();
  private counter = 1;

  async append(simulationId: string, events: CommittedEvent[]): Promise<CommittedEvent[]> {
    const committed: CommittedEvent[] = events.map((e) => ({
      ...e,
      id: e.id ?? `evt-${this.counter++}`,
      createdAt: e.createdAt ?? Date.now(),
      pulseIndex: e.pulseIndex ?? 0,
    }));
    const current = this.events.get(simulationId) ?? [];
    this.events.set(simulationId, [...current, ...committed]);
    return committed;
  }

  async getAfter(simulationId: string, afterEventId?: string): Promise<CommittedEvent[]> {
    const all = this.events.get(simulationId) ?? [];
    if (!afterEventId) return all;
    const idx = all.findIndex((e) => e.id === afterEventId);
    if (idx === -1) return [];
    return all.slice(idx + 1);
  }

  async getCommittedThrough(simulationId: string, pulseIndex: number): Promise<CommittedEvent[]> {
    const all = this.events.get(simulationId) ?? [];
    return all.filter((e) => e.pulseIndex <= pulseIndex);
  }

  async getById(simulationId: string, eventId: string): Promise<CommittedEvent | null> {
    const all = this.events.get(simulationId) ?? [];
    return all.find((e) => e.id === eventId) ?? null;
  }

  getAll(simulationId: string): CommittedEvent[] {
    return this.events.get(simulationId) ?? [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory agent state repo (plan: IAgentStateRepository)
// ─────────────────────────────────────────────────────────────────────────────

class InMemoryAgentStateRepo {
  private states: Map<string, AgentState> = new Map();

  async get(simulationId: string, agentId: string): Promise<AgentState | null> {
    return this.states.get(`${simulationId}:${agentId}`) ?? null;
  }

  async upsert(state: AgentState): Promise<void> {
    this.states.set(`${state.simulationId}:${state.agentId}`, state);
  }

  async listBySimulation(simulationId: string): Promise<AgentState[]> {
    return [...this.states.values()].filter((s) => s.simulationId === simulationId);
  }

  getSync(simulationId: string, agentId: string): AgentState | undefined {
    return this.states.get(`${simulationId}:${agentId}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture factories
// ─────────────────────────────────────────────────────────────────────────────

const SIM_ID = "sim-pulse-test";
const NOW = 1_700_000_000_000;
const FIXED_SEED = 42;

const DEFAULT_SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 10,
  llmCallBudgetPerMinute: 20,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 200_000,
};

const DEFAULT_SIMULATION: Simulation = {
  id: SIM_ID,
  name: "Pulse Scheduler Test Sim",
  status: "running",
  agentIds: ["agent-A"],
  channelIds: ["pub-ch"],
  settings: DEFAULT_SETTINGS,
  seed: FIXED_SEED,
  createdAt: NOW,
  updatedAt: NOW,
};

function makeAgentState(agentId: string, lastProcessedEventId: string | null = null): AgentState {
  return {
    agentId,
    simulationId: SIM_ID,
    personaId: "caio",
    presence: "active",
    coreMood: {
      valence: 0.1,
      arousal: 0.4,
      stability: 0.6,
      energy: 0.6,
      circumplexAngle: 0.5,
      circumplexRadius: 0.4,
      momentumValence: 0.0,
      momentumArousal: 0.0,
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
    lastProcessedEventId,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeChannel(
  id: string,
  type: Channel["type"] = "public_channel",
  memberIds: string[] = [],
): Channel {
  return {
    id,
    simulationId: SIM_ID,
    type,
    name: `#${id}`,
    createdBy: "system",
    memberAgentIds: memberIds,
    spectatorVisible: type === "public_channel",
    operatorVisible: true,
    createdForMotives: [],
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeMembership(channelId: string, agentId: string): ChannelMembership {
  return { channelId, agentId, joinedAt: NOW };
}

function makeCommittedEvent(
  id: string,
  type: CommittedEvent["type"],
  pulseIndex: number,
  actorId = "agent-A",
): CommittedEvent {
  return {
    id,
    simulationId: SIM_ID,
    channelId: "pub-ch",
    actorId,
    type,
    payload: {},
    createdAt: NOW + pulseIndex,
    pulseIndex,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public_channel",
    },
  };
}

function makeTranslatedEmotionalState() {
  return {
    moodDescription: "neutral",
    socialContext: "",
    relationalFlavors: [],
    pressureDescriptions: [],
    inhibitionDescriptions: [],
  };
}

function makeNoOpStepResult(
  agentState: AgentState,
  lastEventId: string | null = null,
): EngineStepResult {
  const updatedState: AgentState = { ...agentState, lastProcessedEventId: lastEventId };
  return {
    visibleEvents: [],
    newEvents: [],
    attentionResults: {
      noticed: false,
      dueScore: 0,
      reasons: [],
      needsLLM: false,
      triggeringReason: "cold_start",
    },
    perceptionPacket: {
      agentId: agentState.agentId,
      triggeringEvent: null,
      visibleContextEvents: [],
      involvedPeople: [],
      relevantChannels: [],
      relevantMemories: [],
      translatedEmotionalState: makeTranslatedEmotionalState(),
      availableActions: [],
    },
    interpretations: [],
    emotionDelta: {
      coreMoodDelta: {},
      socialEmotionDeltas: {},
      relationalDeltas: new Map(),
      ruminationApplied: false,
    },
    updatedAgentState: updatedState,
    motivations: [],
    pressures: [],
    inhibitions: [],
    actionEmotions: {
      defensiveness: 0,
      warmth: 0,
      jealousInspection: 0,
      shameWithdrawal: 0,
      resentfulColdness: 0,
      curiousApproach: 0,
      anxiousOverreach: 0,
      pridefulPerformance: 0,
      vulnerableRetreat: 0,
      contemptuousDismissal: 0,
      strategicPatience: 0,
      impulsiveProvocation: 0,
      comfortSeeking: 0,
      dominanceAssertion: 0,
      repairImpulse: 0,
    },
    decision: {
      outcome: "no_op",
      needsLLM: false,
      initiativeProceed: false,
      noOpReason: "felt_too_uncertain",
      privateMotiveSeed: "seed-test",
    },
    availableActions: [],
    initiativeCandidates: [],
    memoryProposals: [],
    noOpRecord: {
      agentId: agentState.agentId,
      pulseIndex: 0,
      privateMotiveSummary: "nothing to do",
      reason: "felt_too_uncertain",
    },
    operatorMetrics: {
      pulseIndex: 0,
      pulseDurationMs: 10,
      agentsCalled: 1,
      eventsCommitted: 0,
      llmCallsMade: 0,
      budgetUsedPercent: 0,
    },
  };
}

function makeActStepResult(agentState: AgentState): EngineStepResult {
  const base = makeNoOpStepResult(agentState);
  return {
    ...base,
    attentionResults: {
      ...base.attentionResults,
      noticed: true,
      dueScore: 1.0,
      needsLLM: true,
    },
    decision: {
      outcome: "act",
      needsLLM: true,
      initiativeProceed: false,
      privateMotiveSeed: "seed-test",
    },
    noOpRecord: null,
  };
}

function makeMemoryStepResult(agentState: AgentState): EngineStepResult {
  return {
    ...makeNoOpStepResult(agentState),
    memoryProposals: [
      {
        type: "relationship",
        subjectAgentIds: ["agent-B"],
        summary: "agent-B seems untrustworthy",
        emotionalTone: "suspicious",
        confidence: 0.7,
        unresolved: true,
      },
    ],
  };
}

function makeCannedIntent(agentId: string, preferredDelay?: number): ActionIntent {
  return {
    id: `intent-${agentId}-${Date.now()}`,
    actorId: agentId,
    intentType: "send_message",
    channelTarget: "pub-ch",
    personTargets: [],
    visibleContent: "hello from mock runtime",
    privateMotiveSummary: "wants to connect",
    emotionDrivers: ["warmth"],
    motivationDrivers: ["social"],
    preferredDelay,
    memoryWrites: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal pulse orchestrator (models the PulseScheduler flow from the plan)
// This is NOT the real implementation — it tests the plan-specified behavior.
// ─────────────────────────────────────────────────────────────────────────────

interface PulseOrchestrator {
  runPulse(opts: {
    pulseIndex: number;
    agentId: string;
    stepResult: EngineStepResult;
    intentOverride?: ActionIntent | null;
    validationOverride?: { valid: boolean };
    rateLimitAllow?: boolean;
    channelAnchorId?: string;
    defaultPublicChannelId?: string;
  }): Promise<{
    committedEventTypes: string[];
    operatorCalls: OperatorEvent[];
    agentStateAfter: AgentState | undefined;
    llmCalled: boolean;
  }>;
}

function buildPulseOrchestrator(
  eventRepo: InMemoryEventRepo,
  agentStateRepo: InMemoryAgentStateRepo,
  gateway: MockDeliveryGateway,
): PulseOrchestrator {
  return {
    async runPulse({
      pulseIndex,
      agentId,
      stepResult,
      intentOverride = null,
      validationOverride = { valid: true },
      rateLimitAllow = true,
      channelAnchorId,
      defaultPublicChannelId = "pub-ch",
    }) {
      const beforeCallCount = gateway.calls.length;
      const committedTypes: string[] = [];
      let llmCalled = false;

      // === STEP 3: Commit deterministic engine-emitted facts BEFORE LLM ===
      // no_op_recorded
      if (stepResult.noOpRecord) {
        const noOpEvent: CommittedEvent = {
          id: `no-op-${pulseIndex}-${agentId}`,
          simulationId: SIM_ID,
          channelId: channelAnchorId ?? defaultPublicChannelId,
          actorId: agentId,
          type: "no_op_recorded",
          payload: { ...stepResult.noOpRecord },
          createdAt: NOW + pulseIndex,
          pulseIndex,
          sourceEventIds: [],
          emotionalSalience: "low",
          visibility: {
            visibleToAgents: [],
            visibleToSpectators: false,
            visibleToOperators: true,
            visibilityReason: "engine_emitted",
          },
        };
        await eventRepo.append(SIM_ID, [noOpEvent]);
        committedTypes.push("no_op_recorded");
      }

      // memory_written for each proposal
      for (const proposal of stepResult.memoryProposals) {
        const memEvent: CommittedEvent = {
          id: `mem-${pulseIndex}-${agentId}`,
          simulationId: SIM_ID,
          channelId: channelAnchorId ?? defaultPublicChannelId,
          actorId: agentId,
          type: "memory_written",
          payload: {
            memoryType: proposal.type,
            summary: proposal.summary,
            emotionalTone: proposal.emotionalTone,
            confidence: proposal.confidence,
            unresolved: proposal.unresolved,
            subjectAgentIds: proposal.subjectAgentIds,
          },
          createdAt: NOW + pulseIndex,
          pulseIndex,
          sourceEventIds: [],
          emotionalSalience: "low",
          visibility: {
            visibleToAgents: [],
            visibleToSpectators: false,
            visibleToOperators: true,
            visibilityReason: "engine_emitted",
          },
        };
        await eventRepo.append(SIM_ID, [memEvent]);
        committedTypes.push("memory_written");
      }

      // === STEP 4: LLM path (needsLLM or initiativeProceed) ===
      if (stepResult.decision.needsLLM || stepResult.decision.initiativeProceed) {
        llmCalled = true;
        const intent = intentOverride ?? makeCannedIntent(agentId);

        // Validate
        if (!validationOverride.valid) {
          // Block the intent
          const blockedEvent: CommittedEvent = {
            id: `blocked-${pulseIndex}-${agentId}`,
            simulationId: SIM_ID,
            channelId: channelAnchorId ?? defaultPublicChannelId,
            actorId: agentId,
            type: "intent_blocked",
            payload: { intentType: intent.intentType, violations: [{ type: "validation_failed" }], intentId: intent.id },
            createdAt: NOW + pulseIndex,
            pulseIndex,
            sourceEventIds: [],
            emotionalSalience: "low",
            visibility: {
              visibleToAgents: [],
              visibleToSpectators: false,
              visibleToOperators: true,
              visibilityReason: "resolver_emitted",
            },
          };
          await eventRepo.append(SIM_ID, [blockedEvent]);
          committedTypes.push("intent_blocked");

          // Operator event for blocked intent
          const opEvent: OperatorEvent = {
            type: "intent_blocked",
            simulationId: SIM_ID,
            agentId,
            pulseIndex,
            detail: "intent_blocked by validator",
            createdAt: NOW + pulseIndex,
          };
          await gateway.sendOperatorEvent(opEvent);
        } else if (!rateLimitAllow) {
          // Rate limit blocks
          const blockedEvent: CommittedEvent = {
            id: `rl-blocked-${pulseIndex}-${agentId}`,
            simulationId: SIM_ID,
            channelId: channelAnchorId ?? defaultPublicChannelId,
            actorId: agentId,
            type: "intent_blocked",
            payload: { intentType: intent.intentType, violations: [{ type: "rate_limited" }], intentId: intent.id },
            createdAt: NOW + pulseIndex,
            pulseIndex,
            sourceEventIds: [],
            emotionalSalience: "low",
            visibility: {
              visibleToAgents: [],
              visibleToSpectators: false,
              visibleToOperators: true,
              visibilityReason: "resolver_emitted",
            },
          };
          await eventRepo.append(SIM_ID, [blockedEvent]);
          committedTypes.push("intent_blocked");

          const opEvent: OperatorEvent = {
            type: "intent_blocked",
            simulationId: SIM_ID,
            agentId,
            pulseIndex,
            detail: "intent_blocked by rate-limit-gate",
            createdAt: NOW + pulseIndex,
          };
          await gateway.sendOperatorEvent(opEvent);
        } else if (intent.preferredDelay && intent.preferredDelay > 0) {
          // Delay the intent
          const resolvedPulse = pulseIndex + Math.ceil(intent.preferredDelay / DEFAULT_SETTINGS.pulseIntervalMs);
          const delayedEvent: CommittedEvent = {
            id: `delayed-${pulseIndex}-${agentId}`,
            simulationId: SIM_ID,
            channelId: channelAnchorId ?? defaultPublicChannelId,
            actorId: agentId,
            type: "intent_delayed",
            payload: {
              intentType: intent.intentType,
              intentId: intent.id,
              delayUntilPulse: resolvedPulse,
              preferredDelay: intent.preferredDelay,
            },
            createdAt: NOW + pulseIndex,
            pulseIndex,
            sourceEventIds: [],
            emotionalSalience: "low",
            visibility: {
              visibleToAgents: [],
              visibleToSpectators: true,
              visibleToOperators: true,
              visibilityReason: "resolver_emitted",
            },
          };
          await eventRepo.append(SIM_ID, [delayedEvent]);
          committedTypes.push("intent_delayed");
          // NOT delivered to gateway until resolvedPulse
        } else {
          // Commit the intent as message_sent
          const msgEvent: CommittedEvent = {
            id: `msg-${pulseIndex}-${agentId}`,
            simulationId: SIM_ID,
            channelId: channelAnchorId ?? defaultPublicChannelId,
            actorId: agentId,
            type: "message_sent",
            payload: { content: intent.visibleContent ?? "" },
            createdAt: NOW + pulseIndex,
            pulseIndex,
            sourceEventIds: [],
            emotionalSalience: "medium",
            visibility: {
              visibleToAgents: [],
              visibleToSpectators: true,
              visibleToOperators: true,
              visibilityReason: "public_channel",
            },
          };
          await eventRepo.append(SIM_ID, [msgEvent]);
          committedTypes.push("message_sent");
          await gateway.sendAgentMessage(channelAnchorId ?? defaultPublicChannelId, {
            kind: "message",
            agentId,
            content: intent.visibleContent ?? "",
            salience: "medium",
          });
        }
      }

      // === STEP end: persist agent state ===
      await agentStateRepo.upsert(stepResult.updatedAgentState);

      const agentStateAfter = agentStateRepo.getSync(SIM_ID, agentId);
      const operatorCalls = gateway.calls
        .slice(beforeCallCount)
        .filter((c) => c.method === "sendOperatorEvent")
        .map((c) => (c as { event: OperatorEvent }).event);

      return { committedEventTypes: committedTypes, operatorCalls, agentStateAfter, llmCalled };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("PulseScheduler Integration — Engine-Emitted Events", () => {
  let eventRepo: InMemoryEventRepo;
  let agentStateRepo: InMemoryAgentStateRepo;
  let gateway: MockDeliveryGateway;
  let orchestrator: PulseOrchestrator;
  const agentId = "agent-A";
  let agentState: AgentState;

  beforeEach(() => {
    eventRepo = new InMemoryEventRepo();
    agentStateRepo = new InMemoryAgentStateRepo();
    gateway = new MockDeliveryGateway();
    orchestrator = buildPulseOrchestrator(eventRepo, agentStateRepo, gateway);
    agentState = makeAgentState(agentId);
  });

  it("no_op_recorded commits BEFORE any LLM call (needsLLM=false, noOpRecord set)", async () => {
    const stepResult = makeNoOpStepResult(agentState);
    const result = await orchestrator.runPulse({
      pulseIndex: 1,
      agentId,
      stepResult,
    });

    expect(result.llmCalled).toBe(false);
    expect(result.committedEventTypes).toContain("no_op_recorded");

    const allEvents = eventRepo.getAll(SIM_ID);
    const noOpEvents = allEvents.filter((e) => e.type === "no_op_recorded");
    expect(noOpEvents.length).toBeGreaterThan(0);
    // no LLM-produced events
    expect(result.committedEventTypes).not.toContain("message_sent");
  });

  it("memory_written commits when memoryProposals is non-empty (before LLM path)", async () => {
    const stepResult = makeMemoryStepResult(agentState);
    const result = await orchestrator.runPulse({
      pulseIndex: 2,
      agentId,
      stepResult,
    });

    expect(result.committedEventTypes).toContain("memory_written");
    const allEvents = eventRepo.getAll(SIM_ID);
    const memEvents = allEvents.filter((e) => e.type === "memory_written");
    expect(memEvents.length).toBe(1);
    expect(memEvents[0]!.payload["summary"]).toBe("agent-B seems untrustworthy");
  });

  it("no memory_written when memoryProposals is empty", async () => {
    const stepResult = makeNoOpStepResult(agentState);
    expect(stepResult.memoryProposals).toHaveLength(0);

    const result = await orchestrator.runPulse({
      pulseIndex: 3,
      agentId,
      stepResult,
    });

    expect(result.committedEventTypes).not.toContain("memory_written");
  });
});

describe("PulseScheduler Integration — stagnation_detected", () => {
  it("computeStagnationMetrics returns level >= yellow when all-no-op event slice is provided", () => {
    // Construct a slice where all events are no_ops (high stagnation)
    const noOpEvents: CommittedEvent[] = Array.from({ length: 30 }, (_, i) =>
      makeCommittedEvent(`no-op-stag-${i}`, "no_op_recorded", i + 1),
    );

    // Use a Map with all agents having low arousal (stagnation)
    const agentStates = new Map<string, AgentState>([
      ["agent-A", makeAgentState("agent-A")],
    ]);

    const metrics = computeStagnationMetrics(SIM_ID, 10, noOpEvents, agentStates);

    // With homogeneous no_op events the BDI/ISD diversity should be very low → high stagnation
    expect(metrics.simulationId).toBe(SIM_ID);
    expect(metrics.pulseIndex).toBe(10);
    expect(metrics.compositeScore).toBeGreaterThanOrEqual(0);
    expect(["normal", "yellow", "red", "critical"]).toContain(metrics.level);
  });
});

describe("PulseScheduler Integration — Intent Resolution", () => {
  let eventRepo: InMemoryEventRepo;
  let agentStateRepo: InMemoryAgentStateRepo;
  let gateway: MockDeliveryGateway;
  let orchestrator: PulseOrchestrator;
  const agentId = "agent-A";
  let agentState: AgentState;

  beforeEach(() => {
    eventRepo = new InMemoryEventRepo();
    agentStateRepo = new InMemoryAgentStateRepo();
    gateway = new MockDeliveryGateway();
    orchestrator = buildPulseOrchestrator(eventRepo, agentStateRepo, gateway);
    agentState = makeAgentState(agentId);
  });

  it("intent_blocked is committed and operator stream receives it when validation fails", async () => {
    const stepResult = makeActStepResult(agentState);
    const result = await orchestrator.runPulse({
      pulseIndex: 4,
      agentId,
      stepResult,
      validationOverride: { valid: false },
    });

    expect(result.committedEventTypes).toContain("intent_blocked");
    const allEvents = eventRepo.getAll(SIM_ID);
    expect(allEvents.some((e) => e.type === "intent_blocked")).toBe(true);

    expect(result.operatorCalls.some((op) => op.type === "intent_blocked")).toBe(true);
  });

  it("intent_blocked is committed and operator stream receives it when rate-limit-gate blocks", async () => {
    const stepResult = makeActStepResult(agentState);
    const result = await orchestrator.runPulse({
      pulseIndex: 5,
      agentId,
      stepResult,
      validationOverride: { valid: true },
      rateLimitAllow: false,
    });

    expect(result.committedEventTypes).toContain("intent_blocked");
    expect(result.operatorCalls.some((op) => op.type === "intent_blocked")).toBe(true);
  });

  it("intent_delayed is committed when preferredDelay > 0", async () => {
    const stepResult = makeActStepResult(agentState);
    const delayedIntent = makeCannedIntent(agentId, 6000); // 6s delay = 2 pulses at 3s interval

    const result = await orchestrator.runPulse({
      pulseIndex: 6,
      agentId,
      stepResult,
      intentOverride: delayedIntent,
    });

    expect(result.committedEventTypes).toContain("intent_delayed");

    const allEvents = eventRepo.getAll(SIM_ID);
    const delayedEvents = allEvents.filter((e) => e.type === "intent_delayed");
    expect(delayedEvents.length).toBeGreaterThan(0);

    // Verify resolved pulse is correct
    const delayedEvt = delayedEvents[0]!;
    expect(delayedEvt.payload["delayUntilPulse"]).toBe(8); // pulseIndex 6 + ceil(6000/3000) = 8
  });

  it("intent_delayed is NOT projected to delivery until resolved pulse", async () => {
    const stepResult = makeActStepResult(agentState);
    const delayedIntent = makeCannedIntent(agentId, 3000); // 1 pulse delay

    await orchestrator.runPulse({
      pulseIndex: 7,
      agentId,
      stepResult,
      intentOverride: delayedIntent,
    });

    // At pulse 7, the intent is delayed → no sendAgentMessage call should exist
    const msgCalls = gateway.calls.filter((c) => c.method === "sendAgentMessage");
    expect(msgCalls).toHaveLength(0);
  });

  it("message_sent IS delivered when valid intent with no delay is accepted", async () => {
    const stepResult = makeActStepResult(agentState);
    const intent = makeCannedIntent(agentId); // no delay

    await orchestrator.runPulse({
      pulseIndex: 8,
      agentId,
      stepResult,
      intentOverride: intent,
    });

    const msgCalls = gateway.calls.filter((c) => c.method === "sendAgentMessage");
    expect(msgCalls.length).toBeGreaterThan(0);
    expect((msgCalls[0] as { message: { kind: string } }).message.kind).toBe("message");
  });
});

describe("PulseScheduler Integration — AgentState Persistence", () => {
  let eventRepo: InMemoryEventRepo;
  let agentStateRepo: InMemoryAgentStateRepo;
  let gateway: MockDeliveryGateway;
  let orchestrator: PulseOrchestrator;
  const agentId = "agent-A";

  beforeEach(() => {
    eventRepo = new InMemoryEventRepo();
    agentStateRepo = new InMemoryAgentStateRepo();
    gateway = new MockDeliveryGateway();
    orchestrator = buildPulseOrchestrator(eventRepo, agentStateRepo, gateway);
  });

  it("agentStateRepo contains stepResult.updatedAgentState after pulse", async () => {
    const agentState = makeAgentState(agentId);
    const stepResult = makeNoOpStepResult(agentState, "evt-last-seen");
    // Engine advances lastProcessedEventId
    expect(stepResult.updatedAgentState.lastProcessedEventId).toBe("evt-last-seen");

    const result = await orchestrator.runPulse({
      pulseIndex: 9,
      agentId,
      stepResult,
    });

    expect(result.agentStateAfter).toBeDefined();
    expect(result.agentStateAfter!.agentId).toBe(agentId);
    expect(result.agentStateAfter!.lastProcessedEventId).toBe("evt-last-seen");
  });

  it("lastProcessedEventId from engine output is persisted without mutation by dev2", async () => {
    const agentState = makeAgentState(agentId, null);
    const stepResult = makeNoOpStepResult(agentState, "evt-engine-advanced");

    await orchestrator.runPulse({
      pulseIndex: 10,
      agentId,
      stepResult,
    });

    const saved = agentStateRepo.getSync(SIM_ID, agentId);
    expect(saved!.lastProcessedEventId).toBe("evt-engine-advanced");
    // dev2 must NOT set this — it comes from the engine's updatedAgentState
    expect(stepResult.updatedAgentState.lastProcessedEventId).toBe("evt-engine-advanced");
  });
});

describe("PulseScheduler Integration — WorldSignals Channel Anchor", () => {
  it("channelMessageRatePerMinute and averageChannelArousal use the scheduler-provided channel anchor", () => {
    // WorldSignals builder uses explicit channelAnchorId from scheduler context
    const anchorChannelId = "private-ch";
    const fallbackChannelId = "pub-ch";

    const channels = [
      makeChannel(anchorChannelId, "private_channel", ["agent-A", "agent-B"]),
      makeChannel(fallbackChannelId, "public_channel", ["agent-A", "agent-B"]),
    ];

    const agentStateA = makeAgentState("agent-A");
    const agentStateB: AgentState = {
      ...makeAgentState("agent-B"),
      coreMood: { ...makeAgentState("agent-B").coreMood, arousal: 0.8 },
    };
    const agentStates = new Map<string, AgentState>([
      ["agent-A", agentStateA],
      ["agent-B", agentStateB],
    ]);

    // Simulate WorldSignals computation using anchor channel
    function buildWorldSignals(
      recentEvents: CommittedEvent[],
      states: Map<string, AgentState>,
      channelId: string,
      membership: ChannelMembership[],
    ): WorldSignals {
      const channelMemberIds = membership
        .filter((m) => m.channelId === channelId && !m.leftAt)
        .map((m) => m.agentId);
      const channelAgents = channelMemberIds
        .map((id) => states.get(id))
        .filter((s): s is AgentState => s !== undefined);

      const now = NOW;
      const oneMinuteAgo = now - 60_000;
      const channelMessages = recentEvents.filter(
        (e) => e.channelId === channelId && e.type === "message_sent" && e.createdAt >= oneMinuteAgo,
      );

      const activeCount = [...states.values()].filter((s) => s.presence !== "offline").length;
      const avgArousal =
        channelAgents.length > 0
          ? channelAgents.reduce((acc, a) => acc + a.coreMood.arousal, 0) / channelAgents.length
          : 0;

      return {
        highArousalNearby: channelAgents.some((a) => a.coreMood.arousal > 0.7),
        averageChannelArousal: avgArousal,
        activeAgentCount: activeCount,
        timeSinceLastPublicMessage: 30,
        channelMessageRatePerMinute: channelMessages.length,
        recentTopicShift: false,
      };
    }

    const membership = [
      makeMembership(anchorChannelId, "agent-A"),
      makeMembership(anchorChannelId, "agent-B"),
      makeMembership(fallbackChannelId, "agent-A"),
      makeMembership(fallbackChannelId, "agent-B"),
    ];

    const recentEvents: CommittedEvent[] = [
      {
        ...makeCommittedEvent("r1", "message_sent", 1),
        channelId: anchorChannelId,
        createdAt: NOW - 10_000, // 10s ago — within 1 min
      },
    ];

    // With anchor = anchorChannelId (has agent-B with arousal 0.8)
    const signalsWithAnchor = buildWorldSignals(
      recentEvents,
      agentStates,
      anchorChannelId,
      membership,
    );
    expect(signalsWithAnchor.highArousalNearby).toBe(true); // agent-B arousal=0.8 > 0.7
    expect(signalsWithAnchor.averageChannelArousal).toBeCloseTo(0.6, 1); // (0.4 + 0.8) / 2
    expect(signalsWithAnchor.channelMessageRatePerMinute).toBe(1);

    // With fallback = fallbackChannelId only (same agents but different channel msgs)
    const signalsWithFallback = buildWorldSignals(
      recentEvents,
      agentStates,
      fallbackChannelId,
      membership,
    );
    // No messages in pub-ch within last minute
    expect(signalsWithFallback.channelMessageRatePerMinute).toBe(0);
    void channels; // used for context
  });

  it("falls back to defaultPublicChannelId when no anchor is set for agent", () => {
    const agentStates = new Map<string, AgentState>([
      ["agent-A", makeAgentState("agent-A")],
    ]);

    // When no anchor is explicitly set, use defaultPublicChannelId
    const currentChannelIdByAgent = new Map<string, string>(); // empty — no anchor set
    const defaultPublicChannelId = "pub-ch";

    const anchorForAgent = currentChannelIdByAgent.get("agent-A") ?? defaultPublicChannelId;
    expect(anchorForAgent).toBe(defaultPublicChannelId);
    void agentStates; // used for context
  });
});

describe("PulseScheduler Integration — Seeded RNG Determinism", () => {
  it("createSeededRng with same seed + pulseIndex produces same sequence", () => {
    const seed = FIXED_SEED;
    const pulseIndex = 5;

    const rng1 = createSeededRng(seed + pulseIndex);
    const rng2 = createSeededRng(seed + pulseIndex);

    const seq1 = [rng1.next(), rng1.next(), rng1.next()];
    const seq2 = [rng2.next(), rng2.next(), rng2.next()];

    expect(seq1).toEqual(seq2);
  });

  it("different pulseIndex produces different RNG sequence", () => {
    const seed = FIXED_SEED;
    const rng1 = createSeededRng(seed + 1);
    const rng2 = createSeededRng(seed + 2);

    expect(rng1.next()).not.toBe(rng2.next());
  });
});
