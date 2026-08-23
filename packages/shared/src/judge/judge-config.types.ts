import { z } from "zod";
import {
  JudgeAppConfigSchema,
  JudgeConfigBaseSchema,
  JudgeEntryConfigSchema,
  JudgeProviderTypeSchema,
} from "./judge-config.schema.js";

/**
 * Judge AppConfig — the judge as a first-class config section.
 *
 * Mirrors the agent `LLMConfig` field vocabulary (same zod-parse pattern,
 * secrets by NAME through `apiKeyEnv`), so the same config file that
 * describes agents and channels also describes the judge. DeepSeek is NOT
 * a provider type — it is an openai-compatible endpoint in a file.
 *
 * Types are z.infer-derived from the schemas (the intent-packet
 * convention); the schema file is the single source of truth.
 */

export type JudgeProviderType = z.infer<typeof JudgeProviderTypeSchema>;

/** Field parity with the server `LLMConfig` (minus agent-only token caps). */
export type JudgeConfigBase = z.infer<typeof JudgeConfigBaseSchema>;

/** One jury member. `label` is optional — the runtime defaults to judge-N. */
export type JudgeEntryConfig = z.infer<typeof JudgeEntryConfigSchema>;

/** The `judge` section: the default judge plus an optional cross-family jury. */
export type JudgeAppConfig = z.infer<typeof JudgeAppConfigSchema>;
