import { z } from "zod";

export const ScenarioPresetSchema = z.enum([
  "friends_cold_open",
  "strangers_first_meeting",
  "mixed_room",
  "returning_after_silence",
  "post_event_tension",
  "introduced_by_host",
  "private_channel_seed",
  "custom",
]);

export const RelationshipModeSchema = z.enum([
  "established_friends",
  "total_strangers",
  "mixed",
]);

export const VisibleIntroPolicySchema = z.enum([
  "none",
  "system_intro",
  "agent_intros",
  "host_message_only",
  "custom",
]);

export const AgentIntroBehaviorSchema = z.enum([
  "do_not_introduce_yourself_formally",
  "introduce_yourself_briefly",
  "introduce_yourself_only_to_people_you_do_not_know",
  "wait_for_context",
]);

export const ScenarioContextSchema = z.object({
  scenario: ScenarioPresetSchema,
  relationshipMode: RelationshipModeSchema,
  roomContext: z.string().min(1),
  startingMood: z.string().min(1),
  visibleIntro: VisibleIntroPolicySchema,
  agentIntroBehavior: AgentIntroBehaviorSchema,
  firstMoveGuidance: z.string().min(1),
  customNotes: z.array(z.string()).optional(),
  pairFamiliarity: z.record(z.string()).optional(),
  safePriorContext: z.array(z.string()).optional(),
  startingPrompt: z.string().min(1).optional(),
});
