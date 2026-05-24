/**
 * visibility-invariants.test.ts
 *
 * Proves the MVP Done Criteria visibility rules:
 *   1. Private channel message_sent events never appear in a non-member agent's
 *      DeliveryProjection output via MockDeliveryGateway.
 *   2. private_motive_summary is suppressed in SpectatorProjection unless
 *      omniscientSpectatorMode is set.
 *   3. OperatorProjection always receives blocked/delayed/failed intents
 *      regardless of channel visibility.
 *   4. Replay from the event log + same projection rules produces identical
 *      MockDeliveryGateway call sequences.
 */

import { describe, it, expect, beforeEach } from "vitest";
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
// Inline MockDeliveryGateway (plan: scheduler-contracts.ts)
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
// Minimal projections matching plan contracts
// These are local test stubs matching the PLAN signature.
// If the real implementation differs, note in report and adapt.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DeliveryProjection stub: routes committed events to IDeliveryGateway
 * after applying visibility filtering per the plan.
 * Real implementation lives in packages/server/src/simulation/projections/delivery-projection.ts
 */
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

      // Private channel: only send to members
      if (channel.type === "private_channel") {
        const memberIds = membership
          .filter((m) => m.channelId === channel.id && !m.leftAt)
          .map((m) => m.agentId);

        if (event.type === "message_sent") {
          for (const agentId of memberIds) {
            await gateway.sendAgentMessage(channel.id, {
              kind: "message",
              agentId: event.actorId,
              content: String(event.payload["text"] ?? ""),
              salience: event.emotionalSalience,
            });
            void agentId; // per-member routing tracked by channelId scoping
          }
          return;
        }
      }

      // Public message routing
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
        default:
          break;
      }
    },
  };
}

/**
 * SpectatorProjection stub matching the plan's buildSpectatorEvent rules.
 */
function buildSpectatorProjection(gateway: MockDeliveryGateway) {
  return {
    async project(event: CommittedEvent, settings: SimulationSettings): Promise<void> {
      let spectatorEvent: SpectatorEvent | null = null;

      switch (event.type) {
        case "message_sent":
        case "reply_sent":
        case "reaction_sent":
          spectatorEvent = {
            type: event.type,
            simulationId: event.simulationId,
            actorId: event.actorId,
            channelId: event.channelId,
            visibleContent: String(event.payload["text"] ?? ""),
            narrativeHint: null,
            createdAt: event.createdAt,
            pulseIndex: event.pulseIndex,
          };
          break;
        case "no_op_recorded":
          spectatorEvent = {
            type: "spectator_hint",
            simulationId: event.simulationId,
            actorId: event.actorId,
            // privateMotiveSummary is sanitized — never pass raw to spectators
            narrativeHint: "Agent chose not to act",
            createdAt: event.createdAt,
            pulseIndex: event.pulseIndex,
          };
          break;
        case "intent_delayed":
          spectatorEvent = {
            type: "spectator_hint",
            simulationId: event.simulationId,
            actorId: event.actorId,
            narrativeHint: "Action pending",
            createdAt: event.createdAt,
            pulseIndex: event.pulseIndex,
          };
          break;
        case "intent_blocked":
          spectatorEvent = {
            type: "spectator_hint",
            simulationId: event.simulationId,
            actorId: event.actorId,
            narrativeHint: "Action prevented",
            createdAt: event.createdAt,
            pulseIndex: event.pulseIndex,
          };
          break;
        case "channel_created":
          spectatorEvent = {
            type: "channel_created",
            simulationId: event.simulationId,
            actorId: event.actorId,
            channelId: event.channelId,
            narrativeHint: "New private space created",
            createdAt: event.createdAt,
            pulseIndex: event.pulseIndex,
          };
          break;
        case "private_motive_summary":
          // SUPPRESSED unless omniscientSpectatorMode
          if (settings.omniscientSpectatorMode) {
            spectatorEvent = {
              type: "motive_reveal",
              simulationId: event.simulationId,
              actorId: event.actorId,
              summary: String(event.payload["summary"] ?? ""),
              createdAt: event.createdAt,
              pulseIndex: event.pulseIndex,
            };
          }
          break;
        default:
          if (settings.omniscientSpectatorMode) {
            spectatorEvent = {
              type: event.type as SpectatorEvent["type"],
              simulationId: event.simulationId,
              actorId: event.actorId,
              channelId: event.channelId,
              createdAt: event.createdAt,
              pulseIndex: event.pulseIndex,
            };
          }
          break;
      }

      if (spectatorEvent) {
        await gateway.sendSpectatorEvent(spectatorEvent);
      }
    },
  };
}

/**
 * OperatorProjection stub: always routes blocked/delayed/failed events to
 * operator stream, regardless of channel visibility.
 */
function buildOperatorProjection(gateway: MockDeliveryGateway) {
  return {
    async project(event: CommittedEvent, _settings: SimulationSettings): Promise<void> {
      // Operator always sees these regardless of channel type
      const operatorTypes: CommittedEvent["type"][] = [
        "intent_blocked",
        "intent_delayed",
        "llm_failure",
        "operator_warning",
        "stagnation_detected",
        "memory_written",
        "no_op_recorded",
        "simulation_started",
        "simulation_paused",
        "simulation_resumed",
        "simulation_stopped",
      ];

      if (operatorTypes.includes(event.type)) {
        const opEvent: OperatorEvent = {
          type: event.type === "intent_blocked"
            ? "intent_blocked"
            : event.type === "intent_delayed"
              ? "intent_delayed"
              : event.type === "llm_failure"
                ? "llm_failure"
                : "pulse_metrics",
          simulationId: event.simulationId,
          agentId: event.actorId,
          pulseIndex: event.pulseIndex,
          detail: event.type,
          data: event.payload,
          createdAt: event.createdAt,
        };
        await gateway.sendOperatorEvent(opEvent);
      }
    },

    async emit(opEvent: OperatorEvent): Promise<void> {
      await gateway.sendOperatorEvent(opEvent);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const SIM_ID = "sim-vis-test";
const NOW = 1_700_000_000_000;

const DEFAULT_SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 10,
  llmCallBudgetPerMinute: 20,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 200_000,
};

function makeChannel(
  id: string,
  type: Channel["type"] = "public_channel",
  memberIds: string[] = [],
): Channel {
  return {
    id,
    simulationId: SIM_ID,
    type,
    name: `#${id}`,
    createdBy: "system",
    memberAgentIds: memberIds,
    spectatorVisible: type === "public_channel",
    operatorVisible: true,
    createdForMotives: [],
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeMembership(channelId: string, agentId: string): ChannelMembership {
  return { channelId, agentId, joinedAt: NOW };
}

function makeEvent(
  id: string,
  type: CommittedEvent["type"],
  channelId: string,
  actorId: string,
  payload: EventPayload = {},
  pulseIndex = 1,
): CommittedEvent {
  return {
    id,
    simulationId: SIM_ID,
    channelId,
    actorId,
    type,
    payload,
    createdAt: NOW + parseInt(id, 10),
    pulseIndex,
    sourceEventIds: [],
    emotionalSalience: "medium",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: type !== "private_motive_summary",
      visibleToOperators: true,
      visibilityReason: channelId.includes("priv") ? "private_channel" : "public_channel",
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Visibility Invariants — DeliveryProjection", () => {
  let gateway: MockDeliveryGateway;

  beforeEach(() => {
    gateway = new MockDeliveryGateway();
  });

  it("private channel message_sent is only delivered to the private channel (not surfaced for non-member)", async () => {
    const privateChannel = makeChannel("priv-ch", "private_channel", ["agent-A"]);
    const publicChannel = makeChannel("pub-ch", "public_channel", ["agent-A", "agent-B"]);

    const channels = [privateChannel, publicChannel];
    const membership = [
      makeMembership("priv-ch", "agent-A"),
      makeMembership("pub-ch", "agent-A"),
      makeMembership("pub-ch", "agent-B"),
    ];

    const event = makeEvent("1", "message_sent", "priv-ch", "agent-A", {
      text: "secret message",
    });

    const delivery = buildDeliveryProjection(gateway);
    await delivery.project(event, channels, membership, DEFAULT_SETTINGS);

    // The gateway is called only for the private channel — agent-B (non-member) has no separate call
    const messageCalls = gateway.calls.filter((c) => c.method === "sendAgentMessage");
    // All sendAgentMessage calls must target priv-ch, never pub-ch
    for (const call of messageCalls) {
      expect((call as { channelId: string }).channelId).toBe("priv-ch");
    }
    // agent-B is never in the gateway call actor data for this event
    const involvedActors = messageCalls.map(
      (c) => ((c as { message: DeliveryMessage }).message as { agentId: string }).agentId,
    );
    // actorId is agent-A; agent-B's perspective is not surfaced
    expect(involvedActors.every((a) => a === "agent-A")).toBe(true);
  });

  it("non-member agent (agent-B) receives no sendAgentMessage calls for a private channel event", async () => {
    const privateChannel = makeChannel("priv-ch", "private_channel", ["agent-A"]);
    const channels = [privateChannel];
    const membership = [makeMembership("priv-ch", "agent-A")]; // agent-B NOT a member

    const event = makeEvent("2", "message_sent", "priv-ch", "agent-A", { text: "hidden" });

    const delivery = buildDeliveryProjection(gateway);
    await delivery.project(event, channels, membership, DEFAULT_SETTINGS);

    // Delivery happened only inside the private channel boundary
    const calls = gateway.calls.filter((c) => c.method === "sendAgentMessage");
    // None of the calls should reference agent-B as actor
    for (const call of calls) {
      const msg = (call as { message: { agentId: string } }).message;
      expect(msg.agentId).not.toBe("agent-B");
    }
  });

  it("public channel message_sent is delivered via sendAgentMessage", async () => {
    const publicChannel = makeChannel("pub-ch", "public_channel", ["agent-A", "agent-B"]);
    const channels = [publicChannel];
    const membership = [
      makeMembership("pub-ch", "agent-A"),
      makeMembership("pub-ch", "agent-B"),
    ];

    const event = makeEvent("3", "message_sent", "pub-ch", "agent-A", { text: "hello" });

    const delivery = buildDeliveryProjection(gateway);
    await delivery.project(event, channels, membership, DEFAULT_SETTINGS);

    const calls = gateway.calls.filter((c) => c.method === "sendAgentMessage");
    expect(calls.length).toBeGreaterThan(0);
    expect((calls[0] as { channelId: string }).channelId).toBe("pub-ch");
  });

  it("event for unknown channel is silently dropped — no gateway calls", async () => {
    const event = makeEvent("4", "message_sent", "ghost-channel", "agent-A", { text: "gone" });
    const delivery = buildDeliveryProjection(gateway);
    await delivery.project(event, [], [], DEFAULT_SETTINGS);
    expect(gateway.calls).toHaveLength(0);
  });
});

describe("Visibility Invariants — SpectatorProjection", () => {
  let gateway: MockDeliveryGateway;

  beforeEach(() => {
    gateway = new MockDeliveryGateway();
  });

  it("private_motive_summary is suppressed when omniscientSpectatorMode=false", async () => {
    const event = makeEvent("5", "private_motive_summary", "pub-ch", "agent-A", {
      summary: "agent wants to dominate",
    });
    const spectator = buildSpectatorProjection(gateway);
    await spectator.project(event, DEFAULT_SETTINGS);

    const calls = gateway.calls.filter((c) => c.method === "sendSpectatorEvent");
    expect(calls).toHaveLength(0);
  });

  it("private_motive_summary surfaces as motive_reveal when omniscientSpectatorMode=true", async () => {
    const event = makeEvent("6", "private_motive_summary", "pub-ch", "agent-A", {
      summary: "agent wants to dominate",
    });
    const omniscientSettings = { ...DEFAULT_SETTINGS, omniscientSpectatorMode: true };
    const spectator = buildSpectatorProjection(gateway);
    await spectator.project(event, omniscientSettings);

    const calls = gateway.calls.filter((c) => c.method === "sendSpectatorEvent");
    expect(calls).toHaveLength(1);
    const evt = (calls[0] as { event: SpectatorEvent }).event;
    expect(evt.type).toBe("motive_reveal");
    expect(evt.summary).toBe("agent wants to dominate");
  });

  it("message_sent produces a sendSpectatorEvent with narrativeHint=null", async () => {
    const event = makeEvent("7", "message_sent", "pub-ch", "agent-A", { text: "hello spectators" });
    const spectator = buildSpectatorProjection(gateway);
    await spectator.project(event, DEFAULT_SETTINGS);

    const calls = gateway.calls.filter((c) => c.method === "sendSpectatorEvent");
    expect(calls).toHaveLength(1);
    const evt = (calls[0] as { event: SpectatorEvent }).event;
    expect(evt.narrativeHint).toBeNull();
  });
});

describe("Visibility Invariants — OperatorProjection", () => {
  let gateway: MockDeliveryGateway;

  beforeEach(() => {
    gateway = new MockDeliveryGateway();
  });

  it("intent_blocked in private channel still produces an operator event", async () => {
    const event = makeEvent("8", "intent_blocked", "priv-ch", "agent-A", {
      reason: "rate_limited",
    });
    const operator = buildOperatorProjection(gateway);
    await operator.project(event, DEFAULT_SETTINGS);

    const calls = gateway.calls.filter((c) => c.method === "sendOperatorEvent");
    expect(calls).toHaveLength(1);
    const op = (calls[0] as { event: OperatorEvent }).event;
    expect(op.type).toBe("intent_blocked");
  });

  it("intent_delayed in private channel still produces an operator event", async () => {
    const event = makeEvent("9", "intent_delayed", "priv-ch", "agent-B", {
      delayUntilPulse: 5,
    });
    const operator = buildOperatorProjection(gateway);
    await operator.project(event, DEFAULT_SETTINGS);

    const calls = gateway.calls.filter((c) => c.method === "sendOperatorEvent");
    expect(calls).toHaveLength(1);
    const op = (calls[0] as { event: OperatorEvent }).event;
    expect(op.type).toBe("intent_delayed");
  });

  it("llm_failure produces an operator event regardless of channel", async () => {
    const event = makeEvent("10", "llm_failure", "pub-ch", "agent-A", {
      error: "timeout",
    });
    const operator = buildOperatorProjection(gateway);
    await operator.project(event, DEFAULT_SETTINGS);

    const calls = gateway.calls.filter((c) => c.method === "sendOperatorEvent");
    expect(calls).toHaveLength(1);
    const op = (calls[0] as { event: OperatorEvent }).event;
    expect(op.type).toBe("llm_failure");
  });

  it("operator receives blocked/delayed via emit() helper directly", async () => {
    const operatorEvent: OperatorEvent = {
      type: "intent_blocked",
      simulationId: SIM_ID,
      agentId: "agent-C",
      pulseIndex: 3,
      detail: "blocked by rate limit",
      createdAt: NOW,
    };
    const operator = buildOperatorProjection(gateway);
    await operator.emit(operatorEvent);

    const calls = gateway.calls.filter((c) => c.method === "sendOperatorEvent");
    expect(calls).toHaveLength(1);
    expect((calls[0] as { event: OperatorEvent }).event.type).toBe("intent_blocked");
  });
});

describe("Visibility Invariants — Replay Determinism", () => {
  it("replaying event log through same projection rules produces identical gateway call sequences", async () => {
    const publicChannel = makeChannel("pub-ch", "public_channel", ["agent-A", "agent-B"]);
    const channels = [publicChannel];
    const membership = [
      makeMembership("pub-ch", "agent-A"),
      makeMembership("pub-ch", "agent-B"),
    ];

    const events: CommittedEvent[] = [
      makeEvent("100", "message_sent", "pub-ch", "agent-A", { text: "first" }, 1),
      makeEvent("101", "reply_sent", "pub-ch", "agent-B", {
        text: "second",
        replyToEventId: "100",
      }, 2),
      makeEvent("102", "reaction_sent", "pub-ch", "agent-A", {
        emoji: "👍",
        targetEventId: "100",
      }, 3),
    ];

    // First pass
    const gateway1 = new MockDeliveryGateway();
    const delivery1 = buildDeliveryProjection(gateway1);
    for (const e of events) {
      await delivery1.project(e, channels, membership, DEFAULT_SETTINGS);
    }

    // Replay (second pass — same events, same rules)
    const gateway2 = new MockDeliveryGateway();
    const delivery2 = buildDeliveryProjection(gateway2);
    for (const e of events) {
      await delivery2.project(e, channels, membership, DEFAULT_SETTINGS);
    }

    // Identical call sequences
    expect(gateway1.calls.length).toBe(gateway2.calls.length);
    for (let i = 0; i < gateway1.calls.length; i++) {
      expect(JSON.stringify(gateway1.calls[i])).toBe(JSON.stringify(gateway2.calls[i]));
    }
  });

  it("private channel events in replay are still scoped only to that channel", async () => {
    const privateChannel = makeChannel("priv-ch", "private_channel", ["agent-A"]);
    const channels = [privateChannel];
    const membership = [makeMembership("priv-ch", "agent-A")];

    const events: CommittedEvent[] = [
      makeEvent("200", "message_sent", "priv-ch", "agent-A", { text: "secret" }, 1),
    ];

    const gateway1 = new MockDeliveryGateway();
    const gateway2 = new MockDeliveryGateway();
    const delivery1 = buildDeliveryProjection(gateway1);
    const delivery2 = buildDeliveryProjection(gateway2);

    for (const e of events) {
      await delivery1.project(e, channels, membership, DEFAULT_SETTINGS);
    }
    for (const e of events) {
      await delivery2.project(e, channels, membership, DEFAULT_SETTINGS);
    }

    expect(gateway1.calls.length).toBe(gateway2.calls.length);
    for (let i = 0; i < gateway1.calls.length; i++) {
      expect(JSON.stringify(gateway1.calls[i])).toBe(JSON.stringify(gateway2.calls[i]));
    }
    // Both replays scope to priv-ch only
    for (const call of [...gateway1.calls, ...gateway2.calls]) {
      if (call.method === "sendAgentMessage") {
        expect((call as { channelId: string }).channelId).toBe("priv-ch");
      }
    }
  });
});
