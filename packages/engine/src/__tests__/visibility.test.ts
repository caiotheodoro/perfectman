import { describe, it, expect } from "vitest";
import type {
  CommittedEvent,
  Channel,
  ChannelMembership,
  SimulationSettings,
  EventVisibility,
} from "@perfectman/shared";
import {
  filterVisibleEventsForAgent,
  filterVisibleEventsForSpectator,
  filterVisibleEventsForOperator,
} from "../visibility/filter-visible-events.js";
import {
  getNewEventsSince,
  getLastEventId,
} from "../memory/get-new-events-since.js";

// --- Helpers ---

function makeVisibility(overrides?: Partial<EventVisibility>): EventVisibility {
  return {
    visibleToAgents: [],
    visibleToSpectators: true,
    visibleToOperators: true,
    visibilityReason: "public_channel",
    ...overrides,
  };
}

function makeEvent(
  id: string,
  channelId: string,
  visibilityOverrides?: Partial<EventVisibility>,
): CommittedEvent {
  return {
    id,
    simulationId: "sim1",
    channelId,
    actorId: "agent1",
    type: "message_sent",
    payload: { text: "hi" },
    createdAt: 1700000000000 + parseInt(id),
    pulseIndex: 1,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: makeVisibility(visibilityOverrides),
  };
}

function makeMembership(channelId: string, agentId: string, leftAt?: number): ChannelMembership {
  return { channelId, agentId, joinedAt: 1700000000000, leftAt };
}

function makeChannel(id: string, overrides?: Partial<Channel>): Channel {
  return {
    id,
    simulationId: "sim1",
    type: "public_channel",
    name: `#${id}`,
    createdBy: "system",
    memberAgentIds: [],
    spectatorVisible: true,
    operatorVisible: true,
    createdForMotives: [],
    status: "active",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
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

// --- filterVisibleEventsForAgent ---
describe("filterVisibleEventsForAgent", () => {
  it("includes events from channels agent is member of", () => {
    const events = [makeEvent("1", "ch1"), makeEvent("2", "ch2")];
    const membership = [makeMembership("ch1", "a1")];
    const channels = [makeChannel("ch1"), makeChannel("ch2")];
    const result = filterVisibleEventsForAgent(events, "a1", channels, membership);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("1");
  });

  it("excludes events from channels agent is not member of", () => {
    const events = [makeEvent("1", "ch_private")];
    const result = filterVisibleEventsForAgent(events, "a1", [], []);
    expect(result).toHaveLength(0);
  });

  it("respects visibleToAgents list when non-empty", () => {
    const events = [
      makeEvent("1", "ch1", { visibleToAgents: ["a1"] }),
      makeEvent("2", "ch1", { visibleToAgents: ["a2"] }),
      makeEvent("3", "ch1", { visibleToAgents: [] }),
    ];
    const membership = [makeMembership("ch1", "a1")];
    const channels = [makeChannel("ch1")];
    const result = filterVisibleEventsForAgent(events, "a1", channels, membership);
    expect(result.map(e => e.id)).toEqual(["1", "3"]);
  });

  it("excludes events from channels agent has left", () => {
    const events = [makeEvent("1", "ch1")];
    const membership = [makeMembership("ch1", "a1", 1700000000001)]; // leftAt set
    const channels = [makeChannel("ch1")];
    const result = filterVisibleEventsForAgent(events, "a1", channels, membership);
    expect(result).toHaveLength(0);
  });

  it("agent sees their own events in private channel", () => {
    const events = [makeEvent("1", "priv1", { visibleToAgents: ["a1", "a2"] })];
    const membership = [makeMembership("priv1", "a1"), makeMembership("priv1", "a2")];
    const channels = [makeChannel("priv1", { type: "private_channel", spectatorVisible: false })];
    const result = filterVisibleEventsForAgent(events, "a1", channels, membership);
    expect(result).toHaveLength(1);
  });

  it("non-member cannot see private channel event even if visibleToAgents is empty", () => {
    const events = [makeEvent("1", "priv1")];
    const membership: ChannelMembership[] = []; // a1 not a member
    const channels = [makeChannel("priv1", { type: "private_channel", spectatorVisible: false })];
    const result = filterVisibleEventsForAgent(events, "a1", channels, membership);
    expect(result).toHaveLength(0);
  });
});

// --- filterVisibleEventsForSpectator ---
describe("filterVisibleEventsForSpectator", () => {
  it("includes events where visibleToSpectators=true and channel is spectatorVisible", () => {
    const events = [makeEvent("1", "ch1")];
    const channels = [makeChannel("ch1", { spectatorVisible: true })];
    const result = filterVisibleEventsForSpectator(events, channels, DEFAULT_SETTINGS);
    expect(result).toHaveLength(1);
  });

  it("excludes events where visibleToSpectators=false", () => {
    const events = [makeEvent("1", "ch1", { visibleToSpectators: false })];
    const channels = [makeChannel("ch1")];
    const result = filterVisibleEventsForSpectator(events, channels, DEFAULT_SETTINGS);
    expect(result).toHaveLength(0);
  });

  it("excludes private channel events when not omniscient", () => {
    const events = [makeEvent("1", "priv1")];
    const channels = [makeChannel("priv1", { type: "private_channel", spectatorVisible: false })];
    const result = filterVisibleEventsForSpectator(events, channels, DEFAULT_SETTINGS);
    expect(result).toHaveLength(0);
  });

  it("includes private channel events when omniscientSpectatorMode=true", () => {
    const events = [makeEvent("1", "priv1")];
    const channels = [makeChannel("priv1", { type: "private_channel", spectatorVisible: false })];
    const omniscientSettings = { ...DEFAULT_SETTINGS, omniscientSpectatorMode: true };
    const result = filterVisibleEventsForSpectator(events, channels, omniscientSettings);
    expect(result).toHaveLength(1);
  });
});

// --- filterVisibleEventsForOperator ---
describe("filterVisibleEventsForOperator", () => {
  it("includes all events with visibleToOperators=true", () => {
    const events = [makeEvent("1", "ch1"), makeEvent("2", "priv1")];
    const result = filterVisibleEventsForOperator(events);
    expect(result).toHaveLength(2);
  });

  it("excludes events with visibleToOperators=false", () => {
    const events = [makeEvent("1", "ch1", { visibleToOperators: false })];
    const result = filterVisibleEventsForOperator(events);
    expect(result).toHaveLength(0);
  });
});

// --- Anti-Drift: getNewEventsSince ---
describe("getNewEventsSince", () => {
  const events: CommittedEvent[] = [
    makeEvent("10", "ch1"),
    makeEvent("20", "ch1"),
    makeEvent("30", "ch1"),
    makeEvent("40", "ch1"),
  ];

  it("returns all events when lastProcessedEventId is null (cold start)", () => {
    const result = getNewEventsSince(events, null);
    expect(result).toHaveLength(4);
  });

  it("returns events after the cursor", () => {
    const result = getNewEventsSince(events, "20");
    expect(result.map(e => e.id)).toEqual(["30", "40"]);
  });

  it("returns empty when cursor is at last event", () => {
    const result = getNewEventsSince(events, "40");
    expect(result).toHaveLength(0);
  });

  it("returns empty when cursor not found", () => {
    const result = getNewEventsSince(events, "999");
    expect(result).toHaveLength(0);
  });

  it("cursor is strictly after — does not include cursor event", () => {
    const result = getNewEventsSince(events, "10");
    expect(result[0]!.id).toBe("20");
    expect(result.find(e => e.id === "10")).toBeUndefined();
  });

  it("cursor does not go backward", () => {
    // Process events up to 30, then try to get after 20 — should still return 30+
    const first = getNewEventsSince(events, null);
    const newCursor = getLastEventId(first.slice(0, 3)); // "30"
    const second = getNewEventsSince(events, newCursor!);
    expect(second.map(e => e.id)).toEqual(["40"]);
  });
});

// --- getLastEventId ---
describe("getLastEventId", () => {
  it("returns last event id", () => {
    const events = [makeEvent("1", "ch1"), makeEvent("2", "ch1")];
    expect(getLastEventId(events)).toBe("2");
  });

  it("returns null for empty array", () => {
    expect(getLastEventId([])).toBeNull();
  });
});

describe("private_motive_summary is never agent-visible", () => {
  it("drops the motive event for a channel member even with public-shaped visibility", () => {
    const motive: CommittedEvent = {
      ...makeEvent("9", "ch1"),
      type: "private_motive_summary",
      payload: { summary: "counting the exits" },
    };
    const visible = filterVisibleEventsForAgent(
      [motive],
      "agent1",
      [makeChannel("ch1")],
      [makeMembership("ch1", "agent1")],
    );
    expect(visible).toEqual([]);
  });
});
