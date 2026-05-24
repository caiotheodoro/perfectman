import type {
  ChannelType,
  OperatorEvent,
  SpectatorEvent,
} from "@perfectman/shared";
import type { DeliveryMessage, IDeliveryGateway } from "../simulation/scheduler-contracts.js";

export class MockDeliveryGateway implements IDeliveryGateway {
  readonly agentMessages: Array<{ channelId: string; message: DeliveryMessage }> = [];
  readonly createdChannels: Array<{ channelId: string; type: ChannelType; memberAgentIds: string[] }> = [];
  readonly addedMembers: Array<{ channelId: string; agentId: string }> = [];
  readonly removedMembers: Array<{ channelId: string; agentId: string }> = [];
  readonly spectatorEvents: SpectatorEvent[] = [];
  readonly operatorEvents: OperatorEvent[] = [];
  readonly stoppedSimulations: string[] = [];

  sendAgentMessage(channelId: string, message: DeliveryMessage): Promise<void> {
    this.agentMessages.push({ channelId, message });
    return Promise.resolve();
  }

  createChannel(channelId: string, type: ChannelType, memberAgentIds: string[]): Promise<void> {
    this.createdChannels.push({ channelId, type, memberAgentIds });
    return Promise.resolve();
  }

  addMember(channelId: string, agentId: string): Promise<void> {
    this.addedMembers.push({ channelId, agentId });
    return Promise.resolve();
  }

  removeMember(channelId: string, agentId: string): Promise<void> {
    this.removedMembers.push({ channelId, agentId });
    return Promise.resolve();
  }

  sendSpectatorEvent(event: SpectatorEvent): Promise<void> {
    this.spectatorEvents.push(event);
    return Promise.resolve();
  }

  sendOperatorEvent(event: OperatorEvent): Promise<void> {
    this.operatorEvents.push(event);
    return Promise.resolve();
  }

  onSimulationStopped(simulationId: string): Promise<void> {
    this.stoppedSimulations.push(simulationId);
    return Promise.resolve();
  }

  reset(): void {
    this.agentMessages.length = 0;
    this.createdChannels.length = 0;
    this.addedMembers.length = 0;
    this.removedMembers.length = 0;
    this.spectatorEvents.length = 0;
    this.operatorEvents.length = 0;
    this.stoppedSimulations.length = 0;
  }
}
