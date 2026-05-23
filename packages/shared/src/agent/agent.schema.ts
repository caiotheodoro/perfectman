import { z } from "zod";
import { CoreMoodSchema, SocialEmotionsSchema } from "../emotion/emotion.schema.js";

export const PresenceModeSchema = z.enum([
  "active",
  "semi_active",
  "lurking",
  "busy_elsewhere",
  "avoidant",
  "offline",
]);

export const BudgetPrioritySchema = z.enum(["high", "normal", "low", "blocked"]);

export const PersonaConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  archetype: z.string().min(1),
  writingStyle: z.string().min(1),
  styleExamples: z.array(z.string()),
  baselineValence: z.number().min(-1).max(1),
  baselineArousal: z.number().min(0).max(1),
  baselineStability: z.number().min(0.1).max(1),
  baselineEnergy: z.number().min(0).max(1),
  emotionalReactivity: z.number().positive(),
  moodInertia: z.number().min(0).max(1),
  maxMoodRotation: z.number().positive(),
  energyRegen: z.number().positive(),
  exclusionSensitivity: z.number().min(0).max(3),
  praiseSensitivity: z.number().min(0).max(3),
  conflictSensitivity: z.number().min(0).max(3),
  boredomSensitivity: z.number().min(0).max(3),
  intimacySensitivity: z.number().min(0).max(3),
  socialSensitivities: z.record(z.number().min(0).max(3)),
});

export const AgentStateSchema = z.object({
  agentId:               z.string().min(1),
  simulationId:          z.string().min(1),
  personaId:             z.string().min(1),
  presence:              PresenceModeSchema,
  coreMood:              CoreMoodSchema,
  socialEmotions:        SocialEmotionsSchema,
  relationalStates:      z.instanceof(Map),
  memories:              z.array(z.any()),
  initiativeAccumulators: z.array(z.any()),
  lastProcessedEventId:  z.string().nullable(),
  lastActionAt:          z.number().nullable(),
  lastRuminationPulse:   z.number().nullable(),
  arrivalPulse:          z.number().nullable(),
  createdAt:             z.number(),
  updatedAt:             z.number(),
});
