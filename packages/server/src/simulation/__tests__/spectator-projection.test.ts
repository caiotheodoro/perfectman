import { describe, it, expect, beforeEach } from "vitest";
import { SpectatorProjection } from "../projections/spectator-projection.js";
import { MockDeliveryGateway } from "../../delivery/mock-delivery-gateway.js";
import type { CommittedEvent, Channel, SimulationSettings } from "@perfectman/shared";

const SIM_ID = "sim_1";
const CH_ID = "ch_public";
const AGENT_1 = "agent_1";

const SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 20,
  llmCallBudgetPerMinute: 10,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 1_000_000,
};

const PUBLIC_CHANNEL: Channel = {
  id: CH_ID,
  simulationId: SIM_ID,
  type: "public_channel",
  name: "general",
  createdBy: "system",
  memberAgentIds: [AGENT_1],
  spectatorVisible: true,
  operatorVisible: true,
  createdForMotives: [],
  status: "active",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function makeEvent(overrides: Partial<CommittedEvent> = {}): CommittedEvent {
  return {
    id: "evt_1",
    simulationId: SIM_ID,
    channelId: CH_ID,
    actorId: AGENT_1,
    type: "message_sent",
    payload: { content: "hello" },
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public",
    },
    createdAt: Date.now(),
    pulseIndex: 1,
    ...overrides,
  };
}

describe("SpectatorProjection", () => {
  let gateway: MockDeliveryGateway;
  let projection: SpectatorProjection;

  beforeEach(() => {
    gateway = new MockDeliveryGateway();
    projection = new SpectatorProjection(gateway);
  });

  it("produces a spectator event for message_sent", () => {
    const event = makeEvent({ type: "message_sent" });
    const result = projection.buildSpectatorEvent(event, SETTINGS);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("message_sent");
  });

  it("produces spectator_hint for no_op_recorded", () => {
    const event = makeEvent({
      type: "no_op_recorded",
      payload: { privateMotiveSummary: "secretly planning" },
    });
    const result = projection.buildSpectatorEvent(event, SETTINGS);
    expect(result?.type).toBe("spectator_hint");
  });

  it("motive summary is sanitized in spectator event (no raw private content)", () => {
    const event = makeEvent({
      type: "no_op_recorded",
      payload: { privateMotiveSummary: "A".repeat(200) },
    });
    const result = projection.buildSpectatorEvent(event, SETTINGS);
    expect((result?.visibleContent?.length ?? 0)).toBeLessThanOrEqual(80);
  });

  it("intent_delayed produces a spectator_hint", () => {
    const event = makeEvent({
      type: "intent_delayed",
      payload: { intentType: "send_message", delayUntilPulse: 3 },
    });
    const result = projection.buildSpectatorEvent(event, SETTINGS);
    expect(result?.type).toBe("spectator_hint");
  });

  it("returns null for unknown events when not omniscient", () => {
    const event = makeEvent({
      type: "simulation_started",
      visibility: { visibleToAgents: [], visibleToSpectators: false, visibleToOperators: true, visibilityReason: "op" },
    });
    const result = projection.buildSpectatorEvent(event, SETTINGS);
    expect(result).toBeNull();
  });

  it("returns event for unknown types when omniscientSpectatorMode=true", () => {
    const event = makeEvent({
      type: "simulation_started",
      visibility: { visibleToAgents: [], visibleToSpectators: false, visibleToOperators: true, visibilityReason: "op" },
    });
    const omniSettings = { ...SETTINGS, omniscientSpectatorMode: true };
    const result = projection.buildSpectatorEvent(event, omniSettings);
    expect(result).not.toBeNull();
  });

  it("truncates an over-long motive hint on a word boundary with an ellipsis", () => {
    const summary = `${"x".repeat(50)} ${"y".repeat(50)}`;
    const event = makeEvent({
      type: "no_op_recorded",
      payload: { privateMotiveSummary: summary },
    });
    const result = projection.buildSpectatorEvent(event, SETTINGS);
    expect(result?.visibleContent).toBe(`${"x".repeat(50)}...`);
    expect(result?.visibleContent?.length ?? 0).toBeLessThanOrEqual(80);
    expect(result?.visibleContent).not.toContain("y");
  });

  it("leaves a short motive hint intact with no ellipsis", () => {
    const event = makeEvent({
      type: "no_op_recorded",
      payload: { privateMotiveSummary: "weighing whether to speak" },
    });
    const result = projection.buildSpectatorEvent(event, SETTINGS);
    expect(result?.visibleContent).toBe("weighing whether to speak");
  });

  it("surfaces the emoji in a reaction_sent spectator event", () => {
    const event = makeEvent({
      type: "reaction_sent",
      payload: { emoji: "🎉", targetEventId: "evt_42" },
    });
    const result = projection.buildSpectatorEvent(event, SETTINGS);
    expect(result?.type).toBe("reaction_sent");
    expect(result?.visibleContent).toBe("🎉");
  });

  it("delivers the reaction emoji through project()", async () => {
    const event = makeEvent({
      type: "reaction_sent",
      payload: { emoji: "👍", targetEventId: "evt_42" },
    });
    await projection.project(event, [PUBLIC_CHANNEL], SETTINGS);
    expect(gateway.spectatorEvents).toHaveLength(1);
    expect(gateway.spectatorEvents[0]?.visibleContent).toBe("👍");
  });
});

describe("SpectatorProjection private_motive_summary gate", () => {
  const motiveEvent = () =>
    makeEvent({
      type: "private_motive_summary",
      payload: { summary: "counting the exits", intentType: "send_message", emotionDrivers: [], motivationDrivers: [], engineAuthored: false },
      visibility: { visibleToAgents: [], visibleToSpectators: false, visibleToOperators: true, visibilityReason: "operator_only" },
    });

  it("never reaches a plain spectator: buildSpectatorEvent is null and project sends nothing", async () => {
    const gateway = new MockDeliveryGateway();
    const projection = new SpectatorProjection(gateway);
    expect(projection.buildSpectatorEvent(motiveEvent(), SETTINGS)).toBeNull();
    await projection.project(motiveEvent(), [PUBLIC_CHANNEL], SETTINGS);
    expect(gateway.spectatorEvents).toHaveLength(0);
  });

  it("becomes a motive_reveal only under omniscientSpectatorMode", async () => {
    const gateway = new MockDeliveryGateway();
    const projection = new SpectatorProjection(gateway);
    const omni = { ...SETTINGS, omniscientSpectatorMode: true };
    const built = projection.buildSpectatorEvent(motiveEvent(), omni);
    expect(built?.type).toBe("motive_reveal");
    expect((built as { summary?: string } | null)?.summary).toBe("counting the exits");
    await projection.project(motiveEvent(), [PUBLIC_CHANNEL], omni);
    expect(gateway.spectatorEvents.map(e => e.type)).toEqual(["motive_reveal"]);
  });
});
