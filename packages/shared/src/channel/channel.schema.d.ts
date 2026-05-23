import { z } from "zod";
export declare const ChannelTypeSchema: z.ZodEnum<["public_channel", "private_channel", "spectator_channel", "operator_channel"]>;
export declare const ChannelSchema: z.ZodObject<{
    id: z.ZodString;
    simulationId: z.ZodString;
    type: z.ZodEnum<["public_channel", "private_channel", "spectator_channel", "operator_channel"]>;
    name: z.ZodString;
    createdBy: z.ZodString;
    memberAgentIds: z.ZodArray<z.ZodString, "many">;
    spectatorVisible: z.ZodBoolean;
    operatorVisible: z.ZodBoolean;
    createdForMotives: z.ZodArray<z.ZodString, "many">;
    status: z.ZodEnum<["active", "archived"]>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    status: "active" | "archived";
    createdAt: number;
    updatedAt: number;
    name: string;
    type: "public_channel" | "private_channel" | "spectator_channel" | "operator_channel";
    simulationId: string;
    createdBy: string;
    memberAgentIds: string[];
    spectatorVisible: boolean;
    operatorVisible: boolean;
    createdForMotives: string[];
}, {
    id: string;
    status: "active" | "archived";
    createdAt: number;
    updatedAt: number;
    name: string;
    type: "public_channel" | "private_channel" | "spectator_channel" | "operator_channel";
    simulationId: string;
    createdBy: string;
    memberAgentIds: string[];
    spectatorVisible: boolean;
    operatorVisible: boolean;
    createdForMotives: string[];
}>;
export declare const ChannelMembershipSchema: z.ZodObject<{
    channelId: z.ZodString;
    agentId: z.ZodString;
    joinedAt: z.ZodNumber;
    leftAt: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    channelId: string;
    agentId: string;
    joinedAt: number;
    leftAt?: number | undefined;
}, {
    channelId: string;
    agentId: string;
    joinedAt: number;
    leftAt?: number | undefined;
}>;
//# sourceMappingURL=channel.schema.d.ts.map