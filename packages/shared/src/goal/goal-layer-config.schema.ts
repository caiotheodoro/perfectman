import { z } from "zod";
import {
  AcceptanceModeSchema,
  DelusionWeightsSchema,
  SynthesizerModeSchema,
} from "./goal.schema.js";

/**
 * The `goalLayer` config-file section (judge-section precedent). Every field
 * is optional: an absent key means the server default applies, and a config
 * without the section parses to `goalLayer: undefined` — no behavior change.
 */
export const GoalLayerConfigSchema = z.object({
  enabled: z.boolean().optional(),
  reviewEveryPulses: z.number().int().positive().optional(),
  delusionWeightsByAgent: z
    .record(z.string().min(1), DelusionWeightsSchema)
    .optional(),
  ending: z
    .object({
      offerAcceptPulses: z.number().int().nonnegative().optional(),
    })
    .optional(),
  synthesizer: z
    .object({
      mode: SynthesizerModeSchema.optional(),
      intervalPulses: z.number().int().positive().optional(),
      maxCandidatesPerReview: z.number().int().positive().optional(),
      maxSelfVerdictsPerReview: z.number().int().positive().optional(),
    })
    .optional(),
  acceptance: z
    .object({
      mode: AcceptanceModeSchema.optional(),
    })
    .optional(),
});