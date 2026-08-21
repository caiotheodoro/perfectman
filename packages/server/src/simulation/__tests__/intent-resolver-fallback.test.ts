import { describe, it, expect, beforeEach } from "vitest";
import { IntentResolver } from "../intent-resolver.js";
import type { RateLimitGate } from "../rate-limit-gate.js";
import { ChannelRegistry } from "../channel-registry.js";
import { InMemoryChannelRepository } from "../in-memory-stores.js";
import type {
  ActionIntent,
  AgentState,
  SimulationSettings,
  ActionEmotions,
  AvailableAction,
} from "@perfectman/shared";
import { createId } from "@perfectman/shared";

const SIM_ID = "sim_fb";
const AGENT_ID = "agent_1";
const CHANNEL_ID = "ch_public";

const SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 20,
  llmCallBudgetPerMinute: 10,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 1_000_000,
};

function makeIntent(overrides: Partial<ActionIntent> = {}): ActionIntent {
  return {
    id: createId(),
    actorId: AGENT_ID,
    intentType: "send_message",
    channelTarget: CHANNEL_ID,
    personTargets: [],
    visibleContent: "mensagem de verdade",
    privateMotiveSummary: "test motive",
    emotionDrivers: [],
    motivationDrivers: [],
    memoryWrites: [],
    ...overrides,
  };
}

function makeAgentState(): AgentState {
  return {
    agentId: AGENT_ID,
    simulationId: SIM_ID,
    personaId: "persona_1",
    presence: "active",
    coreMood: { valence: 0, arousal: 0.5, stability: 0.8, energy: 0.6, circumplexAngle: 0, circumplexRadius: 0.5, momentumValence: 0, momentumArousal: 0 },
    socialEmotions: { jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0.3, resentment: 0, suspicion: 0, admiration: 0, contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0 },
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

const ACTION_EMOTIONS: ActionEmotions = {
  defensiveness: 0, warmth: 0.3, jealousInspection: 0, shameWithdrawal: 0,
  resentfulColdness: 0, curiousApproach: 0.3, anxiousOverreach: 0, pridefulPerformance: 0,
  vulnerableRetreat: 0, contemptuousDismissal: 0, strategicPatience: 0,
  impulsiveProvocation: 0, comfortSeeking: 0, dominanceAssertion: 0, repairImpulse: 0,
};

const AVAILABLE_ACTIONS: AvailableAction[] = [
  { intentType: "send_message", channelTargets: [CHANNEL_ID], personTargets: [], blocked: false },
  { intentType: "reply_to_message", channelTargets: [CHANNEL_ID], personTargets: [], blocked: false },
  { intentType: "react", channelTargets: [CHANNEL_ID], personTargets: [], blocked: false },
  { intentType: "create_channel", channelTargets: [], personTargets: [], blocked: false },
  { intentType: "no_op", channelTargets: [], personTargets: [], blocked: false },
];

// Primary send_message is denied because its action is marked blocked.
const BLOCKED_SEND_ACTIONS: AvailableAction[] = AVAILABLE_ACTIONS.map(a =>
  a.intentType === "send_message" ? { ...a, blocked: true, blockReason: "social cooldown" } : a,
);

describe("IntentResolver fallbackIfBlocked (#50 policy)", () => {
  let resolver: IntentResolver;
  let channelRegistry: ChannelRegistry;

  beforeEach(async () => {
    const channelRepo = new InMemoryChannelRepository();
    channelRegistry = new ChannelRegistry(channelRepo);
    await channelRepo.create({
      id: CHANNEL_ID,
      simulationId: SIM_ID,
      type: "public_channel",
      name: "general",
      createdBy: "system",
      memberAgentIds: [AGENT_ID],
      spectatorVisible: true,
      operatorVisible: true,
      createdForMotives: [],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await channelRepo.addMembership({ channelId: CHANNEL_ID, agentId: AGENT_ID, joinedAt: Date.now() });
    const rateLimitGate = new RateLimitGateStub();
    resolver = new IntentResolver(rateLimitGate as RateLimitGate, channelRegistry);
  });

  const ctx = (availableActions = AVAILABLE_ACTIONS) => ({
    simulationId: SIM_ID,
    channelId: CHANNEL_ID,
    pulseIndex: 1,
    agentState: makeAgentState(),
    availableActions,
    channels: [],
    membership: [],
    settings: SETTINGS,
    actionEmotions: ACTION_EMOTIONS,
  });

  it("commits the declared fallback after a non-rate-limit denial, retaining the block event", async () => {
    const intent = makeIntent({ fallbackIfBlocked: "no_op" });
    const result = await resolver.resolve(intent, ctx(BLOCKED_SEND_ACTIONS));

    expect(result.outcome).toBe("fallback_committed");
    const types = result.committedEvents.map(e => e.type);
    expect(types).toContain("intent_blocked");
    expect(types).toContain("no_op_recorded");
  });

  it("suppresses fallback entirely when the primary was rate-limited", async () => {
    const denyingGate = {
      allowAction: () => false,
      recordAction: () => {},
    };
    const gated = new IntentResolver(denyingGate as unknown as RateLimitGate, channelRegistry);

    const intent = makeIntent({ fallbackIfBlocked: "no_op" });
    const result = await gated.resolve(intent, ctx());

    expect(result.outcome).toBe("blocked");
    expect(result.committedEvents).toHaveLength(1);
    expect(result.committedEvents[0]!.type).toBe("intent_blocked");
  });

  it("rejects side-effect-heavy fallback types (engine clamp)", async () => {
    // Primary send_message denied; declared fallback targets create_channel,
    // which is outside the low-risk allow-list -> denial stands.
    const intent = makeIntent({ fallbackIfBlocked: "create_channel" });
    const result = await resolver.resolve(intent, ctx(BLOCKED_SEND_ACTIONS));

    expect(result.outcome).toBe("blocked");
    expect(result.committedEvents.map(e => e.type)).toEqual(["intent_blocked"]);
  });

  it("does not chain: a second-level declaration on the derived intent is impossible", async () => {
    // Primary send_message blocked; fallback no_op commits. Even though the
    // derived intent spreads from the primary (which declared a fallback),
    // the resolver clears it — observable via exactly one extra event and
    // no repeated resolution attempts.
    const intent = makeIntent({
      fallbackIfBlocked: "no_op",
      memoryWrites: [{
        type: "episodic",
        subjectAgentIds: [],
        summary: "I told bruno everything",
        emotionalTone: "neutral",
        confidence: 0.9,
        unresolved: false,
      }],
    });
    const result = await resolver.resolve(intent, ctx(BLOCKED_SEND_ACTIONS));

    expect(result.outcome).toBe("fallback_committed");
    // primary block + derived no_op. The denied primary's memory proposal
    // must NOT commit — it would record a message that never happened.
    expect(result.committedEvents).toHaveLength(2);
    expect(result.committedEvents.filter(e => e.type === "no_op_recorded")).toHaveLength(1);
    expect(result.committedEvents.filter(e => e.type === "memory_written")).toHaveLength(0);
  });

  it("stands by the denial when a react fallback has no target event", async () => {
    const intent = makeIntent({ fallbackIfBlocked: "react", targetEventId: undefined, emoji: "🔥" });
    const result = await resolver.resolve(intent, ctx(BLOCKED_SEND_ACTIONS));

    expect(result.outcome).toBe("blocked");
    expect(result.committedEvents.map(e => e.type)).toEqual(["intent_blocked"]);
  });

  it("stands by the denial when the content-bearing fallback has empty content", async () => {
    const intent = makeIntent({ visibleContent: "   ", fallbackIfBlocked: "send_message" });
    const result = await resolver.resolve(intent, ctx(BLOCKED_SEND_ACTIONS));

    expect(result.outcome).toBe("blocked");
    expect(result.committedEvents.map(e => e.type)).toEqual(["intent_blocked"]);
  });

  it("re-validates the derived intent through the same pipeline (illegal target re-blocks)", async () => {
    const intent = makeIntent({ channelTarget: "ch_not_a_member", fallbackIfBlocked: "reply_to_message" });
    const result = await resolver.resolve(intent, ctx());

    // Derived reply targets the same non-member channel -> blocked again ->
    // original denial stands.
    expect(result.outcome).toBe("blocked");
    expect(result.committedEvents).toHaveLength(1);
  });
});

class RateLimitGateStub {
  allowed = true;
  async allowAction(): Promise<boolean> {
    return this.allowed;
  }
  recordAction(): void {}
}
