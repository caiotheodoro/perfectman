import { ModelIntentPacketJsonSchema } from "@perfectman/shared";
import type { AgentRuntimeInput } from "@perfectman/shared";
import type { AgentRuntimeContext, BuiltPrompt } from "../agent/agent-runtime.types.js";
import type { LLMConfig } from "./llm-config.js";
import type { LLMProvider, LLMProviderResult } from "./llm-provider.js";
import {
  LLMConfigurationError,
  LLMTimeoutError,
  LLMHttpError,
  LLMResponseError,
  LLMError,
} from "./llm-errors.js";

export class OpenAiCompatibleProvider implements LLMProvider {
  constructor(private readonly config: LLMConfig) {}

  async generateIntent(
    input: AgentRuntimeInput,
    context: AgentRuntimeContext,
    prompt: BuiltPrompt
  ): Promise<LLMProviderResult> {
    const startTime = Date.now();

    if (!this.config.baseUrl) {
      throw new LLMConfigurationError("Missing baseUrl for OpenAI-compatible provider.");
    }

    let apiKey: string | undefined = undefined;
    if (this.config.apiKeyEnv) {
      apiKey = process.env[this.config.apiKeyEnv];
      if (!apiKey) {
        throw new LLMConfigurationError(
          `API key environment variable '${this.config.apiKeyEnv}' is set but is not present in process.env.`
        );
      }
    }

    const normalizedBaseUrl = this.config.baseUrl.replace(/\/$/, "");
    const url = `${normalizedBaseUrl}/chat/completions`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const messages = [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ];

    const body: Record<string, any> = {
      model: this.config.modelName,
      messages,
      temperature: this.config.temperature,
      max_tokens: this.config.maxOutputTokens,
      ...this.config.extraBody,
    };

    // Shape-constrained decoding by default (packet JSON Schema); the tolerant
    // json_object mode is a fallback — automatic on a 400/422 below, or forced
    // via responseFormatJsonSchema:false for proxies that never accept schemas.
    let jsonObjectFallbackUsed = false;
    if (this.config.responseFormatJson) {
      if (this.config.responseFormatJsonSchema !== false) {
        body.response_format = {
          type: "json_schema",
          json_schema: { name: "intent_packet", schema: ModelIntentPacketJsonSchema, strict: false },
        };
      } else {
        body.response_format = { type: "json_object" };
      }
    }

    let attempts = 0;
    const maxAttempts = (this.config.retryCount ?? 0) + 1;

    while (attempts < maxAttempts) {
      attempts++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, this.config.timeoutMs || 10000);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          clearTimeout(timeoutId);
          const errorText = await response.text().catch(() => "Unknown error");
          // A 400/422 on a json_schema request usually means the proxy doesn't
          // support schema-constrained decoding — retry once as json_object.
          if (
            (response.status === 400 || response.status === 422) &&
            !jsonObjectFallbackUsed &&
            this.config.responseFormatJson &&
            this.config.responseFormatJsonSchema !== false
          ) {
            jsonObjectFallbackUsed = true;
            body.response_format = { type: "json_object" };
            attempts--; // retry with the fallback on this same budget slot
            continue;
          }
          throw new LLMHttpError(response.status, errorText);
        }

        // NOTE: the abort timer stays armed through the body read —
        // response.json() can hang on a slow stream after headers arrive,
        // and abort mid-stream is unreliable on some undici versions, so
        // race the body read against a hard timeout too.
        const deadline = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`body read timed out after ${this.config.timeoutMs}ms`)), this.config.timeoutMs || 10000),
        );
        const data = (await Promise.race([response.json(), deadline])) as any;
        clearTimeout(timeoutId);
        const content = data.choices?.[0]?.message?.content;
        if (content === undefined || content === null) {
          throw new LLMResponseError("Empty or missing content in OpenAI completion choices.");
        }

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key.toLowerCase()] = value;
        });

        const requestedModel = this.config.modelName;
        const routedModel = responseHeaders["x-routed-model"] || responseHeaders["x-routed-model-name"] || data.model || requestedModel;
        const fallbackAttempts = parseInt(responseHeaders["x-fallback-attempts"] || "0", 10);

        return {
          content,
          usage: {
            inputTokens: data.usage?.prompt_tokens ?? prompt.inputTokensEstimate ?? 0,
            outputTokens: data.usage?.completion_tokens ?? 0,
          },
          latencyMs: Date.now() - startTime,
          model: data.model ?? this.config.modelName,
          responseHeaders,
          requestedModel,
          routedModel,
          fallbackAttempts: fallbackAttempts > 0 ? fallbackAttempts : attempts - 1,
        };

      } catch (error: any) {
        clearTimeout(timeoutId);

        let resolvedError: Error;
        if (error.name === "AbortError") {
          resolvedError = new LLMTimeoutError(`Request timed out after ${this.config.timeoutMs}ms.`);
        } else if (error instanceof LLMError) {
          resolvedError = error;
        } else {
          resolvedError = new LLMError(error.message || "Unknown error occurred during fetch.", error);
        }

        const isTransient =
          resolvedError instanceof LLMTimeoutError ||
          (resolvedError instanceof LLMHttpError && (resolvedError.status === 429 || resolvedError.status >= 500)) ||
          !(resolvedError instanceof LLMConfigurationError || resolvedError instanceof LLMResponseError || resolvedError instanceof LLMHttpError);

        if (isTransient && attempts < maxAttempts) {
          // Retry
          continue;
        }

        throw resolvedError;
      }
    }

    throw new LLMError("Max retries exceeded without resolving error.");
  }
}
