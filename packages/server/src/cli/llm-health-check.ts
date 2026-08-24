import type { SimulationAppConfig } from "../config/simulation-config.js";
import type { LLMConfig } from "../llm/llm-config.js";
import { resolveEndpointShape } from "../llm/provider-factory.js";

type Fetch = typeof fetch;

export type FreellmApiHealthCheckDeps = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetch?: Fetch;
  timeoutMs?: number;
};

export async function assertRequiredLLMServicesAvailable(
  config: SimulationAppConfig,
  deps: FreellmApiHealthCheckDeps = {},
): Promise<void> {
  const seen = new Map<string, LLMConfig>();
  for (const agent of config.agents) {
    if (!agent.llm.baseUrl) continue;
    // One tiny-generation probe per wire endpoint: the shape comes from the
    // factory's endpoint mapping, and the baseUrl|modelName pair identifies
    // the endpoint (two models behind one proxy are two endpoints).
    seen.set(
      `${resolveEndpointShape(agent.llm)}|${agent.llm.baseUrl}|${agent.llm.modelName}`,
      agent.llm,
    );
  }

  for (const llm of seen.values()) {
    await assertTinyGenerationAvailable(llm, deps);
  }
}

export async function assertFreellmApiAvailable(
  baseUrl: string,
  apiKeyEnv?: string,
  deps: FreellmApiHealthCheckDeps = {},
): Promise<void> {
  // Legacy export surface: FreeLLMAPI-style endpoints are OpenAI-compatible
  // shapes, so the shared tiny-generation probe applies. The placeholder
  // model name is irrelevant to a liveness check.
  await assertTinyGenerationAvailable(
    {
      providerType: "openai-compatible",
      baseUrl,
      apiKeyEnv,
      modelName: "health-probe",
      maxInputTokens: 0,
      maxOutputTokens: 8,
      temperature: 0,
      timeoutMs: 1500,
      retryCount: 0,
    },
    deps,
  );
}

export async function assertQwenAvailable(
  llm: LLMConfig,
  deps: FreellmApiHealthCheckDeps = {},
): Promise<void> {
  await assertTinyGenerationAvailable(llm, deps);
}

async function assertTinyGenerationAvailable(
  llm: LLMConfig,
  deps: FreellmApiHealthCheckDeps = {},
): Promise<void> {
  if (!llm.baseUrl) {
    throw new Error("Qwen baseUrl is missing.");
  }

  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? Math.max(10_000, Math.min(llm.timeoutMs, 60_000));
  const normalizedBaseUrl = llm.baseUrl.replace(/\/$/, "");
  const shape = resolveEndpointShape(llm);
  const url =
    shape === "ollama"
      ? `${normalizedBaseUrl.replace(/\/v1\/?$/, "")}/api/chat`
      : `${normalizedBaseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (llm.apiKeyEnv) {
    const apiKey = env[llm.apiKeyEnv];
    if (!apiKey) {
      clearTimeout(timeoutId);
      throw new Error(
        `API key env var ${llm.apiKeyEnv} is missing. ` +
          `Add it to .env and retry.`,
      );
    }
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const tinyPrompt = [
    { role: "system", content: "Return only JSON." },
    { role: "user", content: "Return {\"ok\":true}." },
  ];
  const body =
    shape === "ollama"
      ? JSON.stringify({
          model: llm.modelName,
          messages: tinyPrompt,
          temperature: 0,
          options: { num_predict: 8 },
          stream: false,
          think: false,
          ...llm.extraBody,
        })
      : JSON.stringify({
          model: llm.modelName,
          messages: tinyPrompt,
          temperature: 0,
          max_tokens: 8,
          stream: false,
          think: false,
          ...llm.extraBody,
        });

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`generation health check returned HTTP ${response.status}: ${detail.slice(0, 240)}`);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const prefix =
      `Qwen service is reachable only if it can complete a tiny generation at ${normalizedBaseUrl}. `;
    const hint =
      shape === "ollama"
        ? `Run \`pnpm qwen:dev\` for the local model, or use \`pnpm qwen:dev:8b\` only when Docker has enough memory. `
        : `Check the baseUrl, modelName, and API key, then retry. `;
    throw new Error(`${prefix}${hint}Details: ${detail}`);
  } finally {
    clearTimeout(timeoutId);
  }
}