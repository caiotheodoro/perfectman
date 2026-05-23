export type PressureIntensity = "low" | "medium" | "high" | "overwhelming";

export type VisibilityPreference = "public" | "private" | "either" | "hidden";

export type PressureType =
  | "urge_to_reply"
  | "urge_to_message"
  | "urge_to_defend_self"
  | "urge_to_mock"
  | "urge_to_create_private_channel"
  | "urge_to_invite"
  | "urge_to_leave"
  | "urge_to_react"
  | "urge_to_type"
  | "urge_to_show_off"
  | "urge_to_seek_comfort"
  | "urge_to_repair"
  | "urge_to_dominate"
  | "urge_to_provoke"
  | "urge_to_withdraw";

export type Pressure = {
  id: string;
  agentId: string;
  type: PressureType;
  targetAgentIds: string[];
  targetChannelId?: string;
  intensity: PressureIntensity;
  sourceEventIds: string[];
  sourceMotivations: string[];
  sourceEmotions: string[];
  visibilityPreference: VisibilityPreference;
  decayRate: number; // per pulse
};
