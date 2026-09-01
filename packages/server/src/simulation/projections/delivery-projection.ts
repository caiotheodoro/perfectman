import type {
  CommittedEvent,
  Channel,
  ChannelMembership,
  SimulationSettings,
  OperatorEvent,
} from "@perfectman/shared";
import { filterVisibleEventsForAgent } from "@perfectman/engine";
import type { IDeliveryGateway, DeliveryMessage } from "../scheduler-contracts.js";
import { payloadChannelType, payloadString, payloadStringArray } from "../payload-readers.js";

export class DeliveryProjection {
  constructor(private readonly gateway: IDeliveryGateway) {}

  async project(
    event: CommittedEvent,
    channels: Channel[],
    membership: ChannelMembership[],
    settings: SimulationSettings,
  ): Promise<void> {
    switch (event.type) {
      case "message_sent": {
        await this.deliverIfVisible(event, channels, membership, () => ({
          kind: "message",
          agentId: event.actorId,
          content: payloadString(event.payload, "content"),
          salience: event.emotionalSalience,
        }));
        break;
      }
      case "reply_sent": {
        await this.deliverIfVisible(event, channels, membership, () => ({
          kind: "reply",
          agentId: event.actorId,
          content: payloadString(event.payload, "content"),
          replyToEventId: payloadString(event.payload, "replyToEventId"),
          salience: event.emotionalSalience,
        }));
        break;
      }
      case "reaction_sent": {
        await this.deliverIfVisible(event, channels, membership, () => ({
          kind: "reaction",
          agentId: event.actorId,
          emoji: payloadString(event.payload, "emoji", "👍"),
          targetEventId: payloadString(event.payload, "targetEventId"),
          salience: event.emotionalSalience,
        }));
        break;
      }
      case "channel_created": {
        const channelType = payloadChannelType(event.payload, "channelType", "public_channel");
        const invitedAgentIds = payloadStringArray(event.payload, "invitedAgentIds");
        await this.safeGatewayCall(event, "createChannel", () => this.gateway.createChannel(
          event.channelId,
          channelType,
          [event.actorId, ...invitedAgentIds],
        ));
        break;
      }
      case "agent_invited": {
        const invitedAgentId = payloadString(event.payload, "invitedAgentId");
        await this.safeGatewayCall(event, "addMember", () => this.gateway.addMember(event.channelId, invitedAgentId));
        break;
      }
      case "agent_left": {
        await this.safeGatewayCall(event, "removeMember", () => this.gateway.removeMember(event.channelId, event.actorId));
        break;
      }
      default:
        break;
    }
  }

  private async deliverIfVisible(
    event: CommittedEvent,
    channels: Channel[],
    membership: ChannelMembership[],
    buildMessage: () => DeliveryMessage,
  ): Promise<void> {
    const memberAgentIds = this.getMemberAgentIds(event.channelId, membership);
    if (!this.visibleToAnyMember(event, memberAgentIds, channels, membership)) return;
    const msg = buildMessage();
    await this.safeGatewayCall(event, "sendAgentMessage", () => this.gateway.sendAgentMessage(event.channelId, msg));
  }

  private visibleToAnyMember(
    event: CommittedEvent,
    memberAgentIds: string[],
    channels: Channel[],
    membership: ChannelMembership[],
  ): boolean {
    return memberAgentIds.some(
      agentId => filterVisibleEventsForAgent([event], agentId, channels, membership).length > 0,
    );
  }

  private getMemberAgentIds(channelId: string, membership: ChannelMembership[]): string[] {
    return membership
      .filter(m => m.channelId === channelId && !m.leftAt)
      .map(m => m.agentId);
  }

  private async safeGatewayCall(
    event: CommittedEvent,
    operation: string,
    call: () => Promise<void>,
  ): Promise<void> {
    try {
      await call();
    } catch (err) {
      const operatorEvent: OperatorEvent = {
        type: "scheduler_error",
        simulationId: event.simulationId,
        agentId: event.actorId,
        pulseIndex: event.pulseIndex,
        detail: `Delivery gateway failed during ${operation}`,
        data: {
          eventId: event.id,
          channelId: event.channelId,
          reason: err instanceof Error ? err.message : String(err),
        },
        createdAt: Date.now(),
      };

      try {
        await this.gateway.sendOperatorEvent(operatorEvent);
      } catch {
        // Delivery failures must not escape projection.
      }
    }
  }
}
