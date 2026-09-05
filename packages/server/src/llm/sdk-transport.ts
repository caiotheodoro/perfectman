import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Ollama, type ChatRequest } from "ollama";
import { APICallError, type JSONSchema7 } from "ai";
import { ModelIntentPacketJsonSchema } from "@perfectman/shared";
import type { BuiltPrompt } from "../agent/agent-runtime.types.js";
import type { LLMConfig } from "./llm-config.js";
import type { LLMProviderResult } from "./llm-provider.js";
import {
  LLMConfigurationError,
  LLMError,
  LLMHttpError,
  LLMResponseError,
  LLMTimeoutError,
} from "./llm-errors.js";

/**
 * The single seam that confines the external AI provider SDKs (Vercel AI SDK
 * OpenAI-compatible provider + the official Ollama SDK) to one module. Both
 * provider facades delegate here; the eval judge/narrator path reuses the
 * exported functions over the server package boundary. All SDK-specific
 * request-shape translation, retry/dual-timeout handling, response-header
 * capture, and SDK-error → LLMError translation lives in this file so that
 * removing the SDKs means deleting this module and the package.json entries.
 */
export type LlmTransportDeps = {
  /** Injectable fetch (test seam). Defaults to globalThis.fetch at call time. */
  fetch?: typeof fetch;
  /** Injectable process environment, resolved at call time. */
  env?: NodeJS.ProcessEnv;
};

const DEFAULT_TIMEOUT_MS = 10_000;

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

function resolveFetch(deps?: LlmTransportDeps): typeof fetch {
  return deps?.fetch ?? globalThis.fetch;
}

function resolveEnv(deps?: LlmTransportDeps): NodeJS.ProcessEnv {
  return deps?.env ?? process.env;
}

function isTransientError(error: LLMError): boolean {
  return (
    error instanceof LLMTimeoutError ||
    (error instanceof LLMHttpError && (error.status === 429 || error.status >= 500)) ||
    !(
      error instanceof LLMConfigurationError ||
      error instanceof LLMResponseError ||
      error instanceof LLMHttpError
    )
  );
}

/**
 * Dual timeout: an abort timer that stays armed through the body read (some
 * runtimes swallow mid-stream aborts, so the fetch is never allowed to hang
 * on a slow body), plus explicit deadline races on the fetch and on the
 * body-read path. Both halves surface as AbortError so the SDKs rethrow them
 * untouched and the seam maps them to LLMTimeoutError. The body deadline
 * covers the entire body consumption — releasing it at the first chunk
 * would let a body that stalls mid-stream hang forever.
 */
function withDualTimeout(fetchImpl: typeof fetch, timeoutMs: number): typeof fetch {
  function deadline(): { promise: Promise<never>; clear: () => void } {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new DOMException("The user aborted a request.", "AbortError")),
        timeoutMs,
      );
    });
    return { promise, clear: () => clearTimeout(timer) };
  }

  function guardBodyRead(
    response: Response,
    abortTimer: ReturnType<typeof setTimeout>,
    bodyDeadline: ReturnType<typeof deadline>,
  ): Response {
    if (!response.body) {
      clearTimeout(abortTimer);
      bodyDeadline.clear();
      return response;
    }

    // Built lazily: constructing a ReadableStream with a pull callback starts
    // pulling immediately, which would consume the underlying response body
    // before the SDK's own json()/text() consumption on the non-stream path.
    let guardedBody: ReadableStream<Uint8Array> | undefined;
    const buildGuardedBody = () => {
      const reader = response.body!.getReader();
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          return Promise.race([reader.read(), bodyDeadline.promise]).then(
            ({ done, value }) => {
              if (done) {
                // The deadline covers the whole body read: timers release
                // only when the body ends (done/error/cancel), so a stall
                // between chunks still races the deadline.
                bodyDeadline.clear();
                clearTimeout(abortTimer);
                controller.close();
              } else {
                controller.enqueue(value);
              }
            },
            (error: unknown) => {
              bodyDeadline.clear();
              clearTimeout(abortTimer);
              controller.error(error);
            },
          );
        },
        cancel(reason) {
          bodyDeadline.clear();
          clearTimeout(abortTimer);
          return reader.cancel(reason);
        },
      });
    };

    return new Proxy(response, {
      get(target, prop, receiver) {
        if (prop === "body") {
          guardedBody ??= buildGuardedBody();
          return guardedBody;
        }
        if (prop === "json" || prop === "text" || prop === "arrayBuffer") {
          const original = (Reflect.get(target, prop, receiver) as Function).bind(target);
          return (...args: unknown[]) =>
            Promise.race([original(...args), bodyDeadline.promise]).then(
              (value) => {
                bodyDeadline.clear();
                clearTimeout(abortTimer);
                return value;
              },
              (error: unknown) => {
                bodyDeadline.clear();
                clearTimeout(abortTimer);
                throw error;
              },
            );
        }
        // Getters inherited from Response.prototype (headers, status, ok, ...)
        // read native private fields via `this`. Forwarding `receiver` (this
        // Proxy) as `this` throws "Cannot read private member ... whose class
        // did not declare it" — the getter only works invoked on the real
        // `target`, so `receiver` is never passed through here.
        return Reflect.get(target, prop, target);
      },
    });
  }

  return async (input, init) => {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
    const requestDeadline = deadline();

    let response: Response;
    try {
      response = await Promise.race([
        fetchImpl(input, { ...init, signal: controller.signal }),
        requestDeadline.promise,
      ]);
    } catch (error) {
      requestDeadline.clear();
      clearTimeout(abortTimer);
      throw error;
    }
    requestDeadline.clear();
    return guardBodyRead(response, abortTimer, deadline());
  };
}

function captureResponseHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const captured: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    captured[key.toLowerCase()] = value;
  }
  return captured;
}

/**
 * The OpenAI-compatible `POST .../chat/completions` request body, assembled
 * from an LLMConfig in one place so the startup health probe and the runtime
 * intent call cannot drift on their reasoning- and sampling-control fields.
 * `extraBody` is spread onto the root the same way the SDK does at runtime
 * (`providerOptions["openai-compatible"]`), so an operator's reasoning-disable
 * entry (DeepSeek's `{ thinking: { type: "disabled" } }`) reaches the wire
 * unchanged. Injects no reasoning field of its own. Callers override only
 * `maxOutputTokens` — the probe caps it low; every other field comes from the
 * real config.
 */
export function buildOpenAiCompatibleRequestBody(
  config: LLMConfig,
  messages: Array<{ role: string; content: string }>,
  maxOutputTokens: number,
): Record<string, unknown> {
  return {
    model: config.modelName,
    messages,
    stream: false,
    max_tokens: maxOutputTokens,
    temperature: config.temperature,
    ...config.extraBody,
  };
}

export async function generateOpenAiCompatibleIntent(
  config: LLMConfig,
  prompt: BuiltPrompt,
  startTime: number,
  deps?: LlmTransportDeps,
): Promise<LLMProviderResult> {
  if (!config.baseUrl) {
    throw new LLMConfigurationError("Missing baseUrl for OpenAI-compatible provider.");
  }

  const env = resolveEnv(deps);
  let apiKey: string | undefined;
  if (config.apiKeyEnv) {
    apiKey = env[config.apiKeyEnv];
    if (!apiKey) {
      throw new LLMConfigurationError(
        `API key environment variable '${config.apiKeyEnv}' is set but is not present in process.env.`,
      );
    }
  }

  const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
  const fetchWithTimeout = withDualTimeout(resolveFetch(deps), timeoutMs);
  const baseURL = config.baseUrl.replace(/\/$/, "");

  const providerOptions = {
    "openai-compatible": { strictJsonSchema: false, ...config.extraBody },
  };

  // Two model handles: the strict one wires response_format.json_schema (with
  // the intent-packet schema); the tolerant one wires json_object. A 400/422
  // on the strict handle flips to the tolerant one on the same budget slot,
  // mirroring the pre-SDK provider behavior.
  const buildModel = (supportsStructuredOutputs: boolean) =>
    createOpenAICompatible({
      baseURL,
      name: "openai-compatible",
      apiKey,
      fetch: fetchWithTimeout,
      supportsStructuredOutputs,
    }).languageModel(config.modelName);

  const strictModel = buildModel(true);
  const tolerantModel = buildModel(false);

  const messages: Array<
    | { role: "system"; content: string }
    | { role: "user"; content: Array<{ type: "text"; text: string }> }
  > = [
    { role: "system", content: prompt.system },
    { role: "user", content: [{ type: "text", text: prompt.user }] },
  ];

  const schemaMode = config.responseFormatJson === true && config.responseFormatJsonSchema !== false;

  let attempts = 0;
  const maxAttempts = (config.retryCount ?? 0) + 1;
  let jsonObjectFallbackUsed = false;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const schemaAttempt = schemaMode && !jsonObjectFallbackUsed;
      const result = await (schemaAttempt ? strictModel : tolerantModel).doGenerate({
        prompt: messages,
        maxOutputTokens: config.maxOutputTokens,
        temperature: config.temperature,
        responseFormat: schemaAttempt
          ? {
              type: "json",
              schema: ModelIntentPacketJsonSchema as unknown as JSONSchema7,
              name: "intent_packet",
            }
          : config.responseFormatJson
            ? { type: "json" }
            : { type: "text" },
        providerOptions,
      });

      const data = (result.response?.body ?? {}) as {
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };
      const content = data.choices?.[0]?.message?.content;
      if (content === undefined || content === null) {
        throw new LLMResponseError("Empty or missing content in OpenAI completion choices.");
      }

      const responseHeaders = captureResponseHeaders(result.response?.headers as Record<string, string> | undefined);
      const requestedModel = config.modelName;
      const routedModel =
        responseHeaders["x-routed-model"] ||
        responseHeaders["x-routed-model-name"] ||
        data.model ||
        requestedModel;
      const fallbackFromHeader = parseInt(responseHeaders["x-fallback-attempts"] || "0", 10);

      return {
        content,
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? prompt.inputTokensEstimate ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
        },
        latencyMs: Date.now() - startTime,
        model: data.model ?? config.modelName,
        responseHeaders,
        requestedModel,
        routedModel,
        fallbackAttempts: fallbackFromHeader > 0 ? fallbackFromHeader : attempts - 1,
      };
    } catch (error) {
      let resolvedError: Error;
      if (isAbortError(error)) {
        resolvedError = new LLMTimeoutError(`Request timed out after ${timeoutMs}ms.`);
      } else if (error instanceof APICallError) {
        // A 400/422 on a json_schema request means the proxy does not support
        // schema-constrained decoding — retry once as json_object on this same
        // budget slot (the schema still validates locally in the parser). 503
        // is included on the same evidence: OrcaRouter's free deepseek-v4
        // route consistently 503s ("upstream provider is temporarily
        // unavailable") on a strict schema request while the identical
        // request as json_object succeeds — some free-tier backends reject
        // schema-constrained decoding via 503 instead of 400/422.
        if (
          (error.statusCode === 400 || error.statusCode === 422 || error.statusCode === 503) &&
          schemaMode &&
          !jsonObjectFallbackUsed
        ) {
          jsonObjectFallbackUsed = true;
          attempts--;
          continue;
        }
        resolvedError =
          error.statusCode !== undefined && error.statusCode >= 400
            ? new LLMHttpError(error.statusCode, error.message)
            : new LLMError(error.message || "Unknown error occurred during fetch.", error);
      } else if (error instanceof TypeError) {
        // The SDK's own choices[0] content extraction throws a TypeError on an
        // empty choices array — surface the same failure the provider used to
        // report from its hand-rolled parse.
        //
        // Any *other* client-side TypeError (a bad argument, a runtime/undici
        // mismatch, a stubbed fetch the SDK cannot consume) is not an empty
        // completion, and relabelling it as one turns a real client bug into a
        // fabricated model failure — the transport-layer version of narrating
        // an engine error as content. Keep the original message and cause so
        // the distinction survives into the operator log.
        resolvedError = new LLMResponseError(
          `Empty or missing content in OpenAI completion choices. (underlying TypeError: ${error.message})`,
          error,
        );
      } else if (error instanceof LLMError) {
        resolvedError = error;
      } else {
        resolvedError = new LLMError(
          error instanceof Error ? error.message : "Unknown error occurred during fetch.",
          error,
        );
      }

      if (isTransientError(resolvedError) && attempts < maxAttempts) {
        continue;
      }
      throw resolvedError;
    }
  }

  throw new LLMError("Max retries exceeded without resolving error.");
}

type OllamaResponseError = Error & { status_code: number };

function isOllamaResponseError(error: unknown): error is OllamaResponseError {
  return error instanceof Error && typeof (error as OllamaResponseError).status_code === "number";
}

export async function generateOllamaIntent(
  config: LLMConfig,
  prompt: BuiltPrompt,
  startTime: number,
  deps?: LlmTransportDeps,
): Promise<LLMProviderResult> {
  if (!config.baseUrl) {
    throw new LLMConfigurationError("Missing baseUrl for Ollama provider.");
  }

  const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
  const fetchWithTimeout = withDualTimeout(resolveFetch(deps), timeoutMs);

  // The Ollama SDK appends /api/chat to its host; strip an optional /v1 suffix
  // so OpenAI-compatible-shaped baseUrls still resolve to the native endpoint.
  const host = config.baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const client = new Ollama({ host, fetch: fetchWithTimeout });

  const messages = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ];

  const { extraBody = {} } = config;
  const {
    think,
    options: extraOptions,
    // top_p/repetition_penalty/seed arrive flat in extraBody by convention
    // (matching the OpenAI-compatible provider's flat-body shape). Ollama's
    // native /api/chat only reads sampling params from a nested `options`
    // object and spells repetition penalty `repeat_penalty` — translate here
    // instead of letting them leak onto the request root.
    top_p,
    repetition_penalty,
    seed,
    ...restExtra
  } = extraBody as {
    think?: boolean | "high" | "medium" | "low";
    options?: Record<string, unknown>;
    top_p?: number;
    repetition_penalty?: number;
    seed?: number;
    [key: string]: unknown;
  };

  const ollamaOptions: Record<string, unknown> = {
    num_predict: config.maxOutputTokens,
    temperature: config.temperature,
    ...(top_p !== undefined ? { top_p } : {}),
    ...(repetition_penalty !== undefined ? { repeat_penalty: repetition_penalty } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...extraOptions,
  };

  const baseRequest: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    options: Record<string, unknown>;
    [key: string]: unknown;
  } = {
    model: config.modelName,
    messages,
    options: ollamaOptions,
    ...restExtra,
  };

  let attempts = 0;
  const maxAttempts = (config.retryCount ?? 0) + 1;
  let jsonFormatFallbackUsed = false;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const schemaAttempt = config.responseFormatJson === true && !jsonFormatFallbackUsed;
      const request = {
        ...baseRequest,
        ...(think !== undefined ? { think } : {}),
        ...(schemaAttempt
          ? { format: ModelIntentPacketJsonSchema }
          : config.responseFormatJson === true
            ? { format: "json" as const }
            : {}),
      };
      const data = (await client.chat(request)) as {
        message?: { content?: string | null };
        model?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };

      const content = data.message?.content;
      if (content === undefined || content === null) {
        throw new LLMResponseError("Empty or missing content in Ollama response.");
      }

      return {
        content,
        usage: {
          inputTokens: data.prompt_eval_count ?? prompt.inputTokensEstimate ?? 0,
          outputTokens: data.eval_count ?? 0,
        },
        latencyMs: Date.now() - startTime,
        model: data.model ?? config.modelName,
        responseHeaders: {},
        requestedModel: config.modelName,
        routedModel: config.modelName,
        fallbackAttempts: attempts - 1,
      };
    } catch (error) {
      let resolvedError: Error;
      if (isAbortError(error)) {
        resolvedError = new LLMTimeoutError(`Request timed out after ${timeoutMs}ms.`);
      } else if (isOllamaResponseError(error)) {
        // A 400/422 on the schema-constrained format usually means this
        // Ollama build does not support schema decoding — retry once as the
        // universally-supported plain "json" format on this same budget slot.
        if (
          (error.status_code === 400 || error.status_code === 422) &&
          config.responseFormatJson === true &&
          !jsonFormatFallbackUsed
        ) {
          jsonFormatFallbackUsed = true;
          attempts--;
          continue;
        }
        resolvedError = new LLMHttpError(error.status_code, error.message);
      } else if (error instanceof LLMError) {
        resolvedError = error;
      } else {
        resolvedError = new LLMError(
          error instanceof Error ? error.message : "Unknown error occurred during fetch.",
          error,
        );
      }

      if (isTransientError(resolvedError) && attempts < maxAttempts) {
        continue;
      }
      throw resolvedError;
    }
  }

  throw new LLMError("Max retries exceeded without resolving error.");
}