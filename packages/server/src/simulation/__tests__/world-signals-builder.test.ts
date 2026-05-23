import { describe, it, expect } from "vitest";
import { buildWorldSignals } from "../world-signals-builder.js";
import type { AgentState, CommittedEvent, ChannelMembership } from "@perfectman/shared";

const CH_ID = "ch_public";
const AGENT_1 = "agent_1";
const AGENT_2 = "agent_2";

function makeState(agentId: string, arousal: number = 0.5, presence: AgentState["presence"] = "active"): AgentState {
  return {
    agentId,
    simulationId: "sim_1",
    personaId: "p1",
    presence,
    coreMood: { valence: 0, arousal, stability: 0.8, energy: 0.6, circumplexAngle: 0, circumplexRadius: 0.5, momentumValence: 0, momentumArousal: 0 },
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

function makeMsgEvent(channelId = CH_ID, createdAt = Date.now()): CommittedEvent {
  return {
    id: "evt_" + createdAt,
    simulationId: "sim_1",
    channelId,
    actorId: AGENT_1,
    type: "message_sent",
    payload: { content: "hi" },
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" },
    createdAt,
    pulseIndex: 1,
  };
}

const MEMBERSHIPS: ChannelMembership[] = [
  { channelId: CH_ID, agentId: AGENT_1, joinedAt: Date.now() },
  { channelId: CH_ID, agentId: AGENT_2, joinedAt: Date.now() },
];

describe("buildWorldSignals", () => {
  it("computes high arousal nearby when channel agent arousal > 0.7", () => {
    const states = new Map([
      [AGENT_1, makeState(AGENT_1, 0.8)],
      [AGENT_2, makeState(AGENT_2, 0.3)],
    ]);
    const signals = buildWorldSignals([], states, AGENT_1, CH_ID, MEMBERSHIPS);
    expect(signals.highArousalNearby).toBe(true);
  });

  it("highArousalNearby false when no agent > 0.7", () => {
    const states = new Map([
      [AGENT_1, makeState(AGENT_1, 0.5)],
      [AGENT_2, makeState(AGENT_2, 0.4)],
    ]);
    const signals = buildWorldSignals([], states, AGENT_1, CH_ID, MEMBERSHIPS);
    expect(signals.highArousalNearby).toBe(false);
  });

  it("computes average arousal from channel members", () => {
    const states = new Map([
      [AGENT_1, makeState(AGENT_1, 0.6)],
      [AGENT_2, makeState(AGENT_2, 0.4)],
    ]);
    const signals = buildWorldSignals([], states, AGENT_1, CH_ID, MEMBERSHIPS);
    expect(signals.averageChannelArousal).toBeCloseTo(0.5);
  });

  it("counts only non-offline agents in activeAgentCount", () => {
    const states = new Map([
      [AGENT_1, makeState(AGENT_1, 0.5, "active")],
      [AGENT_2, makeState(AGENT_2, 0.5, "offline")],
    ]);
    const signals = buildWorldSignals([], states, AGENT_1, CH_ID, MEMBERSHIPS);
    expect(signals.activeAgentCount).toBe(1);
  });

  it("timeSinceLastPublicMessage is large when no messages", () => {
    const states = new Map([[AGENT_1, makeState(AGENT_1)]]);
    const signals = buildWorldSignals([], states, AGENT_1, CH_ID, MEMBERSHIPS);
    expect(signals.timeSinceLastPublicMessage).toBeGreaterThan(1000);
  });

  it("channelMessageRatePerMinute counts recent messages in channel", () => {
    const states = new Map([[AGENT_1, makeState(AGENT_1)]]);
    const recentEvents = [makeMsgEvent(CH_ID, Date.now() - 10_000), makeMsgEvent(CH_ID, Date.now() - 5_000)];
    const signals = buildWorldSignals(recentEvents, states, AGENT_1, CH_ID, MEMBERSHIPS);
    expect(signals.channelMessageRatePerMinute).toBe(2);
  });

  it("recentTopicShift is always false in MVP", () => {
    const states = new Map([[AGENT_1, makeState(AGENT_1)]]);
    const signals = buildWorldSignals([], states, AGENT_1, CH_ID, MEMBERSHIPS);
    expect(signals.recentTopicShift).toBe(false);
  });
});
