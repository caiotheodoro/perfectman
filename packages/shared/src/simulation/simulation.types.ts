export type SimulationStatus = "initializing" | "running" | "paused" | "stopped";

export type EndReason = "operator_command" | "goal_end_offered";

export type SimulationSettings = {
  omniscientSpectatorMode: boolean;
  allowPrivateChannels: boolean;
  maxPrivateChannelsPerAgent: number;
  maxMessagesPerMinutePerAgent: number;
  llmCallBudgetPerMinute: number;
  pulseIntervalMs: number; // 2000-5000
  tokenBudgetPerHour: number;
};

export type Simulation = {
  id: string;
  name: string;
  status: SimulationStatus;
  agentIds: string[];
  channelIds: string[];
  settings: SimulationSettings;
  seed: number; // for deterministic RNG
  createdAt: number;
  updatedAt: number;
};

export type CreateSimulationInput = Omit<
  Simulation,
  "id" | "status" | "channelIds" | "createdAt" | "updatedAt"
> & {
  id?: string;
};
