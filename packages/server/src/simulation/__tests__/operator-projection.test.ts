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

  const GOAL_ID = "goal_1";

  const goalPayloads = [
    {
      type: "goal_proposed" as const,
      payload: {
        goalId: GOAL_ID,
        proposal: {
          id: GOAL_ID,
          agentId: "agent_1",
          title: "Befriend the baker",
          targetState: { id: "st_1", description: "baker waves first" },
          kind: "affiliation",
          origin: "crystallized_from",
          sourceEventIds: ["evt_1"],
          createdAt: 1000,
        },
        narrativeFraming: "A quiet campaign of small kindnesses.",
        confidence: 0.62,
        synthesizer: "deterministic",
      },
      detail: `Goal proposed: ${GOAL_ID}`,
      agentId: "agent_1",
    },
    {
      type: "goal_accepted" as const,
      payload: {
        goalId: GOAL_ID,
        goal: {
          id: GOAL_ID,
          agentId: "agent_1",
          title: "Befriend the baker",
          targetState: { id: "st_1", description: "baker waves first" },
          kind: "affiliation",
          status: "active",
          origin: "crystallized_from",
          sourceEventIds: ["evt_1"],
          createdAt: 1000,
        },
      },
      detail: `Goal accepted: ${GOAL_ID}`,
      agentId: "agent_1",
    },
    {
      type: "goal_declined" as const,
      payload: {
        goalId: GOAL_ID,
        proposal: {
          id: GOAL_ID,
          agentId: "agent_1",
          title: "Rule the market square",
          targetState: { id: "st_2", description: "merchants defer" },
          kind: "status_dominance",
          origin: "crystallized_from",
          sourceEventIds: ["evt_1"],
          createdAt: 1000,
        },
      },
      detail: `Goal declined: ${GOAL_ID}`,
      agentId: "agent_1",
    },
    {
      type: "world_verdict" as const,
      payload: {
        goalId: GOAL_ID,
        verdict: {
          goalId: GOAL_ID,
          objective: { distanceToTarget: 0.2, progressRate: 0.8, plateaued: false },
          consensus: "ratified",
          determination: "reached",
          confidence: 0.9,
        },
      },
      detail: "World verdict: reached",
      agentId: undefined,
    },
    {
      type: "delusion_gap_sampled" as const,
      payload: {
        goalId: GOAL_ID,
        agentId: "agent_1",
        at: 1500,
        magnitude: 0.4,
        divergenceFromLog: 0.1,
        divergenceFromWorld: 0.3,
      },
      detail: `Delusion gap sampled: ${GOAL_ID}`,
      agentId: undefined,
    },
    {
      type: "ending_offered" as const,
      payload: {
        goalId: GOAL_ID,
        offer: {
          goalId: GOAL_ID,
          reasons: ["the story holds"],
          epilogue: "The baker waves first.",
          status: "pending",
        },
      },
      detail: `Ending offered: ${GOAL_ID}`,
      agentId: undefined,
    },
  ] as const;

  it.each(goalPayloads)(
    "projects $type losslessly with detail and agent attribution",
    async ({ type, payload, detail, agentId }) => {
      const event = makeEvent({ type, payload: payload as CommittedEvent["payload"] });
      await projection.project(event, SETTINGS);
      expect(gateway.operatorEvents).toHaveLength(1);
      const op = gateway.operatorEvents[0]!;
      expect(op.type).toBe(type);
      expect(op.simulationId).toBe(SIM_ID);
      expect(op.pulseIndex).toBe(event.pulseIndex);
      expect(op.detail).toBe(detail);
      expect(op.data).toEqual(event.payload);
      expect(op.agentId).toBe(agentId);
    },
  );

  it("falls back to ? in the detail when the payload lacks the detail field", async () => {
    const event = makeEvent({ type: "world_verdict", payload: {} });
    await projection.project(event, SETTINGS);
    expect(gateway.operatorEvents).toHaveLength(1);
    expect(gateway.operatorEvents[0]!.detail).toBe("World verdict: ?");
    expect(gateway.operatorEvents[0]!.data).toEqual({});
  });

  it("falls back to ? in the detail when the verdict sub-object is missing", async () => {
    const event = makeEvent({ type: "world_verdict", payload: { goalId: GOAL_ID } });
    await projection.project(event, SETTINGS);
    expect(gateway.operatorEvents[0]!.detail).toBe("World verdict: ?");
  });
});
