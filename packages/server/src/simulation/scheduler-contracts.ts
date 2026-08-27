import type {
  ChannelType,
  SpectatorEvent,
  OperatorEvent,
  EndReason,
  EndingOffer,
} from "@perfectman/shared";
import type { EmotionalSalience } from "@perfectman/shared";

export type DeliveryMessage =
  | { kind: "message"; agentId: string; content: string; salience: EmotionalSalience }
  | { kind: "reply"; agentId: string; content: string; replyToEventId: string; salience: EmotionalSalience }
  | { kind: "reaction"; agentId: string; emoji: string; targetEventId: string; salience: EmotionalSalience };

export type IDeliveryGateway = {
  sendAgentMessage(channelId: string, message: DeliveryMessage): Promise<void>;
  createChannel(channelId: string, type: ChannelType, memberAgentIds: string[]): Promise<void>;
  addMember(channelId: string, agentId: string): Promise<void>;
  removeMember(channelId: string, agentId: string): Promise<void>;
  sendSpectatorEvent(event: SpectatorEvent): Promise<void>;
  sendOperatorEvent(event: OperatorEvent): Promise<void>;
  onSimulationStopped(simulationId: string, endReason?: EndReason, endingOffer?: EndingOffer): Promise<void>;
};
