import type {
  ChannelType,
  OperatorEvent,
  SpectatorEvent,
  EndReason,
  EndingOffer,
} from "@perfectman/shared";
import type { GatewayRuntimeMetadata } from "../config/simulation-config.js";
import type { DeliveryMessage, IDeliveryGateway } from "../simulation/scheduler-contracts.js";

export class StdoutDeliveryGateway implements IDeliveryGateway {
  constructor(
    private readonly debug = false,
    private readonly runtimeMetadata?: GatewayRuntimeMetadata,
  ) {}

  sendAgentMessage(channelId: string, message: DeliveryMessage): Promise<void> {
    this.write("agent_message", { channelId, message });
    return Promise.resolve();
  }

  createChannel(channelId: string, type: ChannelType, memberAgentIds: string[]): Promise<void> {
    this.write("channel_created", { channelId, type, memberAgentIds });
    return Promise.resolve();
  }

  addMember(channelId: string, agentId: string): Promise<void> {
    this.write("member_added", { channelId, agentId });
    return Promise.resolve();
  }

  removeMember(channelId: string, agentId: string): Promise<void> {
    this.write("member_removed", { channelId, agentId });
    return Promise.resolve();
  }

  sendSpectatorEvent(event: SpectatorEvent): Promise<void> {
    this.write("spectator_event", event);
    return Promise.resolve();
  }

  sendOperatorEvent(event: OperatorEvent): Promise<void> {
    if (this.debug) this.write("operator_event", event);
    return Promise.resolve();
  }

  onSimulationStopped(simulationId: string, endReason?: EndReason, endingOffer?: EndingOffer): Promise<void> {
    this.write("simulation_stopped", {
      simulationId,
      ...(endReason !== undefined ? { endReason } : {}),
      ...(endingOffer !== undefined ? { endingOffer } : {}),
    });
    return Promise.resolve();
  }

  private write(type: string, payload: unknown): void {
    process.stdout.write(`${JSON.stringify({ type, payload })}\n`);
  }
}
