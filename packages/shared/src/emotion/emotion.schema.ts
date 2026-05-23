import { z } from "zod";

export const CoreMoodSchema = z.object({
  valence: z.number().min(-1).max(1),
  arousal: z.number().min(0).max(1),
  stability: z.number().min(0.1).max(1),
  energy: z.number().min(0).max(1),
  circumplexAngle: z.number(),
  circumplexRadius: z.number().min(0).max(1),
  momentumValence: z.number(),
  momentumArousal: z.number(),
});

const socialDimension = z.number().min(0).max(1);

export const SocialEmotionsSchema = z.object({
  jealousy: socialDimension,
  envy: socialDimension,
  humiliation: socialDimension,
  pride: socialDimension,
  shame: socialDimension,
  affection: socialDimension,
  resentment: socialDimension,
  suspicion: socialDimension,
  admiration: socialDimension,
  contempt: socialDimension,
  neediness: socialDimension,
  socialAnxiety: socialDimension,
  fearOfExclusion: socialDimension,
  desireForStatus: socialDimension,
  desireForIntimacy: socialDimension,
});

export const RelationalStateSchema = z.object({
  targetAgentId: z.string().min(1),
  trust: z.number().min(-1).max(1),
  affection: socialDimension,
  resentment: socialDimension,
  attraction: socialDimension,
  suspicion: socialDimension,
  admiration: socialDimension,
  envy: socialDimension,
  comfort: socialDimension,
  threat: socialDimension,
  curiosity: socialDimension,
  desireForCloseness: socialDimension,
  desireForDistance: socialDimension,
  interactionCount: z.number().int().nonnegative(),
  lastInteractionAt: z.number().int().positive().nullable(),
  lastPositiveAt: z.number().int().positive().nullable(),
  lastNegativeAt: z.number().int().positive().nullable(),
});

export const ActionEmotionsSchema = z.object({
  defensiveness: socialDimension,
  warmth: socialDimension,
  jealousInspection: socialDimension,
  shameWithdrawal: socialDimension,
  resentfulColdness: socialDimension,
  curiousApproach: socialDimension,
  anxiousOverreach: socialDimension,
  pridefulPerformance: socialDimension,
  vulnerableRetreat: socialDimension,
  contemptuousDismissal: socialDimension,
  strategicPatience: socialDimension,
  impulsiveProvocation: socialDimension,
  comfortSeeking: socialDimension,
  dominanceAssertion: socialDimension,
  repairImpulse: socialDimension,
});
