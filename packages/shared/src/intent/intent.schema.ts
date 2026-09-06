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
  intensity: z.number().min(0).max(1),
  unresolved: z.boolean(),
});

/**
 * The short memory proposal the model is asked for: what changed, about
 * whom. Twelve real DeepSeek runs answered the seven-field contract with
 * nothing at all; the parser fills structure from this shape and the
 * resolver fills tone and intensity from the agent's action emotions.
 */
// `.strict()`: a seven-field proposal must not match the short branch by
// having its extra keys stripped — the union tries this branch first.
export const MemoryWriteShortSchema = z.object({
  summary: z.string().min(1),
  about: z.array(z.string()).optional(),
}).strict();
export type MemoryWriteShort = z.infer<typeof MemoryWriteShortSchema>;

/** Tone placeholder on a short proposal until the resolver derives it. */
export const MEMORY_TONE_UNSPECIFIED = "unspecified";

export const ActionIntentSchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1),
  intentType: IntentTypeSchema,
  channelTarget: z.string().optional(),
  personTargets: z.array(z.string()).default([]),
  visibleContent: z.string().optional(),
  privateMotiveSummary: z.string().min(1), // required, never empty
  emotionDrivers: z.array(z.string()).default([]),
  motivationDrivers: z.array(z.string()).default([]),
  preferredDelay: z.number().nonnegative().optional(),
  fallbackIfBlocked: IntentTypeSchema.optional(),
  memoryWrites: z.array(MemoryWriteProposalSchema).default([]),
  spectatorSummary: z.string().optional(),
  replyToEventId: z.string().optional(),
  emoji: z.string().optional(),
  targetEventId: z.string().optional(),
  channelName: z.string().optional(),
  channelType: IntentChannelTypeSchema.optional(),
  invitedAgentIds: z.array(z.string()).optional(),
});
