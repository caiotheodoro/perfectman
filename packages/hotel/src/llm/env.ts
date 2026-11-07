import type { LLMConfig } from "@perfectman/server/hotel";
import type { LlmEnv } from "../config.js";

/** Prompt-size and latency envelope of a hotel pulse (D53: p95 <= 6 s at 12 agents, 40 events). */
export const LLM_P95_BUDGET_MS = 6000;
export const GENERATE_DEADLINE_MS = 20_000;

export class ModelNotAllowedError extends Error {
  constructor(readonly model: string, readonly allowed: readonly string[]) {
    super(`Model "${model}" is not in PERFECTMAN_LLM_MODELS (${allowed.join(", ")})`);
    this.name = "ModelNotAllowedError";
  }
}

/**
 * The `LLMConfig` every actor gets, built from the host's env and nowhere else
 * (D16): never from the scenario or the browser. `apiKeyEnv` is the NAME of the
 * variable, as the schema requires.
 */
export function hostLlmConfig(env: LlmEnv, requestedModel?: string): LLMConfig {
  const modelName = requestedModel ?? env.models[0] ?? "mock";
  if (env.provider === "openai-compatible" && !env.models.includes(modelName)) {
    throw new ModelNotAllowedError(modelName, env.models);
  }
  return {
    providerType: env.provider === "mock" ? "mock" : "openai-compatible",
    ...(env.provider === "mock" ? {} : { baseUrl: env.baseUrl, apiKeyEnv: env.apiKeyEnv }),
    modelName,
    maxInputTokens: 6000,
    maxOutputTokens: 400,
    temperature: 0.8,
    timeoutMs: GENERATE_DEADLINE_MS,
    retryCount: 1,
    responseFormatJson: true,
    responseFormatJsonSchema: true,
  };
}

/** One tiny completion: the health check at run start and the breaker's half-open probe. */
export async function pingLlm(
  config: LLMConfig,
  apiKey: string | undefined,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
): Promise<boolean> {
  if (config.providerType === "mock") return true;
  if (!config.baseUrl) return false;
  try {
    const res = await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model: config.modelName, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
