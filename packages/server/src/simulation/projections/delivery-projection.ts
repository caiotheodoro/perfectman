import type {
  CommittedEvent,
  Channel,
  ChannelMembership,
  SimulationSettings,
  OperatorEvent,
} from "@perfectman/shared";
import { filterVisibleEventsForAgent } from "@perfectman/engine";
import type { IDeliveryGateway, DeliveryMessage } from "../scheduler-contracts.js";

export class DeliveryProjection {
  constructor(private readonly gateway: IDeliveryGateway) {}

  async project(
    event: CommittedEvent,
    channels: Channel[],
    membership: ChannelMembership[],
    settings: SimulationSettings,
  ): Promise<void> {
    const memberAgentIds = this.getMemberAgentIds(event.channelId, membership);

    switch (event.type) {
      case "message_sent": {
        const content = (event.payload["content"] as string | undefined) ?? "";
        for (const agentId of memberAgentIds) {
          const visible = filterVisibleEventsForAgent([event], agentId, channels, membership);
          if (visible.length === 0) continue;
          const msg: DeliveryMessage = {
            kind: "message",
            agentId: event.actorId,
            content,
            salience: event.emotionalSalience,
          };
          await this.safeGatewayCall(event, "sendAgentMessage", () => this.gateway.sendAgentMessage(event.channelId, msg));
        }
        break;
      }
      case "reply_sent": {
        const content = (event.payload["content"] as string | undefined) ?? "";
        const replyToEventId = (event.payload["replyToEventId"] as string | undefined) ?? "";
        for (const agentId of memberAgentIds) {
          const visible = filterVisibleEventsForAgent([event], agentId, channels, membership);
          if (visible.length === 0) continue;
          const msg: DeliveryMessage = {
            kind: "reply",
            agentId: event.actorId,
            content,
            replyToEventId,
            salience: event.emotionalSalience,
          };
          await this.safeGatewayCall(event, "sendAgentMessage", () => this.gateway.sendAgentMessage(event.channelId, msg));
        }
        break;
      }
      case "reaction_sent": {
        const emoji = (event.payload["emoji"] as string | undefined) ?? "👍";
        const targetEventId = (event.payload["targetEventId"] as string | undefined) ?? "";
        for (const agentId of memberAgentIds) {
          const visible = filterVisibleEventsForAgent([event], agentId, channels, membership);
          if (visible.length === 0) continue;
          const msg: DeliveryMessage = {
            kind: "reaction",
            agentId: event.actorId,
            emoji,
            targetEventId,
            salience: event.emotionalSalience,
          };
          await this.safeGatewayCall(event, "sendAgentMessage", () => this.gateway.sendAgentMessage(event.channelId, msg));
        }
        break;
      }
      case "channel_created": {
        const channelType = (event.payload["channelType"] as string | undefined) ?? "public_channel";
        const invitedAgentIds = (event.payload["invitedAgentIds"] as string[] | undefined) ?? [];
        await this.safeGatewayCall(event, "createChannel", () => this.gateway.createChannel(
          event.channelId,
          channelType as Channel["type"],
          [event.actorId, ...invitedAgentIds],
        ));
        break;
      }
      case "agent_invited": {
        const invitedAgentId = (event.payload["invitedAgentId"] as string | undefined) ?? "";
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
