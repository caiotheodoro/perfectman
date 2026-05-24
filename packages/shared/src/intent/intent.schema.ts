import { z } from "zod";

export const IntentTypeSchema = z.enum([
  "send_message",
  "reply_to_message",
  "react",
  "create_channel",
  "invite_agent",
  "leave_channel",
  "typing_start",
  "typing_cancel",
  "write_memory",
  "delay_response",
  "no_op",
]);

export const IntentChannelTypeSchema = z.enum([
  "public_channel",
  "private_channel",
  "spectator_channel",
  "operator_channel",
]);

export const MemoryWriteProposalSchema = z.object({
  type: z.enum([
    "episodic",
    "relationship",
    "self",
    "social_theory",
    "pending_intention",
    "emotional_residue",
  ]),
  subjectAgentIds: z.array(z.string()),
  summary: z.string().min(1),
  emotionalTone: z.string().min(1),
  confidence: z.number().min(0).max(1),
  unresolved: z.boolean(),
});

export const ActionIntentSchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1),
  intentType: IntentTypeSchema,
  channelTarget: z.string().optional(),
  personTargets: z.array(z.string()),
  visibleContent: z.string().optional(),
  privateMotiveSummary: z.string().min(1), // required, never empty
  emotionDrivers: z.array(z.string()),
  motivationDrivers: z.array(z.string()),
  preferredDelay: z.number().nonnegative().optional(),
  fallbackIfBlocked: IntentTypeSchema.optional(),
  memoryWrites: z.array(MemoryWriteProposalSchema),
  spectatorSummary: z.string().optional(),
  replyToEventId: z.string().optional(),
  emoji: z.string().optional(),
  targetEventId: z.string().optional(),
  channelName: z.string().optional(),
  channelType: IntentChannelTypeSchema.optional(),
  invitedAgentIds: z.array(z.string()).optional(),
});
