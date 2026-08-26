import type {
  ChannelType,
  OperatorEvent,
  SpectatorEvent,
  EndReason,
  EndingOffer,
} from "@perfectman/shared";
import type { DeliveryMessage, IDeliveryGateway } from "../simulation/scheduler-contracts.js";

export class CompositeDeliveryGateway implements IDeliveryGateway {
  constructor(private readonly gateways: IDeliveryGateway[]) {
    if (gateways.length === 0) throw new Error("At least one delivery gateway is required");
  }

  async sendAgentMessage(channelId: string, message: DeliveryMessage): Promise<void> {
    await Promise.all(this.gateways.map(gateway => gateway.sendAgentMessage(channelId, message)));
  }

  async createChannel(channelId: string, type: ChannelType, memberAgentIds: string[]): Promise<void> {
    await Promise.all(this.gateways.map(gateway => gateway.createChannel(channelId, type, memberAgentIds)));
  }

  async addMember(channelId: string, agentId: string): Promise<void> {
    await Promise.all(this.gateways.map(gateway => gateway.addMember(channelId, agentId)));
  }

  async removeMember(channelId: string, agentId: string): Promise<void> {
    await Promise.all(this.gateways.map(gateway => gateway.removeMember(channelId, agentId)));
  }

  async sendSpectatorEvent(event: SpectatorEvent): Promise<void> {
    await Promise.all(this.gateways.map(gateway => gateway.sendSpectatorEvent(event)));
  }

  async sendOperatorEvent(event: OperatorEvent): Promise<void> {
    await Promise.all(this.gateways.map(gateway => gateway.sendOperatorEvent(event)));
  }

  async onSimulationStopped(simulationId: string, endReason?: EndReason, endingOffer?: EndingOffer): Promise<void> {
    await Promise.all(this.gateways.map(gateway => gateway.onSimulationStopped(simulationId, endReason, endingOffer)));
  }
}
