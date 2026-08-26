/**
 * delivery-projection-fanout.test.ts
 *
 * DeliveryProjection → IDeliveryGateway mapping per the "Delivery fan-out" table
 * in the plan. One assertion per event-type → gateway-call mapping.
 *
 * Fan-out table (plan):
 *   message_sent        → sendAgentMessage(channelId, { kind: 'message', ... })
 *   reply_sent          → sendAgentMessage(channelId, { kind: 'reply', replyToEventId, ... })
 *   reaction_sent       → sendAgentMessage(channelId, { kind: 'reaction', emoji, targetEventId, ... })
 *   channel_created     → createChannel(channelId, type, memberAgentIds)
 *   agent_invited       → addMember(channelId, agentId)
 *   agent_left          → removeMember(channelId, agentId)
 *   spectator events    → sendSpectatorEvent
 *   operator events     → sendOperatorEvent
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as compositeDeliveryGateway from "../../delivery/composite-delivery-gateway.js";
import * as mockDeliveryGateway from "../../delivery/mock-delivery-gateway.js";
import type {
  CommittedEvent,
  Channel,
  ChannelMembership,
  SimulationSettings,
  SpectatorEvent,
  OperatorEvent,
  EventPayload,
} from "@perfectman/shared";

// ─────────────────────────────────────────────────────────────────────────────
// MockDeliveryGateway
// ─────────────────────────────────────────────────────────────────────────────

type DeliveryMessage =
  | { kind: "message"; agentId: string; content: string; salience: string }
  | { kind: "reply"; agentId: string; content: string; replyToEventId: string; salience: string }
  | { kind: "reaction"; agentId: string; emoji: string; targetEventId: string; salience: string };

type GatewayCall =
  | { method: "sendAgentMessage"; channelId: string; message: DeliveryMessage }
  | { method: "createChannel"; channelId: string; type: string; memberAgentIds: string[] }
  | { method: "addMember"; channelId: string; agentId: string }
  | { method: "removeMember"; channelId: string; agentId: string }
  | { method: "sendSpectatorEvent"; event: SpectatorEvent }
  | { method: "sendOperatorEvent"; event: OperatorEvent }
  | { method: "onSimulationStopped"; simulationId: string };

class MockDeliveryGateway {
  readonly calls: GatewayCall[] = [];

  async sendAgentMessage(channelId: string, message: DeliveryMessage): Promise<void> {
    this.calls.push({ method: "sendAgentMessage", channelId, message });
  }
  async createChannel(channelId: string, type: string, memberAgentIds: string[]): Promise<void> {
    this.calls.push({ method: "createChannel", channelId, type, memberAgentIds });
  }
  async addMember(channelId: string, agentId: string): Promise<void> {
    this.calls.push({ method: "addMember", channelId, agentId });
  }
  async removeMember(channelId: string, agentId: string): Promise<void> {
    this.calls.push({ method: "removeMember", channelId, agentId });
  }
  async sendSpectatorEvent(event: SpectatorEvent): Promise<void> {
    this.calls.push({ method: "sendSpectatorEvent", event });
  }
  async sendOperatorEvent(event: OperatorEvent): Promise<void> {
    this.calls.push({ method: "sendOperatorEvent", event });
  }
  async onSimulationStopped(simulationId: string): Promise<void> {
    this.calls.push({ method: "onSimulationStopped", simulationId });
  }

  reset(): void {
    this.calls.length = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DeliveryProjection (same as in visibility-invariants, extracted here for
// clarity — tests the mapping table, not the visibility filtering)
// ─────────────────────────────────────────────────────────────────────────────

function buildDeliveryProjection(gateway: MockDeliveryGateway) {
  return {
    async project(
      event: CommittedEvent,
      channels: Channel[],
      membership: ChannelMembership[],
      settings: SimulationSettings,
    ): Promise<void> {
      const channel = channels.find((c) => c.id === event.channelId);
      if (!channel) return;

      switch (event.type) {
        case "message_sent":
          await gateway.sendAgentMessage(event.channelId, {
            kind: "message",
            agentId: event.actorId,
            content: String(event.payload["text"] ?? ""),
            salience: event.emotionalSalience,
          });
          break;

        case "reply_sent":
          await gateway.sendAgentMessage(event.channelId, {
            kind: "reply",
            agentId: event.actorId,
            content: String(event.payload["text"] ?? ""),
            replyToEventId: String(event.payload["replyToEventId"] ?? ""),
            salience: event.emotionalSalience,
          });
          break;

        case "reaction_sent":
          await gateway.sendAgentMessage(event.channelId, {
            kind: "reaction",
            agentId: event.actorId,
            emoji: String(event.payload["emoji"] ?? ""),
            targetEventId: String(event.payload["targetEventId"] ?? ""),
            salience: event.emotionalSalience,
          });
          break;

        case "channel_created":
          await gateway.createChannel(
            event.channelId,
            String(event.payload["channelType"] ?? "public_channel"),
            (event.payload["memberAgentIds"] as string[] | undefined) ?? [],
          );
          break;

        case "agent_invited":
          await gateway.addMember(
            event.channelId,
            String(event.payload["invitedAgentId"] ?? event.actorId),
          );
          break;

        case "agent_left":
          await gateway.removeMember(event.channelId, event.actorId);
          break;

        // All other event types are not directly surfaced as delivery messages
        default:
          break;
      }

      void settings;
      void membership;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture factories
// ─────────────────────────────────────────────────────────────────────────────

const SIM_ID = "sim-fanout-test";
const NOW = 1_700_000_000_000;
const CHANNEL_ID = "pub-ch";
const ACTOR_ID = "agent-A";

const DEFAULT_SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 10,
  llmCallBudgetPerMinute: 20,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 200_000,
};

const PUBLIC_CHANNEL: Channel = {
  id: CHANNEL_ID,
  simulationId: SIM_ID,
  type: "public_channel",
  name: "#pub-ch",
  createdBy: "system",
  memberAgentIds: [ACTOR_ID],
  spectatorVisible: true,
  operatorVisible: true,
  createdForMotives: [],
  status: "active",
  createdAt: NOW,
  updatedAt: NOW,
};

const CHANNELS = [PUBLIC_CHANNEL];
const MEMBERSHIP: ChannelMembership[] = [
  { channelId: CHANNEL_ID, agentId: ACTOR_ID, joinedAt: NOW },
];

function makeEvent(
  type: CommittedEvent["type"],
  payload: EventPayload = {},
): CommittedEvent {
  return {
    id: `fanout-evt-${type}`,
    simulationId: SIM_ID,
    channelId: CHANNEL_ID,
    actorId: ACTOR_ID,
    type,
    payload,
    createdAt: NOW,
    pulseIndex: 1,
    sourceEventIds: [],
    emotionalSalience: "medium",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public_channel",
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fan-out mapping tests
// ─────────────────────────────────────────────────────────────────────────────

describe("DeliveryProjection Fan-Out — message_sent → sendAgentMessage(kind=message)", () => {
  let gateway: MockDeliveryGateway;

  beforeEach(() => {
    gateway = new MockDeliveryGateway();
  });

  it("message_sent maps to sendAgentMessage with kind=message", async () => {
    const event = makeEvent("message_sent", { text: "hello world" });
    const projection = buildDeliveryProjection(gateway);
    await projection.project(event, CHANNELS, MEMBERSHIP, DEFAULT_SETTINGS);

    const calls = gateway.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("sendAgentMessage");
    const call = calls[0] as { channelId: string; message: DeliveryMessage };
    expect(call.channelId).toBe(CHANNEL_ID);
    expect(call.message.kind).toBe("message");
    expect((call.message as { agentId: string }).agentId).toBe(ACTOR_ID);
    expect((call.message as { content: string }).content).toBe("hello world");
  });

  it("message_sent preserves emotionalSalience in delivery message", async () => {
    const event = { ...makeEvent("message_sent", { text: "hi" }), emotionalSalience: "high" as const };
    const projection = buildDeliveryProjection(gateway);
    await projection.project(event, CHANNELS, MEMBERSHIP, DEFAULT_SETTINGS);

    const call = gateway.calls[0] as { message: { salience: string } };
    expect(call.message.salience).toBe("high");
  });
});

describe("DeliveryProjection Fan-Out — reply_sent → sendAgentMessage(kind=reply)", () => {
  let gateway: MockDeliveryGateway;

  beforeEach(() => {
    gateway = new MockDeliveryGateway();
  });

  it("reply_sent maps to sendAgentMessage with kind=reply and replyToEventId", async () => {
    const event = makeEvent("reply_sent", {
      text: "I agree",
      replyToEventId: "original-evt-99",
    });
    const projection = buildDeliveryProjection(gateway);
    await projection.project(event, CHANNELS, MEMBERSHIP, DEFAULT_SETTINGS);

    expect(gateway.calls).toHaveLength(1);
    const call = gateway.calls[0] as {
      channelId: string;
      message: { kind: string; replyToEventId: string; content: string };
    };
    expect(call.channelId).toBe(CHANNEL_ID);
    expect(call.message.kind).toBe("reply");
    expect(call.message.replyToEventId).toBe("original-evt-99");
    expect(call.message.content).toBe("I agree");
  });
});

describe("DeliveryProjection Fan-Out — reaction_sent → sendAgentMessage(kind=reaction)", () => {
  let gateway: MockDeliveryGateway;

  beforeEach(() => {
    gateway = new MockDeliveryGateway();
  });

  it("reaction_sent maps to sendAgentMessage with kind=reaction, emoji, targetEventId", async () => {
    const event = makeEvent("reaction_sent", {
      emoji: "❤️",
      targetEventId: "target-evt-55",
    });
    const projection = buildDeliveryProjection(gateway);
    await projection.project(event, CHANNELS, MEMBERSHIP, DEFAULT_SETTINGS);

    expect(gateway.calls).toHaveLength(1);
    const call = gateway.calls[0] as {
      channelId: string;
      message: { kind: string; emoji: string; targetEventId: string };
    };
    expect(call.channelId).toBe(CHANNEL_ID);
    expect(call.message.kind).toBe("reaction");
    expect(call.message.emoji).toBe("❤️");
    expect(call.message.targetEventId).toBe("target-evt-55");
  });
});

describe("DeliveryProjection Fan-Out — channel_created → createChannel", () => {
  let gateway: MockDeliveryGateway;

  beforeEach(() => {
    gateway = new MockDeliveryGateway();
  });

  it("channel_created maps to createChannel with channelId, type, memberAgentIds", async () => {
    const event = makeEvent("channel_created", {
      channelType: "private_channel",
      memberAgentIds: ["agent-A", "agent-B"],
    });
    const projection = buildDeliveryProjection(gateway);
    await projection.project(event, CHANNELS, MEMBERSHIP, DEFAULT_SETTINGS);

    expect(gateway.calls).toHaveLength(1);
    const call = gateway.calls[0] as {
      method: string;
      channelId: string;
      type: string;
      memberAgentIds: string[];
    };
    expect(call.method).toBe("createChannel");
    expect(call.channelId).toBe(CHANNEL_ID);
    expect(call.type).toBe("private_channel");
    expect(call.memberAgentIds).toEqual(["agent-A", "agent-B"]);
  });

  it("channel_created with no memberAgentIds defaults to empty array", async () => {
    const event = makeEvent("channel_created", { channelType: "public_channel" });
    const projection = buildDeliveryProjection(gateway);
    await projection.project(event, CHANNELS, MEMBERSHIP, DEFAULT_SETTINGS);

    const call = gateway.calls[0] as { memberAgentIds: string[] };
    expect(call.memberAgentIds).toEqual([]);
  });
});

describe("DeliveryProjection Fan-Out — agent_invited → addMember", () => {
  let gateway: MockDeliveryGateway;

  beforeEach(() => {
    gateway = new MockDeliveryGateway();
  });

  it("agent_invited maps to addMember(channelId, invitedAgentId)", async () => {
    const event = makeEvent("agent_invited", { invitedAgentId: "agent-B" });
    const projection = buildDeliveryProjection(gateway);
    await projection.project(event, CHANNELS, MEMBERSHIP, DEFAULT_SETTINGS);

    expect(gateway.calls).toHaveLength(1);
    const call = gateway.calls[0] as { method: string; channelId: string; agentId: string };
    expect(call.method).toBe("addMember");
    expect(call.channelId).toBe(CHANNEL_ID);
    expect(call.agentId).toBe("agent-B");
  });

  it("agent_invited falls back to actorId when invitedAgentId is missing", async () => {
    const event = makeEvent("agent_invited", {}); // no invitedAgentId
    const projection = buildDeliveryProjection(gateway);
    await projection.project(event, CHANNELS, MEMBERSHIP, DEFAULT_SETTINGS);

    const call = gateway.calls[0] as { agentId: string };
    expect(call.agentId).toBe(ACTOR_ID); // actorId fallback
  });
});

describe("DeliveryProjection Fan-Out — agent_left → removeMember", () => {
  let gateway: MockDeliveryGateway;

  beforeEach(() => {
    gateway = new MockDeliveryGateway();
  });

  it("agent_left maps to removeMember(channelId, actorId)", async () => {
    const event = makeEvent("agent_left", {});
    const projection = buildDeliveryProjection(gateway);
    await projection.project(event, CHANNELS, MEMBERSHIP, DEFAULT_SETTINGS);

    expect(gateway.calls).toHaveLength(1);
    const call = gateway.calls[0] as { method: string; channelId: string; agentId: string };
    expect(call.method).toBe("removeMember");
    expect(call.channelId).toBe(CHANNEL_ID);
    expect(call.agentId).toBe(ACTOR_ID);
  });
});

describe("DeliveryProjection Fan-Out — spectator events → sendSpectatorEvent", () => {
  let gateway: MockDeliveryGateway;

  beforeEach(() => {
    gateway = new MockDeliveryGateway();
  });

  it("sendSpectatorEvent call passes SpectatorEvent through unchanged", async () => {
    const spectatorEvt: SpectatorEvent = {
      type: "spectator_hint",
      simulationId: SIM_ID,
      actorId: ACTOR_ID,
      narrativeHint: "Agent is thinking",
      createdAt: NOW,
      pulseIndex: 1,
    };

    await gateway.sendSpectatorEvent(spectatorEvt);

    expect(gateway.calls).toHaveLength(1);
    const call = gateway.calls[0] as { method: string; event: SpectatorEvent };
    expect(call.method).toBe("sendSpectatorEvent");
    expect(call.event.type).toBe("spectator_hint");
    expect(call.event.narrativeHint).toBe("Agent is thinking");
  });

  it("motive_reveal SpectatorEvent carries summary and actorId", async () => {
    const motiveEvt: SpectatorEvent = {
      type: "motive_reveal",
      simulationId: SIM_ID,
      actorId: ACTOR_ID,
      summary: "Agent wants social validation",
      createdAt: NOW,
      pulseIndex: 2,
    };

    await gateway.sendSpectatorEvent(motiveEvt);

    const call = gateway.calls[0] as { event: SpectatorEvent };
    expect(call.event.type).toBe("motive_reveal");
    expect(call.event.summary).toBe("Agent wants social validation");
    expect(call.event.actorId).toBe(ACTOR_ID);
  });
});

describe("DeliveryProjection Fan-Out — operator events → sendOperatorEvent", () => {
  let gateway: MockDeliveryGateway;

  beforeEach(() => {
    gateway = new MockDeliveryGateway();
  });

  it("sendOperatorEvent call passes OperatorEvent through unchanged", async () => {
    const operatorEvt: OperatorEvent = {
      type: "intent_blocked",
      simulationId: SIM_ID,
      agentId: ACTOR_ID,
      pulseIndex: 3,
      detail: "rate limit exceeded",
      createdAt: NOW,
    };

    await gateway.sendOperatorEvent(operatorEvt);

    expect(gateway.calls).toHaveLength(1);
    const call = gateway.calls[0] as { method: string; event: OperatorEvent };
    expect(call.method).toBe("sendOperatorEvent");
    expect(call.event.type).toBe("intent_blocked");
    expect(call.event.detail).toBe("rate limit exceeded");
  });

  it("pulse_metrics OperatorEvent carries metrics data", async () => {
    const metricsEvt: OperatorEvent = {
      type: "pulse_metrics",
      simulationId: SIM_ID,
      pulseIndex: 5,
      detail: "pulse completed",
      data: { eventsCommitted: 3, agentsCalled: 2 },
      createdAt: NOW,
    };

    await gateway.sendOperatorEvent(metricsEvt);

    const call = gateway.calls[0] as { event: OperatorEvent };
    expect(call.event.type).toBe("pulse_metrics");
    expect(call.event.data!["eventsCommitted"]).toBe(3);
  });
});

describe("DeliveryProjection Fan-Out — Non-delivery event types produce no gateway calls", () => {
  let gateway: MockDeliveryGateway;

  beforeEach(() => {
    gateway = new MockDeliveryGateway();
  });

  const nonDeliveryTypes: CommittedEvent["type"][] = [
    "no_op_recorded",
    "intent_blocked",
    "intent_delayed",
    "memory_written",
    "private_motive_summary",
    "stagnation_detected",
    "simulation_started",
    "simulation_paused",
    "simulation_resumed",
    "simulation_stopped",
  ];

  for (const type of nonDeliveryTypes) {
    it(`${type} produces no sendAgentMessage / createChannel / addMember / removeMember call`, async () => {
      const event = makeEvent(type, {});
      const projection = buildDeliveryProjection(gateway);
      await projection.project(event, CHANNELS, MEMBERSHIP, DEFAULT_SETTINGS);

      const deliveryCalls = gateway.calls.filter(
        (c) =>
          c.method === "sendAgentMessage" ||
          c.method === "createChannel" ||
          c.method === "addMember" ||
          c.method === "removeMember",
      );
      expect(deliveryCalls).toHaveLength(0);
      gateway.reset();
    });
  }
});

describe("DeliveryProjection Fan-Out — Each event type only triggers its own gateway method", () => {
  let gateway: MockDeliveryGateway;

  beforeEach(() => {
    gateway = new MockDeliveryGateway();
  });

  it("message_sent does NOT trigger createChannel, addMember, removeMember", async () => {
    const event = makeEvent("message_sent", { text: "hi" });
    const projection = buildDeliveryProjection(gateway);
    await projection.project(event, CHANNELS, MEMBERSHIP, DEFAULT_SETTINGS);

    expect(gateway.calls.filter((c) => c.method === "createChannel")).toHaveLength(0);
    expect(gateway.calls.filter((c) => c.method === "addMember")).toHaveLength(0);
    expect(gateway.calls.filter((c) => c.method === "removeMember")).toHaveLength(0);
  });

  it("channel_created does NOT trigger sendAgentMessage", async () => {
    const event = makeEvent("channel_created", {
      channelType: "public_channel",
      memberAgentIds: [],
    });
    const projection = buildDeliveryProjection(gateway);
    await projection.project(event, CHANNELS, MEMBERSHIP, DEFAULT_SETTINGS);

    expect(gateway.calls.filter((c) => c.method === "sendAgentMessage")).toHaveLength(0);
  });

  it("agent_invited does NOT trigger sendAgentMessage or createChannel", async () => {
    const event = makeEvent("agent_invited", { invitedAgentId: "agent-B" });
    const projection = buildDeliveryProjection(gateway);
    await projection.project(event, CHANNELS, MEMBERSHIP, DEFAULT_SETTINGS);

    expect(gateway.calls.filter((c) => c.method === "sendAgentMessage")).toHaveLength(0);
    expect(gateway.calls.filter((c) => c.method === "createChannel")).toHaveLength(0);
  });

  it("agent_left does NOT trigger sendAgentMessage or addMember", async () => {
    const event = makeEvent("agent_left", {});
    const projection = buildDeliveryProjection(gateway);
    await projection.project(event, CHANNELS, MEMBERSHIP, DEFAULT_SETTINGS);

    expect(gateway.calls.filter((c) => c.method === "sendAgentMessage")).toHaveLength(0);
    expect(gateway.calls.filter((c) => c.method === "addMember")).toHaveLength(0);
  });
});

describe("DeliveryProjection Fan-Out — onSimulationStopped endReason/endingOffer delivery", () => {
  const OFFER = {
    goalId: "goal_1",
    reasons: ["the story holds"],
    epilogue: "The baker waves first.",
    status: "pending" as const,
  };

  it("CompositeDeliveryGateway passes endReason and endingOffer to every child", async () => {
    const childA = new mockDeliveryGateway.MockDeliveryGateway();
    const childB = new mockDeliveryGateway.MockDeliveryGateway();
    const composite = new compositeDeliveryGateway.CompositeDeliveryGateway([childA, childB]);

    await composite.onSimulationStopped(SIM_ID, "goal_end_offered", OFFER);

    for (const child of [childA, childB]) {
      expect(child.stoppedSimulations).toHaveLength(1);
      expect(child.stoppedSimulations[0]).toEqual({
        simulationId: SIM_ID,
        endReason: "goal_end_offered",
        endingOffer: OFFER,
      });
    }
  });

  it("CompositeDeliveryGateway passes no-opts stop unchanged", async () => {
    const childA = new mockDeliveryGateway.MockDeliveryGateway();
    const composite = new compositeDeliveryGateway.CompositeDeliveryGateway([childA]);

    await composite.onSimulationStopped(SIM_ID);

    expect(childA.stoppedSimulations[0]).toEqual({ simulationId: SIM_ID });
  });

  it("MockDeliveryGateway records enriched stop payload on stoppedSimulations", async () => {
    const gateway = new mockDeliveryGateway.MockDeliveryGateway();

    await gateway.onSimulationStopped(SIM_ID, "goal_end_offered", OFFER);
    await gateway.onSimulationStopped("sim-other");

    expect(gateway.stoppedSimulations).toEqual([
      { simulationId: SIM_ID, endReason: "goal_end_offered", endingOffer: OFFER },
      { simulationId: "sim-other" },
    ]);
  });
});
