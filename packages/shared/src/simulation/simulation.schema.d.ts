import { z } from "zod";
export declare const SimulationStatusSchema: z.ZodEnum<["initializing", "running", "paused", "stopped"]>;
export declare const SimulationSettingsSchema: z.ZodObject<{
    omniscientSpectatorMode: z.ZodBoolean;
    allowPrivateChannels: z.ZodBoolean;
    maxPrivateChannelsPerAgent: z.ZodNumber;
    maxMessagesPerMinutePerAgent: z.ZodNumber;
    llmCallBudgetPerMinute: z.ZodNumber;
    pulseIntervalMs: z.ZodNumber;
    tokenBudgetPerHour: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    omniscientSpectatorMode: boolean;
    allowPrivateChannels: boolean;
    maxPrivateChannelsPerAgent: number;
    maxMessagesPerMinutePerAgent: number;
    llmCallBudgetPerMinute: number;
    pulseIntervalMs: number;
    tokenBudgetPerHour: number;
}, {
    omniscientSpectatorMode: boolean;
    allowPrivateChannels: boolean;
    maxPrivateChannelsPerAgent: number;
    maxMessagesPerMinutePerAgent: number;
    llmCallBudgetPerMinute: number;
    pulseIntervalMs: number;
    tokenBudgetPerHour: number;
}>;
export declare const SimulationSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    status: z.ZodEnum<["initializing", "running", "paused", "stopped"]>;
    agentIds: z.ZodArray<z.ZodString, "many">;
    channelIds: z.ZodArray<z.ZodString, "many">;
    settings: z.ZodObject<{
        omniscientSpectatorMode: z.ZodBoolean;
        allowPrivateChannels: z.ZodBoolean;
        maxPrivateChannelsPerAgent: z.ZodNumber;
        maxMessagesPerMinutePerAgent: z.ZodNumber;
        llmCallBudgetPerMinute: z.ZodNumber;
        pulseIntervalMs: z.ZodNumber;
        tokenBudgetPerHour: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        omniscientSpectatorMode: boolean;
        allowPrivateChannels: boolean;
        maxPrivateChannelsPerAgent: number;
        maxMessagesPerMinutePerAgent: number;
        llmCallBudgetPerMinute: number;
        pulseIntervalMs: number;
        tokenBudgetPerHour: number;
    }, {
        omniscientSpectatorMode: boolean;
        allowPrivateChannels: boolean;
        maxPrivateChannelsPerAgent: number;
        maxMessagesPerMinutePerAgent: number;
        llmCallBudgetPerMinute: number;
        pulseIntervalMs: number;
        tokenBudgetPerHour: number;
    }>;
    seed: z.ZodNumber;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    status: "initializing" | "running" | "paused" | "stopped";
    channelIds: string[];
    createdAt: number;
    updatedAt: number;
    name: string;
    agentIds: string[];
    settings: {
        omniscientSpectatorMode: boolean;
        allowPrivateChannels: boolean;
        maxPrivateChannelsPerAgent: number;
        maxMessagesPerMinutePerAgent: number;
        llmCallBudgetPerMinute: number;
        pulseIntervalMs: number;
        tokenBudgetPerHour: number;
    };
    seed: number;
}, {
    id: string;
    status: "initializing" | "running" | "paused" | "stopped";
    channelIds: string[];
    createdAt: number;
    updatedAt: number;
    name: string;
    agentIds: string[];
    settings: {
        omniscientSpectatorMode: boolean;
        allowPrivateChannels: boolean;
        maxPrivateChannelsPerAgent: number;
        maxMessagesPerMinutePerAgent: number;
        llmCallBudgetPerMinute: number;
        pulseIntervalMs: number;
        tokenBudgetPerHour: number;
    };
    seed: number;
}>;
//# sourceMappingURL=simulation.schema.d.ts.map