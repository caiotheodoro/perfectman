import { describe, it, expect, beforeEach } from "vitest";
import { OperatorProjection } from "../projections/operator-projection.js";
import { MockDeliveryGateway } from "../../delivery/mock-delivery-gateway.js";
import type { CommittedEvent, SimulationSettings } from "@perfectman/shared";

const SIM_ID = "sim_1";
const SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 20,
  llmCallBudgetPerMinute: 10,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 1_000_000,
};

function makeEvent(overrides: Partial<CommittedEvent> = {}): CommittedEvent {
  return {
    id: "evt_1",
    simulationId: SIM_ID,
    channelId: "ch_public",
    actorId: "agent_1",
    type: "message_sent",
    payload: {},
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" },
    createdAt: Date.now(),
    pulseIndex: 1,
    ...overrides,
  };
}

describe("OperatorProjection", () => {
  let gateway: MockDeliveryGateway;
  let projection: OperatorProjection;

  beforeEach(() => {
    gateway = new MockDeliveryGateway();
    projection = new OperatorProjection(gateway);
  });

  it("emits intent_blocked operator event", async () => {
    const event = makeEvent({
      type: "intent_blocked",
      payload: { intentType: "send_message", violations: [{ type: "rate_limited" }] },
    });
    await projection.project(event, SETTINGS);
    expect(gateway.operatorEvents).toHaveLength(1);
    expect(gateway.operatorEvents[0]!.type).toBe("intent_blocked");
  });

  it("emits intent_delayed operator event", async () => {
    const event = makeEvent({
      type: "intent_delayed",
      payload: { intentType: "send_message", delayUntilPulse: 5 },
    });
    await projection.project(event, SETTINGS);
    expect(gateway.operatorEvents).toHaveLength(1);
    expect(gateway.operatorEvents[0]!.type).toBe("intent_delayed");
  });

  it("emit() sends arbitrary operator events", async () => {
    const opEvent = {
      type: "pulse_metrics" as const,
      simulationId: SIM_ID,
      pulseIndex: 1,
      detail: "metrics",
      createdAt: Date.now(),
    };
    await projection.emit(opEvent);
    expect(gateway.operatorEvents).toHaveLength(1);
  });

  it("does not emit operator events for message_sent", async () => {
    const event = makeEvent({ type: "message_sent" });
    await projection.project(event, SETTINGS);
    expect(gateway.operatorEvents).toHaveLength(0);
  });
});
