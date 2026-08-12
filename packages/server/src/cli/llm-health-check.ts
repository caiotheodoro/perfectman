import type { SimulationAppConfig } from "../config/simulation-config.js";
import type { LlmConfig } from "../llm/llm-config.js";

type Fetch = typeof fetch;

export type FreellmApiHealthCheckDeps = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetch?: Fetch;
  timeoutMs?: number;
};

export async function assertRequiredLlmServicesAvailable(
  config: SimulationAppConfig,
  deps: FreellmApiHealthCheckDeps = {},
): Promise<void> {
  const freellmChecks = new Map<string, string | undefined>();
  const qwenChecks = new Map<string, LlmConfig>();

  for (const agent of config.agents) {
    if (!agent.llm.baseUrl) continue;
    if (agent.llm.providerType === "freellmapi") {
      freellmChecks.set(agent.llm.baseUrl, agent.llm.apiKeyEnv);
    }
    if (agent.llm.providerType === "qwen3_8b") {
      qwenChecks.set(`${agent.llm.baseUrl}|${agent.llm.modelName}`, agent.llm);
    }
  }

  for (const [baseUrl, apiKeyEnv] of freellmChecks) {
    await assertFreellmApiAvailable(baseUrl, apiKeyEnv, deps);
  }

  for (const llm of qwenChecks.values()) {
    await assertQwenAvailable(llm, deps);
  }
}

export async function assertFreellmApiAvailable(
  baseUrl: string,
  apiKeyEnv?: string,
  deps: FreellmApiHealthCheckDeps = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 1500;
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const url = `${normalizedBaseUrl}/models`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {};

  if (apiKeyEnv) {
    const apiKey = env[apiKeyEnv];
    if (!apiKey) {
      clearTimeout(timeoutId);
      throw new Error(
        `FreeLLMAPI key env var ${apiKeyEnv} is missing. ` +
          `Add it to .env after creating a unified key in the FreeLLMAPI dashboard.`,
      );
    }
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `FreeLLMAPI service is reachable at ${normalizedBaseUrl}, but the configured key was rejected with HTTP ${response.status}. ` +
            `Create or update the unified key in the FreeLLMAPI dashboard, then update ${apiKeyEnv ?? "the configured env var"}.`,
        );
      }
      throw new Error(`health check returned HTTP ${response.status}`);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (detail.startsWith("FreeLLMAPI service is reachable")) {
      throw new Error(detail);
    }
    throw new Error(
      `FreeLLMAPI service is not reachable at ${normalizedBaseUrl}. ` +
        `Run \`pnpm freellm:dev\` in another terminal, then retry. ` +
        `Details: ${detail}`,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function assertQwenAvailable(
  llm: LlmConfig,
  deps: FreellmApiHealthCheckDeps = {},
): Promise<void> {
  if (!llm.baseUrl) {
    throw new Error("Qwen baseUrl is missing.");
  }

  const fetchImpl = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? Math.max(10_000, Math.min(llm.timeoutMs, 60_000));
  const normalizedBaseUrl = llm.baseUrl.replace(/\/$/, "");
  const url = `${normalizedBaseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: llm.modelName,
        messages: [
          { role: "system", content: "Return only JSON." },
          { role: "user", content: "Return {\"ok\":true}." },
        ],
        temperature: 0,
        max_tokens: 8,
        stream: false,
        think: false,
        ...llm.extraBody,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`generation health check returned HTTP ${response.status}: ${detail.slice(0, 240)}`);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Qwen service is reachable only if it can complete a tiny generation at ${normalizedBaseUrl}. ` +
        `Run \`pnpm qwen:dev\` for the local model, or use \`pnpm qwen:dev:8b\` only when Docker has enough memory. ` +
        `Details: ${detail}`,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
