import { describe, it, expect, beforeEach } from "vitest";
import { SpectatorProjection } from "../projections/spectator-projection.js";
import { MockDeliveryGateway } from "./mock-delivery-gateway.js";
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
});
