import type {
  ChannelType,
  SpectatorEvent,
  OperatorEvent,
  EndReason,
  EndingOffer,
  BodyCommand,
  HearingLevel,
  SpeechMode,
} from "@perfectman/shared";
import type { EmotionalSalience } from "@perfectman/shared";

/**
 * Optional committed-event metadata a hotel gateway reads (docs/embodiment.md
 * section 9). Unset everywhere outside hotel mode.
 */
export type DeliveryMessageMeta = {
  eventId?: string;
  mode?: SpeechMode;
  whisperTo?: string;
  hearing?: Record<string, HearingLevel>;
};

export type DeliveryMessage = (
  | { kind: "message"; agentId: string; content: string; salience: EmotionalSalience }
  | { kind: "reply"; agentId: string; content: string; replyToEventId: string; salience: EmotionalSalience }
  | { kind: "reaction"; agentId: string; emoji: string; targetEventId: string; salience: EmotionalSalience }
) &
  DeliveryMessageMeta;

export type IDeliveryGateway = {
  sendAgentMessage(channelId: string, message: DeliveryMessage): Promise<void>;
  createChannel(channelId: string, type: ChannelType, memberAgentIds: string[]): Promise<void>;
  addMember(channelId: string, agentId: string): Promise<void>;
  removeMember(channelId: string, agentId: string): Promise<void>;
  sendSpectatorEvent(event: SpectatorEvent): Promise<void>;
  sendOperatorEvent(event: OperatorEvent): Promise<void>;
  onSimulationStopped(simulationId: string, endReason?: EndReason, endingOffer?: EndingOffer): Promise<void>;
};

/**
 * Body side of a hotel gateway. Like `IDeliveryGateway`, an implementation
 * must enqueue and return: nothing here may await the hotel (hotel-package.md
 * section 7). Not yet called by the scheduler; the hotel's `HotelGateway`
 * implements both interfaces.
 */
export type IBodyGateway = {
  dispatch(commands: BodyCommand[]): Promise<void>;
};
