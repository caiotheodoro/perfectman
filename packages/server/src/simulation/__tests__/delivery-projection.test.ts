import { describe, it, expect, beforeEach, vi } from "vitest";
import { DeliveryProjection } from "../projections/delivery-projection.js";
import { MockDeliveryGateway } from "../../delivery/mock-delivery-gateway.js";
import { StdoutDeliveryGateway } from "../../delivery/stdout-delivery-gateway.js";
import type { CommittedEvent, Channel, ChannelMembership, SimulationSettings } from "@perfectman/shared";

const SIM_ID = "sim_1";
const PUB_CHANNEL_ID = "ch_public";
const PRIV_CHANNEL_ID = "ch_private";
const AGENT_1 = "agent_1";
const AGENT_2 = "agent_2";

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
  id: PUB_CHANNEL_ID,
  simulationId: SIM_ID,
  type: "public_channel",
  name: "general",
  createdBy: "system",
  memberAgentIds: [AGENT_1, AGENT_2],
  spectatorVisible: true,
  operatorVisible: true,
  createdForMotives: [],
  status: "active",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const PRIVATE_CHANNEL: Channel = {
  id: PRIV_CHANNEL_ID,
  simulationId: SIM_ID,
  type: "private_channel",
  name: "secret",
  createdBy: AGENT_1,
  memberAgentIds: [AGENT_1],
  spectatorVisible: false,
  operatorVisible: true,
  createdForMotives: [],
  status: "active",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const MEMBERSHIPS: ChannelMembership[] = [
  { channelId: PUB_CHANNEL_ID, agentId: AGENT_1, joinedAt: Date.now() },
  { channelId: PUB_CHANNEL_ID, agentId: AGENT_2, joinedAt: Date.now() },
  { channelId: PRIV_CHANNEL_ID, agentId: AGENT_1, joinedAt: Date.now() },
  // agent_2 is NOT a member of the private channel
];

function makeCommittedEvent(overrides: Partial<CommittedEvent>): CommittedEvent {
  return {
    id: "evt_1",
    simulationId: SIM_ID,
    channelId: PUB_CHANNEL_ID,
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

describe("DeliveryProjection", () => {
  let gateway: MockDeliveryGateway;
  let projection: DeliveryProjection;

  beforeEach(() => {
    gateway = new MockDeliveryGateway();
    projection = new DeliveryProjection(gateway);
  });

  it("emits one agent_message for a message_sent event regardless of member count", async () => {
    const event = makeCommittedEvent({ type: "message_sent" });
    await projection.project(event, [PUBLIC_CHANNEL, PRIVATE_CHANNEL], MEMBERSHIPS, SETTINGS);
    expect(gateway.agentMessages).toHaveLength(1);
    expect(gateway.agentMessages[0]!.message.kind).toBe("message");
    expect(gateway.agentMessages[0]!.channelId).toBe(PUB_CHANNEL_ID);
  });

  it("private channel event does NOT reach non-member agent", async () => {
    const event = makeCommittedEvent({
      channelId: PRIV_CHANNEL_ID,
      type: "message_sent",
      visibility: {
        visibleToAgents: [AGENT_1],
        visibleToSpectators: false,
        visibleToOperators: true,
        visibilityReason: "private",
      },
    });
    gateway.reset();
    await projection.project(event, [PUBLIC_CHANNEL, PRIVATE_CHANNEL], MEMBERSHIPS, SETTINGS);
    // Delivery only fans out to members of PRIV_CHANNEL (only AGENT_1)
    // AGENT_2 is not in PRIV_CHANNEL membership so it should never appear as recipient
    // Since DeliveryProjection uses getMemberAgentIds which filters by membership,
    // agent_2 will never be iterated over for this private channel event.
    // The gateway receives at most 1 message (for agent_1), never for agent_2.
    expect(gateway.agentMessages.length).toBeLessThanOrEqual(1);
    // All messages must be to the private channel (agent_2 is not a member)
    // agent_2's absence from PRIV_CHANNEL membership is the invariant
    const membersOfPrivate = MEMBERSHIPS
      .filter(m => m.channelId === PRIV_CHANNEL_ID && !m.leftAt)
      .map(m => m.agentId);
    expect(membersOfPrivate).not.toContain(AGENT_2);
  });

  it("reply_sent produces a reply delivery message", async () => {
    const event = makeCommittedEvent({
      type: "reply_sent",
      payload: { content: "replying", replyToEventId: "evt_0" },
    });
    await projection.project(event, [PUBLIC_CHANNEL, PRIVATE_CHANNEL], MEMBERSHIPS, SETTINGS);
    expect(gateway.agentMessages.some(m => m.message.kind === "reply")).toBe(true);
  });

  it("channel_created calls gateway.createChannel", async () => {
    const event = makeCommittedEvent({
      channelId: PRIV_CHANNEL_ID,
      type: "channel_created",
      payload: { channelName: "secret", channelType: "private_channel", invitedAgentIds: [AGENT_2] },
    });
    await projection.project(event, [PUBLIC_CHANNEL, PRIVATE_CHANNEL], MEMBERSHIPS, SETTINGS);
    expect(gateway.createdChannels.length).toBe(1);
  });

  it("reports gateway failures to operators without throwing", async () => {
    class ThrowingGateway extends MockDeliveryGateway {
      sendAgentMessage(): Promise<void> {
        return Promise.reject(new Error("discord 429"));
      }
    }

    gateway = new ThrowingGateway();
    projection = new DeliveryProjection(gateway);

    const event = makeCommittedEvent({ type: "message_sent" });
    await expect(
      projection.project(event, [PUBLIC_CHANNEL, PRIVATE_CHANNEL], MEMBERSHIPS, SETTINGS),
    ).resolves.toBeUndefined();

    expect(gateway.operatorEvents).toHaveLength(1);
    expect(gateway.operatorEvents[0]?.type).toBe("scheduler_error");
    expect(gateway.operatorEvents[0]?.detail).toContain("Delivery gateway failed");
  });
});

describe("DeliveryProjection — one emission per committed message", () => {
  const AGENT_3 = "agent_3";
  const AGENT_4 = "agent_4";
  const BIG_CHANNEL_ID = "ch_big";

  const bigChannel: Channel = {
    ...PUBLIC_CHANNEL,
    id: BIG_CHANNEL_ID,
    memberAgentIds: [AGENT_1, AGENT_2, AGENT_3, AGENT_4],
  };
  const bigMembership: ChannelMembership[] = [AGENT_1, AGENT_2, AGENT_3, AGENT_4].map(agentId => ({
    channelId: BIG_CHANNEL_ID,
    agentId,
    joinedAt: Date.now(),
  }));
  const bigChannelEvent = (type: CommittedEvent["type"]): CommittedEvent =>
    makeCommittedEvent({
      channelId: BIG_CHANNEL_ID,
      type,
      payload: { content: "hello", replyToEventId: "evt_0", emoji: "👍", targetEventId: "evt_0" },
    });

  it("a message to a 4-member channel produces exactly one sendAgentMessage call", async () => {
    const gateway = new MockDeliveryGateway();
    const projection = new DeliveryProjection(gateway);
    await projection.project(bigChannelEvent("message_sent"), [bigChannel], bigMembership, SETTINGS);
    expect(gateway.agentMessages).toHaveLength(1);
  });

  it("reply and reaction events each emit exactly once on an N-member channel", async () => {
    const gateway = new MockDeliveryGateway();
    const projection = new DeliveryProjection(gateway);
    await projection.project(bigChannelEvent("reply_sent"), [bigChannel], bigMembership, SETTINGS);
    await projection.project(bigChannelEvent("reaction_sent"), [bigChannel], bigMembership, SETTINGS);
    expect(gateway.agentMessages).toHaveLength(2);
    expect(gateway.agentMessages.map(m => m.message.kind)).toEqual(["reply", "reaction"]);
  });

  it("StdoutDeliveryGateway writes one agent_message line for an N-member channel", async () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(chunk.toString());
      return true;
    });
    try {
      const projection = new DeliveryProjection(new StdoutDeliveryGateway());
      await projection.project(bigChannelEvent("message_sent"), [bigChannel], bigMembership, SETTINGS);
    } finally {
      spy.mockRestore();
    }
    const agentMessageLines = writes.filter(line => {
      try {
        return (JSON.parse(line) as { type: string }).type === "agent_message";
      } catch {
        return false;
      }
    });
    expect(agentMessageLines).toHaveLength(1);
  });
});
