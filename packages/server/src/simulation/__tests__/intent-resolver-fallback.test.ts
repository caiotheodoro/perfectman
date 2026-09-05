import { describe, it, expect, beforeEach } from "vitest";
import { IntentResolver } from "../intent-resolver.js";
import { RateLimitGate } from "../rate-limit-gate.js";
import { ChannelRegistry } from "../channel-registry.js";
import { InMemoryChannelRepository } from "../in-memory-stores.js";
import type {
  ActionIntent,
  AgentState,
  SimulationSettings,
  ActionEmotions,
  AvailableAction,
  Channel,
  ChannelMembership,
  RateLimitStatus,
} from "@perfectman/shared";
import { createId } from "@perfectman/shared";
import { computeAvailableActions } from "@perfectman/engine";

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

// Every resolved intent also commits its private_motive_summary (ADR-0014);
// these tests are about the act/denial events, so the motive row is elided.
const acts = (result: { committedEvents: Array<{ type: string }> }) =>
  result.committedEvents.filter((e) => e.type !== "private_motive_summary");

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
    resolver = new IntentResolver(new RateLimitGate(SETTINGS), channelRegistry);
  });

  const ctx = (
    availableActions = AVAILABLE_ACTIONS,
    settings: SimulationSettings = SETTINGS,
  ) => ({
    simulationId: SIM_ID,
    channelId: CHANNEL_ID,
    pulseIndex: 1,
    agentState: makeAgentState(),
    availableActions,
    channels: [],
    membership: [],
    settings,
    actionEmotions: ACTION_EMOTIONS,
  });

  it("commits the declared fallback after a non-rate-limit denial, retaining the block event", async () => {
    const intent = makeIntent({ fallbackIfBlocked: "no_op" });
    const result = await resolver.resolve(intent, ctx(BLOCKED_SEND_ACTIONS));

    expect(result.outcome).toBe("fallback_committed");
    const types = acts(result).map(e => e.type);
    expect(types).toContain("intent_blocked");
    expect(types).toContain("no_op_recorded");
  });

  it("suppresses fallback entirely when the primary was rate-limited via RateLimitGate directly", async () => {
    // A zero message limit makes the real gate deny send_message — no stub.
    const zeroMessageSettings: SimulationSettings = {
      ...SETTINGS,
      maxMessagesPerMinutePerAgent: 0,
    };
    const gated = new IntentResolver(new RateLimitGate(zeroMessageSettings), channelRegistry);

    const intent = makeIntent({ fallbackIfBlocked: "no_op" });
    const result = await gated.resolve(intent, ctx(AVAILABLE_ACTIONS, zeroMessageSettings));

    expect(result.outcome).toBe("blocked");
    expect(acts(result)).toHaveLength(1);
    expect(acts(result)[0]!.type).toBe("intent_blocked");
    const violations = (acts(result)[0]!.payload as { violations: Array<{ type: string }> })
      .violations;
    expect(violations[0]!.type).toBe("rate_limited");
  });

  it("suppresses fallback when the anti-gaming limit denies the primary the way production actually does", async () => {
    // In production, `computeAvailableActions` bakes the per-agent message
    // rate limit into `availableActions` (blockReason: "message_rate_limit")
    // *before* the LLM call — so the primary fails at `validateIntentPure`,
    // never reaching `RateLimitGate.allowAction()` below. Build
    // `availableActions` through the real function instead of hand-rolling
    // `blocked: true` so this test exercises the actual production path.
    const rateLimitedSettings: SimulationSettings = { ...SETTINGS, maxMessagesPerMinutePerAgent: 0 };
    const channel: Channel = {
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
    };
    const membership: ChannelMembership[] = [{ channelId: CHANNEL_ID, agentId: AGENT_ID, joinedAt: Date.now() }];
    const rateLimitStatus: RateLimitStatus = {
      agentId: AGENT_ID,
      messagesThisMinute: 0,
      privateChannelsCreated: 0,
      lastActionAt: null,
      blocked: false,
    };
    const availableActions = computeAvailableActions(
      makeAgentState(),
      [channel],
      membership,
      rateLimitedSettings,
      rateLimitStatus,
    );
    const sendAction = availableActions.find(a => a.intentType === "send_message");
    expect(sendAction?.blocked).toBe(true);
    expect(sendAction?.blockReason).toBe("message_rate_limit");

    const gated = new IntentResolver(new RateLimitGate(rateLimitedSettings), channelRegistry);
    const intent = makeIntent({ fallbackIfBlocked: "no_op" });
    const result = await gated.resolve(intent, ctx(availableActions, rateLimitedSettings));

    expect(result.outcome).toBe("blocked");
    expect(acts(result)).toHaveLength(1);
    expect(acts(result)[0]!.type).toBe("intent_blocked");
    const violations = (acts(result)[0]!.payload as { violations: Array<{ type: string; detail?: string }> })
      .violations;
    expect(violations.some(v => v.detail === "message_rate_limit")).toBe(true);
  });

  it("rejects side-effect-heavy fallback types (engine clamp)", async () => {
    // Primary send_message denied; declared fallback targets create_channel,
    // which is outside the low-risk allow-list -> denial stands.
    const intent = makeIntent({ fallbackIfBlocked: "create_channel" });
    const result = await resolver.resolve(intent, ctx(BLOCKED_SEND_ACTIONS));

    expect(result.outcome).toBe("blocked");
    expect(acts(result).map(e => e.type)).toEqual(["intent_blocked"]);
  });

  it("drops the denied primary's memoryWrites from the committed fallback", async () => {
    // Primary send_message blocked; fallback no_op commits. The denied
    // primary's memoryWrites must not carry over to the derived intent —
    // recording "I told bruno everything" as memory after the message was
    // refused would be false telemetry.
    const intent = makeIntent({
      fallbackIfBlocked: "no_op",
      memoryWrites: [{
        type: "episodic",
        subjectAgentIds: [],
        summary: "I told bruno everything",
        emotionalTone: "neutral",
        confidence: 0.9,
        intensity: 0,
        unresolved: false,
      }],
    });
    const result = await resolver.resolve(intent, ctx(BLOCKED_SEND_ACTIONS));

    expect(result.outcome).toBe("fallback_committed");
    // primary block + derived no_op. The denied primary's memory proposal
    // must NOT commit — it would record a message that never happened.
    expect(acts(result)).toHaveLength(2);
    expect(acts(result).filter(e => e.type === "no_op_recorded")).toHaveLength(1);
    expect(acts(result).filter(e => e.type === "memory_written")).toHaveLength(0);
  });

  it("stands by the denial when a react fallback has no target event", async () => {
    const intent = makeIntent({ fallbackIfBlocked: "react", targetEventId: undefined, emoji: "🔥" });
    const result = await resolver.resolve(intent, ctx(BLOCKED_SEND_ACTIONS));

    expect(result.outcome).toBe("blocked");
    expect(acts(result).map(e => e.type)).toEqual(["intent_blocked"]);
  });

  it("stands by the denial when the content-bearing fallback has empty content", async () => {
    const intent = makeIntent({ visibleContent: "   ", fallbackIfBlocked: "send_message" });
    const result = await resolver.resolve(intent, ctx(BLOCKED_SEND_ACTIONS));

    expect(result.outcome).toBe("blocked");
    expect(acts(result).map(e => e.type)).toEqual(["intent_blocked"]);
  });

  it("re-validates the derived intent through the same pipeline (illegal target re-blocks)", async () => {
    const intent = makeIntent({ channelTarget: "ch_not_a_member", fallbackIfBlocked: "reply_to_message" });
    const result = await resolver.resolve(intent, ctx());

    // Derived reply targets the same non-member channel -> blocked again ->
    // original denial stands.
    expect(result.outcome).toBe("blocked");
    expect(acts(result)).toHaveLength(1);
  });

  it("carries channelTarget into a react fallback, so it re-blocks instead of re-homing to ctx.channelId", async () => {
    // Primary send_message denied while targeting a channel react isn't
    // allow-listed for either. Before the channelTarget carry-through fix,
    // the derived react intent silently dropped channelTarget, skipped the
    // hidden-channel check entirely, and committed in ctx.channelId instead
    // — this pins that it now re-validates against the real target and
    // stays blocked.
    const intent = makeIntent({
      channelTarget: "ch_other",
      fallbackIfBlocked: "react",
      targetEventId: "evt_1",
      emoji: "👍",
    });
    const result = await resolver.resolve(intent, ctx(BLOCKED_SEND_ACTIONS));

    expect(result.outcome).toBe("blocked");
    expect(acts(result).every(e => e.type === "intent_blocked")).toBe(true);
    // Both the primary's and the fallback's block events are retained.
    expect(acts(result)).toHaveLength(2);
    const secondaryViolations = (
      acts(result)[1]!.payload as { violations: Array<{ type: string }> }
    ).violations;
    expect(secondaryViolations.some(v => v.type === "hidden_channel_target")).toBe(true);
  });

  it("rejects delay_response as a fallback destination (not wired: fallback never carries preferredDelay)", async () => {
    // delay_response is excluded from FALLBACK_ALLOWED_TYPES — deriveFallbackIntent
    // never carries preferredDelay over (single-level, same-pulse resolution),
    // so a delay_response fallback would always resolve as an immediate no_op
    // mislabeled as a delay. Until a real delayed-fallback path exists, the
    // denial must stand instead of committing that mismap.
    const intent = makeIntent({ fallbackIfBlocked: "delay_response" });
    const result = await resolver.resolve(intent, ctx(BLOCKED_SEND_ACTIONS));

    expect(result.outcome).toBe("blocked");
    expect(acts(result).map(e => e.type)).toEqual(["intent_blocked"]);
  });
});
