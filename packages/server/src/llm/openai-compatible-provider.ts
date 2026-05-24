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

export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(private readonly config: LlmConfig) {}

  async generateIntent(
    input: AgentRuntimeInput,
    context: AgentRuntimeContext,
    prompt: BuiltPrompt
  ): Promise<LlmProviderResult> {
    const startTime = Date.now();

    if (!this.config.baseUrl) {
      throw new LlmConfigurationError("Missing baseUrl for OpenAI-compatible provider.");
    }

    let apiKey: string | undefined = undefined;
    if (this.config.apiKeyEnv) {
      apiKey = process.env[this.config.apiKeyEnv];
      if (!apiKey) {
        throw new LlmConfigurationError(
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

    if (this.config.responseFormatJson) {
      body.response_format = { type: "json_object" };
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

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text().catch(() => "Unknown error");
          throw new LlmHttpError(response.status, errorText);
        }

        const data = (await response.json()) as any;
        const content = data.choices?.[0]?.message?.content;
        if (content === undefined || content === null) {
          throw new LlmResponseError("Empty or missing content in OpenAI completion choices.");
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

        if (isTransient && attempts < maxAttempts) {
          // Retry
          continue;
        }

        throw resolvedError;
      }
    }

    throw new LlmError("Max retries exceeded without resolving error.");
  }
}
