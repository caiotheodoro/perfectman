import { describe, it, expect } from "vitest";
import type {
  AgentState,
  Channel,
  ChannelMembership,
  SimulationSettings,
  RateLimitStatus,
  CoreMood,
  SocialEmotions,
} from "@perfectman/shared";
import { computeAvailableActions } from "../action/compute-available-actions.js";

// --- Helpers ---

const DEFAULT_MOOD: CoreMood = {
  valence: 0.2, arousal: 0.4, stability: 0.6,
  energy: 0.6, circumplexAngle: 0.2, circumplexRadius: 0.5,
  momentumValence: 0, momentumArousal: 0,
};

const ZERO_SOCIAL: SocialEmotions = {
  jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
  affection: 0, resentment: 0, suspicion: 0, admiration: 0,
  contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
  desireForStatus: 0, desireForIntimacy: 0,
};

function makeAgent(overrides?: Partial<AgentState>): AgentState {
  return {
    agentId: "a1",
    simulationId: "sim1",
    personaId: "caio",
    presence: "active",
    coreMood: DEFAULT_MOOD,
    socialEmotions: ZERO_SOCIAL,
    relationalStates: new Map(),
    memories: [],
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

function makeChannel(id: string, overrides?: Partial<Channel>): Channel {
  return {
    id,
    simulationId: "sim1",
    type: "public_channel",
    name: `#${id}`,
    createdBy: "system",
    memberAgentIds: ["a1", "a2", "a3"],
    spectatorVisible: true,
    operatorVisible: true,
    createdForMotives: [],
    status: "active",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

function makeMembership(channelId: string, agentId = "a1", leftAt?: number): ChannelMembership {
  return { channelId, agentId, joinedAt: 1700000000000, leftAt };
}

const DEFAULT_SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 10,
  llmCallBudgetPerMinute: 20,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 200000,
};

function makeRateLimit(overrides?: Partial<RateLimitStatus>): RateLimitStatus {
  return {
    agentId: "a1",
    messagesThisMinute: 0,
    privateChannelsCreated: 0,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
    blocked: false,
    ...overrides,
  };
}

// --- Tests ---
describe("computeAvailableActions", () => {
  it("all actions blocked for offline agent", () => {
    const agent = makeAgent({ presence: "offline" });
    const actions = computeAvailableActions(agent, [], [], DEFAULT_SETTINGS, makeRateLimit());
    expect(actions.every(a => a.blocked)).toBe(true);
    expect(actions.every(a => a.blockReason === "agent_offline")).toBe(true);
  });

  it("returns all 10 intent types", () => {
    const agent = makeAgent();
    const channels = [makeChannel("ch1")];
    const membership = [makeMembership("ch1")];
    const actions = computeAvailableActions(agent, channels, membership, DEFAULT_SETTINGS, makeRateLimit());
    const types = new Set(actions.map(a => a.intentType));
    expect(types.size).toBe(10);
  });

  it("no_op always available", () => {
    const agent = makeAgent({ presence: "active" });
    const actions = computeAvailableActions(agent, [], [], DEFAULT_SETTINGS, makeRateLimit({
      blocked: true,
      blockReason: "global_block",
    }));
    const noOp = actions.find(a => a.intentType === "no_op");
    expect(noOp?.blocked).toBe(false);
  });

  it("write_memory is never a permitted action (memory rides a normal action's memoryWrites)", () => {
    const agent = makeAgent({ presence: "active" });
    const channels = [makeChannel("ch1")];
    const membership = [makeMembership("ch1")];
    const actions = computeAvailableActions(agent, channels, membership, DEFAULT_SETTINGS, makeRateLimit());
    expect(
      actions.some(a => a.intentType === "write_memory"),
      `write_memory must not appear in permitted actions, got: ${actions.map(a => a.intentType).join(", ")}`,
    ).toBe(false);
  });

  it("send_message blocked when message rate limit reached", () => {
    const agent = makeAgent();
    const channels = [makeChannel("ch1")];
    const membership = [makeMembership("ch1")];
    const rateLimit = makeRateLimit({ messagesThisMinute: 10 });
    const actions = computeAvailableActions(agent, channels, membership, DEFAULT_SETTINGS, rateLimit);
    const sendMsg = actions.find(a => a.intentType === "send_message");
    expect(sendMsg?.blocked).toBe(true);
    expect(sendMsg?.blockReason).toBe("message_rate_limit");
  });

  it("create_channel blocked when private channels disabled", () => {
    const settings = { ...DEFAULT_SETTINGS, allowPrivateChannels: false };
    const agent = makeAgent();
    const actions = computeAvailableActions(agent, [], [], settings, makeRateLimit());
    const create = actions.find(a => a.intentType === "create_channel");
    expect(create?.blocked).toBe(true);
    expect(create?.blockReason).toBe("private_channels_disabled");
  });

  it("create_channel blocked when at private channel limit", () => {
    const agent = makeAgent();
    const rateLimit = makeRateLimit({ privateChannelsCreated: 3 });
    const actions = computeAvailableActions(agent, [], [], DEFAULT_SETTINGS, rateLimit);
    const create = actions.find(a => a.intentType === "create_channel");
    expect(create?.blocked).toBe(true);
    expect(create?.blockReason).toBe("private_channel_limit");
  });

  it("all message actions blocked when globally blocked", () => {
    const agent = makeAgent();
    const channels = [makeChannel("ch1")];
    const membership = [makeMembership("ch1")];
    const rateLimit = makeRateLimit({ blocked: true, blockReason: "manual_block" });
    const actions = computeAvailableActions(agent, channels, membership, DEFAULT_SETTINGS, rateLimit);
    const messageAction = actions.find(a => a.intentType === "send_message");
    expect(messageAction?.blocked).toBe(true);
  });

  it("channelTargets contains member channels — private included so agents can converse privately", () => {
    const agent = makeAgent();
    const channels = [makeChannel("ch1"), makeChannel("ch2"), makeChannel("priv1", { type: "private_channel" })];
    const membership = [makeMembership("ch1"), makeMembership("ch2"), makeMembership("priv1")];
    const actions = computeAvailableActions(agent, channels, membership, DEFAULT_SETTINGS, makeRateLimit());
    const sendMsg = actions.find(a => a.intentType === "send_message");
    expect(sendMsg?.channelTargets).toContain("ch1");
    expect(sendMsg?.channelTargets).toContain("ch2");
    expect(sendMsg?.channelTargets).toContain("priv1"); // private channels are for talking in
  });

  it("personTargets excludes self", () => {
    const agent = makeAgent();
    const channels = [makeChannel("ch1", { memberAgentIds: ["a1", "a2", "a3"] })];
    const membership = [makeMembership("ch1")];
    const actions = computeAvailableActions(agent, channels, membership, DEFAULT_SETTINGS, makeRateLimit());
    const react = actions.find(a => a.intentType === "react");
    expect(react?.personTargets).not.toContain("a1");
    expect(react?.personTargets).toContain("a2");
    expect(react?.personTargets).toContain("a3");
  });

  it("invite_agent has no targets when no private channels exist", () => {
    const agent = makeAgent();
    const channels = [makeChannel("ch1")];
    const membership = [makeMembership("ch1")];
    const actions = computeAvailableActions(agent, channels, membership, DEFAULT_SETTINGS, makeRateLimit());
    const invite = actions.find(a => a.intentType === "invite_agent");
    expect(invite?.blocked).toBe(true);
    expect(invite?.blockReason).toBe("no_private_channel");
  });

  it("invite_agent has private channel targets when agent is member", () => {
    const agent = makeAgent();
    const channels = [makeChannel("ch1"), makeChannel("priv1", { type: "private_channel", memberAgentIds: ["a1", "a2"] })];
    const membership = [makeMembership("ch1"), makeMembership("priv1")];
    const actions = computeAvailableActions(agent, channels, membership, DEFAULT_SETTINGS, makeRateLimit());
    const invite = actions.find(a => a.intentType === "invite_agent");
    expect(invite?.channelTargets).toContain("priv1");
    expect(invite?.blocked).toBe(false);
  });
});
