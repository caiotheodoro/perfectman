/**
 * Judge config loader — file > section > env > defaults.
 *
 * The judge is now a first-class config section (same schema the agents
 * use), so the eval CLIs resolve it the same way the server does:
 *   1. `--judge-config <path>` — an explicit standalone judge config,
 *   2. the `judge` section of the walk-up `config/index.json`,
 *   3. environment (`PERFECTMAN_JUDGE_BASE_URL`/`MODEL`/`TEMPERATURE`,
 *      `PERFECTMAN_LLM_*`, the `deepseek` endpoint shortcut),
 *   4. defaults (local qwen3 endpoint, bench temperature 1.0 / calibration
 *      temperature 0).
 * The env tier is byte-identical to the pre-pivot `judgeConfig()` — zero
 * file + env only behaves exactly as before. Secrets resolve by NAME via
 * `apiKeyEnv` (the agent pattern); the runtime `LLMJudgeConfig` shape is
 * unchanged.
 */

import {
  getJudgeConfigPath,
  loadJudgeConfig as loadJudgeConfigFile,
  loadJudgeSectionFromSimulationConfig,
} from "@perfectman/server";
import type { JudgeAppConfig, JudgeConfigBase, JudgeProviderType } from "@perfectman/shared";
import type { LLMJudgeConfig } from "../judge/judge.js";

export type JudgeConfigLoaderOptions = {
  /** Default temperature when neither file nor env sets one (bench: 1.0, calibration: 0). */
  defaultTemperature?: number;
  /** Walk-up start for the config/index.json section tier (tests). */
  cwd?: string;
};

export type ResolvedJudgeConfig = {
  providerType: JudgeProviderType;
  /** The endpoint config — always resolved, used by the openai-compatible path. */
  config: LLMJudgeConfig;
  /** The file's cross-family jury, resolved through the same defaults. */
  jury?: Array<LLMJudgeConfig & { label?: string }>;
};

type EnvJudgeDefaults = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature: number;
  timeoutMs: number;
};

function envJudgeDefaults(defaultTemperature: number): EnvJudgeDefaults {
  const provider = process.env.PERFECTMAN_LLM_PROVIDER ?? "local";
  const isDeepseek = provider === "deepseek";
  // Empty/unset → default; only an explicit numeric value (incl. "0") wins.
  const tempRaw = Number(process.env.PERFECTMAN_JUDGE_TEMPERATURE);
  const tempSet =
    process.env.PERFECTMAN_JUDGE_TEMPERATURE !== undefined &&
    process.env.PERFECTMAN_JUDGE_TEMPERATURE.trim() !== "";
  return {
    baseUrl:
      process.env.PERFECTMAN_JUDGE_BASE_URL ??
      process.env.PERFECTMAN_LLM_BASE_URL ??
      (isDeepseek ? "https://api.deepseek.com/v1" : "http://localhost:11434/v1"),
    model:
      process.env.PERFECTMAN_JUDGE_MODEL ??
      process.env.PERFECTMAN_LLM_MODEL ??
      (isDeepseek ? "deepseek-chat" : "qwen3:8b"),
    apiKey: process.env.PERFECTMAN_LLM_API_KEY,
    temperature: tempSet && Number.isFinite(tempRaw) ? tempRaw : defaultTemperature,
    timeoutMs: 90000,
  };
}

function resolveEntry(
  entry: JudgeConfigBase,
  envDefaults: EnvJudgeDefaults,
): LLMJudgeConfig {
  return {
    baseUrl: entry.baseUrl ?? envDefaults.baseUrl,
    model: entry.modelName,
    apiKey: entry.apiKeyEnv ? process.env[entry.apiKeyEnv] : envDefaults.apiKey,
    temperature: entry.temperature ?? envDefaults.temperature,
    timeoutMs: entry.timeoutMs ?? envDefaults.timeoutMs,
    retryCount: entry.retryCount,
  };
}

export async function loadJudgeConfig(
  args: string[],
  options: JudgeConfigLoaderOptions = {},
): Promise<ResolvedJudgeConfig> {
  const cwd = options.cwd ?? process.cwd();
  const envDefaults = envJudgeDefaults(options.defaultTemperature ?? 1.0);

  const explicitPath = getJudgeConfigPath(args, cwd);
  const appConfig =
    explicitPath !== undefined
      ? await loadJudgeConfigFile(explicitPath)
      : await loadJudgeSectionFromSimulationConfig(cwd);

  if (appConfig !== undefined) {
    return {
      providerType: appConfig.providerType,
      config: resolveEntry(appConfig, envDefaults),
      jury: appConfig.jury?.map((entry) => ({
        ...resolveEntry(entry, envDefaults),
        label: entry.label,
      })),
    };
  }

  // env tier — and with a clean env, the defaults tier. Provider type is
  // "rule" (the offline default of every eval CLI); `--judge llm` flips it.
  return {
    providerType: "rule",
    config: {
      baseUrl: envDefaults.baseUrl,
      model: envDefaults.model,
      apiKey: envDefaults.apiKey,
      temperature: envDefaults.temperature,
      timeoutMs: envDefaults.timeoutMs,
    },
  };
}

/**
 * The `--judge rule|llm` CLI flag as a shorthand override of the resolved
 * `providerType`: "llm" → openai-compatible, "rule" → rule, absent → the
 * file-driven value (rule when no file describes the judge).
 */
export function applyJudgeShorthand(
  resolved: ResolvedJudgeConfig,
  flag: string | undefined,
): JudgeProviderType {
  if (flag === "llm") return "openai-compatible";
  if (flag === "rule") return "rule";
  return resolved.providerType;
}