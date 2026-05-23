import { z } from "zod";

export const EventTypeSchema = z.enum([
  "message_sent",
  "reply_sent",
  "reaction_sent",
  "typing_started",
  "typing_cancelled",
  "channel_created",
  "agent_invited",
  "agent_left",
  "presence_changed",
  "intent_delayed",
  "intent_blocked",
  "memory_written",
  "no_op_recorded",
  "private_motive_summary",
  "operator_warning",
  "llm_failure",
  "simulation_started",
  "simulation_paused",
  "simulation_resumed",
  "simulation_stopped",
  "recap_generated",
  "reflection_completed",
  "stagnation_detected",
]);

export const EmotionalSalienceSchema = z.enum(["low", "medium", "high", "critical"]);

export const EventVisibilitySchema = z.object({
  visibleToAgents: z.array(z.string()),
  visibleToSpectators: z.boolean(),
  visibleToOperators: z.boolean(),
  visibilityReason: z.string(),
});

export const SimulationEventSchema = z.object({
  id: z.string().optional(),
  simulationId: z.string().min(1),
  channelId: z.string().min(1),
  actorId: z.string().min(1),
  type: EventTypeSchema,
  payload: z.record(z.unknown()),
  createdAt: z.number().int().positive().optional(),
  pulseIndex: z.number().int().nonnegative().optional(),
  sourceIntentId: z.string().optional(),
  sourceEventIds: z.array(z.string()),
  emotionalSalience: EmotionalSalienceSchema,
  visibility: EventVisibilitySchema,
});

export const CommittedEventSchema = SimulationEventSchema.extend({
  id: z.string().min(1),
  createdAt: z.number().int().positive(),
  pulseIndex: z.number().int().nonnegative(),
});
