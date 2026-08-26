import { z } from "zod";
import type { GoalLayerConfigSchema } from "./goal-layer-config.schema.js";

/**
 * Goal-layer config types — z.infer-derived from the schema (the
 * judge-config convention); the schema file is the single source of truth.
 */

export type GoalLayerConfig = z.infer<typeof GoalLayerConfigSchema>;

export type GoalLayerEndingConfig = NonNullable<GoalLayerConfig["ending"]>;

export type GoalLayerSynthesizerSection = NonNullable<
  GoalLayerConfig["synthesizer"]
>;

export type GoalLayerAcceptanceSection = NonNullable<
  GoalLayerConfig["acceptance"]
>;

export type DelusionWeightsByAgent = NonNullable<
  GoalLayerConfig["delusionWeightsByAgent"]
>;