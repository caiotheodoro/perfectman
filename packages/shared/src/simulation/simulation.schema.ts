import { z } from "zod";

export const SimulationStatusSchema = z.enum([
  "initializing",
  "running",
  "paused",
  "stopped",
]);

export const SimulationSettingsSchema = z.object({
  omniscientSpectatorMode: z.boolean(),
  allowPrivateChannels: z.boolean(),
  maxPrivateChannelsPerAgent: z.number().int().nonnegative(),
  maxMessagesPerMinutePerAgent: z.number().int().positive(),
  llmCallBudgetPerMinute: z.number().int().positive(),
  pulseIntervalMs: z.number().int().min(500).max(10000),
  tokenBudgetPerHour: z.number().int().positive(),
});

export const SimulationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: SimulationStatusSchema,
  agentIds: z.array(z.string()),
  channelIds: z.array(z.string()),
  settings: SimulationSettingsSchema,
  seed: z.number().int(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});
