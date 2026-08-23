/**
 * Judge AppConfig — the judge as a first-class config section.
 *
 * Mirrors the agent `LLMConfig` field vocabulary (same zod-parse pattern,
 * secrets by NAME through `apiKeyEnv`), so the same config file that
 * describes agents and channels also describes the judge. DeepSeek is NOT
 * a provider type — it is an openai-compatible endpoint in a file.
 */

export type JudgeProviderType = "openai-compatible" | "rule" | "mock";

/** Field parity with the server `LLMConfig` (minus agent-only token caps). */
export type JudgeConfigBase = {
  providerType: JudgeProviderType;
  baseUrl?: string;
  modelName: string;
  /** Name of the env var holding the secret — never the secret itself. */
  apiKeyEnv?: string;
  temperature?: number;
  timeoutMs?: number;
  retryCount?: number;
  responseFormatJson?: boolean;
};

/** One jury member. `label` is optional — the runtime defaults to judge-N. */
export type JudgeEntryConfig = JudgeConfigBase & {
  label?: string;
};

/** The `judge` section: the default judge plus an optional cross-family jury. */
export type JudgeAppConfig = JudgeConfigBase & {
  jury?: JudgeEntryConfig[];
};