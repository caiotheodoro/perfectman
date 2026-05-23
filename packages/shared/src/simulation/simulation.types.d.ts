export type SimulationStatus = "initializing" | "running" | "paused" | "stopped";
export type SimulationSettings = {
    omniscientSpectatorMode: boolean;
    allowPrivateChannels: boolean;
    maxPrivateChannelsPerAgent: number;
    maxMessagesPerMinutePerAgent: number;
    llmCallBudgetPerMinute: number;
    pulseIntervalMs: number;
    tokenBudgetPerHour: number;
};
export type Simulation = {
    id: string;
    name: string;
    status: SimulationStatus;
    agentIds: string[];
    channelIds: string[];
    settings: SimulationSettings;
    seed: number;
    createdAt: number;
    updatedAt: number;
};
export type CreateSimulationInput = Omit<Simulation, "id" | "status" | "channelIds" | "createdAt" | "updatedAt"> & {
    id?: string;
};
//# sourceMappingURL=simulation.types.d.ts.map