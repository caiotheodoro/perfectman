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
} from "@perfectman/shared";
import { createId } from "@perfectman/shared";

const SIM_ID = "sim_test";
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

describe("IntentResolver", () => {
  let resolver: IntentResolver;
  let channelRegistry: ChannelRegistry;

  beforeEach(async () => {
    const channelRepo = new InMemoryChannelRepository();
    channelRegistry = new ChannelRegistry(channelRepo);
    await channelRegistry.createChannel({
      simulationId: SIM_ID,
      type: "public_channel",
      name: "general",
      createdBy: "system",
      memberAgentIds: [AGENT_ID],
      spectatorVisible: true,
    });
    // Override channel ID to match CHANNEL_ID — create with fixed ID
    await channelRepo.create({
      id: CHANNEL_ID,
      simulationId: SIM_ID,
      type: "public_channel",
      name: "general2",
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

    const rateLimitGate = new RateLimitGate(SETTINGS);
    resolver = new IntentResolver(rateLimitGate, channelRegistry);
  });

  const ctx = () => ({
    simulationId: SIM_ID,
    channelId: CHANNEL_ID,
    pulseIndex: 1,
    agentState: makeAgentState(),
    availableActions: AVAILABLE_ACTIONS,
    channels: [],
    membership: [],
    settings: SETTINGS,
    actionEmotions: ACTION_EMOTIONS,
  });

  it("commits a valid send_message intent", async () => {
    const intent = makeIntent({ intentType: "send_message", channelTarget: CHANNEL_ID });
    const result = await resolver.resolve(intent, ctx());
    expect(result.outcome).toBe("committed");
    expect(result.committedEvents).toHaveLength(1);
    expect(result.committedEvents[0]!.type).toBe("message_sent");
  });

  it("blocks intent with missing motive summary", async () => {
    const intent = makeIntent({ privateMotiveSummary: "" });
    const result = await resolver.resolve(intent, ctx());
    expect(result.outcome).toBe("blocked");
    expect(result.committedEvents[0]!.type).toBe("intent_blocked");
  });

  it("delays intent with preferredDelay > 0", async () => {
    const intent = makeIntent({ preferredDelay: 6000 });
    const result = await resolver.resolve(intent, ctx());
    expect(result.outcome).toBe("delayed");
    expect(result.committedEvents[0]!.type).toBe("intent_delayed");
    expect(result.delayUntilPulse).toBe(3);
  });

  it("blocks intent for non-member channel", async () => {
    const intent = makeIntent({ channelTarget: "ch_other_private" });
    const result = await resolver.resolve(intent, ctx());
    expect(result.outcome).toBe("blocked");
  });

  it("creates a channel with the model-provided channelType (not hardcoded private)", async () => {
    const repo = new InMemoryChannelRepository();
    const reg = new ChannelRegistry(repo);
    const r = new IntentResolver(new RateLimitGate(SETTINGS), reg);
    const intent = makeIntent({
      intentType: "create_channel",
      channelTarget: undefined,
      channelName: "clube-do-livro",
      channelType: "public_channel",
      invitedAgentIds: [],
    });
    const result = await r.resolve(intent, ctx());
    expect(result.outcome).toBe("committed");
    const channels = await repo.listBySimulation(SIM_ID);
    expect(channels.find(c => c.name === "clube-do-livro")?.type).toBe("public_channel");
  });

  it("committed events are SimulationEvents (not raw intents)", async () => {
    const intent = makeIntent({ intentType: "send_message", channelTarget: CHANNEL_ID });
    const result = await resolver.resolve(intent, ctx());
    const event = result.committedEvents[0]!;
    expect(event.type).toBe("message_sent");
    expect(event.actorId).toBe(AGENT_ID);
  });
});

describe("private channel event tagging", () => {
  let resolver: IntentResolver;

  beforeEach(async () => {
    const channelRepo = new InMemoryChannelRepository();
    const channelRegistry = new ChannelRegistry(channelRepo);
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
    await channelRepo.create({
      id: "ch_priv",
      simulationId: SIM_ID,
      type: "private_channel",
      name: "pv-test",
      createdBy: AGENT_ID,
      memberAgentIds: [AGENT_ID],
      spectatorVisible: false,
      operatorVisible: true,
      createdForMotives: ["gossip"],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await channelRepo.addMembership({ channelId: "ch_priv", agentId: AGENT_ID, joinedAt: Date.now() });
    resolver = new IntentResolver(new RateLimitGate(SETTINGS), channelRegistry);
  });

  const privCtx = () => ({
    simulationId: SIM_ID,
    channelId: "ch_priv",
    pulseIndex: 1,
    agentState: makeAgentState(),
    availableActions: [
      { intentType: "send_message", channelTargets: ["ch_priv"], personTargets: [], blocked: false },
      { intentType: "reply_to_message", channelTargets: ["ch_priv"], personTargets: [], blocked: false },
      { intentType: "react", channelTargets: ["ch_priv"], personTargets: [], blocked: false },
      { intentType: "no_op", channelTargets: [], personTargets: [], blocked: false },
    ],
    channels: [
      {
        id: "ch_priv",
        simulationId: SIM_ID,
        type: "private_channel" as const,
        name: "pv-test",
        createdBy: AGENT_ID,
        memberAgentIds: [AGENT_ID],
        spectatorVisible: false,
        operatorVisible: true,
        createdForMotives: ["gossip"],
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    membership: [],
    settings: SETTINGS,
    actionEmotions: ACTION_EMOTIONS,
  });

  it("tags private-channel messages so the model can tell", async () => {
    const intent = makeIntent({ intentType: "send_message", channelTarget: "ch_priv" });
    const result = await resolver.resolve(intent, privCtx());
    expect(result.outcome).toBe("committed");
    const evt = result.committedEvents[0]!;
    expect(evt.type).toBe("message_sent");
    expect(evt.visibility.visibilityReason).toBe("private_channel_members_only");
    expect(evt.visibility.visibleToSpectators).toBe(false);
    expect((evt.payload as Record<string, unknown>).channelType).toBe("private_channel");
  });

  it("public messages stay public", async () => {
    const publicCtx = {
      ...privCtx(),
      channelId: CHANNEL_ID,
      availableActions: AVAILABLE_ACTIONS,
      channels: [
        {
          id: CHANNEL_ID,
          simulationId: SIM_ID,
          type: "public_channel" as const,
          name: "general",
          createdBy: "system",
          memberAgentIds: [AGENT_ID],
          spectatorVisible: true,
          operatorVisible: true,
          createdForMotives: [],
          status: "active" as const,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    };
    const intent = makeIntent({ intentType: "send_message", channelTarget: CHANNEL_ID });
    const result = await resolver.resolve(intent, publicCtx);
    const evt = result.committedEvents[0]!;
    expect(evt.visibility.visibilityReason).toBe("public");
    expect((evt.payload as Record<string, unknown>).channelType).toBeUndefined();
  });
});
