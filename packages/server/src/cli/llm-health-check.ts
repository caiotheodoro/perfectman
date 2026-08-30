import type { SimulationAppConfig } from "../config/simulation-config.js";
import type { LLMConfig } from "../llm/llm-config.js";
import { resolveEndpointShape } from "../llm/provider-factory.js";
import { buildOpenAiCompatibleRequestBody } from "../llm/sdk-transport.js";

type Fetch = typeof fetch;

const PROBE_MAX_OUTPUT_TOKENS = 8;

/**
 * Marks a probe failure that already carries an actionable cause+fix message.
 * The generic catch in `assertTinyGenerationAvailable` rethrows it unwrapped so
 * the reasoning-overflow guidance is not buried behind the "check your API key"
 * hint.
 */
class ReasoningOverflowError extends Error {}

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
      : JSON.stringify(
          buildOpenAiCompatibleRequestBody(llm, tinyPrompt, PROBE_MAX_OUTPUT_TOKENS),
        );

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

    if (shape !== "ollama") {
      const raw = await response.text().catch(() => "");
      let content: unknown;
      try {
        content = (
          JSON.parse(raw) as { choices?: Array<{ message?: { content?: unknown } }> }
        )?.choices?.[0]?.message?.content;
      } catch {
        content = undefined;
      }
      if (typeof content !== "string" || !hasParseableJsonObject(content)) {
        throw new ReasoningOverflowError(
          `The tiny generation at ${normalizedBaseUrl} returned an OK response with no parseable ` +
            `JSON object. The likely cause is that model reasoning is not disabled, so the reasoning ` +
            `block consumed the ${PROBE_MAX_OUTPUT_TOKENS}-token budget before any JSON was emitted. ` +
            `Add a reasoning-disable entry to the agent's llm.extraBody — for DeepSeek: ` +
            `{ "thinking": { "type": "disabled" } }.`,
        );
      }
    }
  } catch (err) {
    if (err instanceof ReasoningOverflowError) {
      throw err;
    }
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

function hasParseableJsonObject(s: string): boolean {
  const trimmed = s.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}