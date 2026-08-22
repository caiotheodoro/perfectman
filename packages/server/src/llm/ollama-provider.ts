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

/**
 * Ollama native /api/chat provider.
 * Uses the native Ollama API instead of the OpenAI-compatible /v1/chat/completions endpoint
 * so that think: false is correctly respected for Qwen3 models.
 */
export class OllamaProvider implements LLMProvider {
  constructor(private readonly config: LLMConfig) {}

  async generateIntent(
    input: AgentRuntimeInput,
    context: AgentRuntimeContext,
    prompt: BuiltPrompt
  ): Promise<LLMProviderResult> {
    const startTime = Date.now();

    if (!this.config.baseUrl) {
      throw new LLMConfigurationError("Missing baseUrl for Ollama provider.");
    }

    // Derive the native API URL from the base URL (strip /v1 suffix if present)
    const normalizedBase = this.config.baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
    const url = `${normalizedBase}/api/chat`;

    const messages = [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ];

    const { extraBody = {} } = this.config;
    const {
      think,
      options: extraOptions,
      // top_p/repetition_penalty/seed are populated at the top level of
      // extraBody by persona-loader.ts and scenario-runner.ts (matching the
      // OpenAI-compatible provider's flat-body convention). Ollama's native
      // /api/chat only reads sampling params from a nested `options` object,
      // and its repetition-penalty key is `repeat_penalty`, not
      // `repetition_penalty` — pull both out here and translate them instead
      // of letting them fall into restExtra and get silently dropped on the
      // request body root. `seed` gets the same treatment so benchmark runs
      // can pin model sampling determinism.
      top_p,
      repetition_penalty,
      seed,
      ...restExtra
    } = extraBody as {
      think?: boolean;
      options?: Record<string, unknown>;
      top_p?: number;
      repetition_penalty?: number;
      seed?: number;
      [key: string]: unknown;
    };

    const ollamaOptions: Record<string, unknown> = {
      num_predict: this.config.maxOutputTokens,
      temperature: this.config.temperature,
      ...(top_p !== undefined ? { top_p } : {}),
      ...(repetition_penalty !== undefined ? { repeat_penalty: repetition_penalty } : {}),
      ...(seed !== undefined ? { seed } : {}),
      ...extraOptions,
    };

    const body: Record<string, unknown> = {
      model: this.config.modelName,
      messages,
      stream: false,
      options: ollamaOptions,
      ...restExtra,
    };

    if (think !== undefined) {
      body.think = think;
    }

    if (this.config.responseFormatJson) {
      // Constrained decoding: shape is enforced by the intent-packet JSON
      // Schema instead of the now-removed prose contract in the prompt.
      body.format = ModelIntentPacketJsonSchema;
    }

    let attempts = 0;
    const maxAttempts = (this.config.retryCount ?? 0) + 1;
    let jsonFormatFallbackUsed = false;

    while (attempts < maxAttempts) {
      attempts++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs || 10_000);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          clearTimeout(timeoutId);
          const errorText = await response.text().catch(() => "Unknown error");
          // A 400/422 on the schema-constrained format usually means this
          // Ollama build doesn't support schema decoding — retry once as the
          // universally-supported plain "json" format (parser still enforces shape).
          if (
            (response.status === 400 || response.status === 422) &&
            !jsonFormatFallbackUsed &&
            this.config.responseFormatJson
          ) {
            jsonFormatFallbackUsed = true;
            body.format = "json";
            attempts--; // retry with the fallback on this same budget slot
            continue;
          }
          throw new LLMHttpError(response.status, errorText);
        }

        const data = (await response.json()) as any;
        const content = data.message?.content;

        if (content === undefined || content === null) {
          throw new LLMResponseError("Empty or missing content in Ollama response.");
        }

        const promptTokens = data.prompt_eval_count ?? prompt.inputTokensEstimate ?? 0;
        const outputTokens = data.eval_count ?? 0;

        return {
          content,
          usage: { inputTokens: promptTokens, outputTokens },
          latencyMs: Date.now() - startTime,
          model: data.model ?? this.config.modelName,
          responseHeaders: {},
          requestedModel: this.config.modelName,
          routedModel: this.config.modelName,
          fallbackAttempts: attempts - 1,
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

        if (isTransient && attempts < maxAttempts) continue;
        throw resolvedError;
      }
    }

    throw new LLMError("Max retries exceeded without resolving error.");
  }
}
