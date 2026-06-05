import type { AgentRuntimeInput } from "@perfectman/shared";
import type { AgentRuntimeContext, BuiltPrompt } from "../agent/agent-runtime.types.js";
import type { LlmConfig } from "./llm-config.js";
import type { LlmProvider, LlmProviderResult } from "./llm-provider.js";
import {
  LlmConfigurationError,
  LlmTimeoutError,
  LlmHttpError,
  LlmResponseError,
  LlmError,
} from "./llm-errors.js";

/**
 * Ollama native /api/chat provider.
 * Uses the native Ollama API instead of the OpenAI-compatible /v1/chat/completions endpoint
 * so that think: false is correctly respected for Qwen3 models.
 */
export class OllamaProvider implements LlmProvider {
  constructor(private readonly config: LlmConfig) {}

  async generateIntent(
    input: AgentRuntimeInput,
    context: AgentRuntimeContext,
    prompt: BuiltPrompt
  ): Promise<LlmProviderResult> {
    const startTime = Date.now();

    if (!this.config.baseUrl) {
      throw new LlmConfigurationError("Missing baseUrl for Ollama provider.");
    }

    // Derive the native API URL from the base URL (strip /v1 suffix if present)
    const normalizedBase = this.config.baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
    const url = `${normalizedBase}/api/chat`;

    const messages = [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ];

    const { extraBody = {} } = this.config;
    const { think, options: extraOptions, ...restExtra } = extraBody as {
      think?: boolean;
      options?: Record<string, unknown>;
      [key: string]: unknown;
    };

    const ollamaOptions: Record<string, unknown> = {
      num_predict: this.config.maxOutputTokens,
      temperature: this.config.temperature,
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
      body.format = "json";
    }

    let attempts = 0;
    const maxAttempts = (this.config.retryCount ?? 0) + 1;

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
          const errorText = await response.text().catch(() => "Unknown error");
          throw new LlmHttpError(response.status, errorText);
        }

        const data = (await response.json()) as any;
        const content = data.message?.content;

        if (content === undefined || content === null) {
          throw new LlmResponseError("Empty or missing content in Ollama response.");
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
          resolvedError = new LlmTimeoutError(`Request timed out after ${this.config.timeoutMs}ms.`);
        } else if (error instanceof LlmError) {
          resolvedError = error;
        } else {
          resolvedError = new LlmError(error.message || "Unknown error occurred during fetch.", error);
        }

        const isTransient =
          resolvedError instanceof LlmTimeoutError ||
          (resolvedError instanceof LlmHttpError && (resolvedError.status === 429 || resolvedError.status >= 500)) ||
          !(resolvedError instanceof LlmConfigurationError || resolvedError instanceof LlmResponseError || resolvedError instanceof LlmHttpError);

        if (isTransient && attempts < maxAttempts) continue;
        throw resolvedError;
      }
    }

    throw new LlmError("Max retries exceeded without resolving error.");
  }
}
