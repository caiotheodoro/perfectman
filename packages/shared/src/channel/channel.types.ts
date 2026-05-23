export type ChannelType =
  | "public_channel"
  | "private_channel"
  | "spectator_channel"
  | "operator_channel";

export type ChannelStatus = "active" | "archived";

export type Channel = {
  id: string;
  simulationId: string;
  type: ChannelType;
  name: string;
  createdBy: string; // agentId or 'system'
  memberAgentIds: string[];
  spectatorVisible: boolean;
  operatorVisible: boolean; // always true
  createdForMotives: string[];
  status: ChannelStatus;
  createdAt: number;
  updatedAt: number;
};

export type ChannelMembership = {
  channelId: string;
  agentId: string;
  joinedAt: number;
  leftAt?: number;
};
