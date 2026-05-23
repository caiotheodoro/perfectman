import { z } from "zod";
export const ChannelTypeSchema = z.enum([
    "public_channel",
    "private_channel",
    "spectator_channel",
    "operator_channel",
]);
export const ChannelSchema = z.object({
    id: z.string().min(1),
    simulationId: z.string().min(1),
    type: ChannelTypeSchema,
    name: z.string().min(1),
    createdBy: z.string().min(1),
    memberAgentIds: z.array(z.string()),
    spectatorVisible: z.boolean(),
    operatorVisible: z.boolean(),
    createdForMotives: z.array(z.string()),
    status: z.enum(["active", "archived"]),
    createdAt: z.number().int().positive(),
    updatedAt: z.number().int().positive(),
});
export const ChannelMembershipSchema = z.object({
    channelId: z.string().min(1),
    agentId: z.string().min(1),
    joinedAt: z.number().int().positive(),
    leftAt: z.number().int().positive().optional(),
});
//# sourceMappingURL=channel.schema.js.map