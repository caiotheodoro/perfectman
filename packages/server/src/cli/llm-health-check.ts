import type { SimulationAppConfig } from "../config/simulation-config.js";

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
  const checks = new Map<string, string | undefined>();
  for (const agent of config.agents) {
    if (agent.llm.providerType !== "freellmapi" || !agent.llm.baseUrl) continue;
    checks.set(agent.llm.baseUrl, agent.llm.apiKeyEnv);
  }

  for (const [baseUrl, apiKeyEnv] of checks) {
    await assertFreellmApiAvailable(baseUrl, apiKeyEnv, deps);
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
