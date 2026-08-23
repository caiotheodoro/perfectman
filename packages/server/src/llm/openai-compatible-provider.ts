import {
  ModelIntentPacketJsonSchema,
  chatCompletion,
  ChatCompletionHttpError,
  ChatCompletionTimeoutError,
  type ChatCompletionResult,
} from "@perfectman/shared";
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
 * OpenAI-compatible provider over the shared chat-completion primitive.
 *
 * The transport loop (retry on transient failures, dual connect/body-read
 * timeout, header capture, 400/422 json_schema→json_object fallback) lives
 * in `@perfectman/shared`'s `chatCompletion`; this provider owns the
 * intent-specific parts: the packet JSON Schema, usage/route accounting,
 * and the LLMError boundary (shared errors are wrapped so the agent runtime
 * keeps its typed error contract).
 */
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
    const timeoutMs = this.config.timeoutMs || 10000;

    // Shape-constrained decoding by default (packet JSON Schema); the
    // tolerant json_object mode is a fallback — automatic on a 400/422, or
    // forced via responseFormatJsonSchema:false for proxies that never
    // accept schemas.
    const shapeConstrained =
      this.config.responseFormatJson === true &&
      this.config.responseFormatJsonSchema !== false;

    let result: ChatCompletionResult;
    try {
      result = await chatCompletion({
        baseUrl: normalizedBaseUrl,
        model: this.config.modelName,
        apiKey,
        label: "OpenAI-compatible provider",
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        temperature: this.config.temperature,
        maxTokens: this.config.maxOutputTokens,
        extraBody: this.config.extraBody,
        responseFormatJson: this.config.responseFormatJson === true,
        jsonSchemaFormat: shapeConstrained
          ? { name: "intent_packet", schema: ModelIntentPacketJsonSchema, strict: false }
          : undefined,
        timeoutMs,
        retryCount: this.config.retryCount ?? 0,
      });
    } catch (error) {
      if (error instanceof ChatCompletionTimeoutError) {
        throw new LLMTimeoutError(`Request timed out after ${timeoutMs}ms.`);
      }
      if (error instanceof ChatCompletionHttpError) {
        throw new LLMHttpError(error.status, error.bodyText || error.message);
      }
      throw new LLMError(
        error instanceof Error ? error.message : "Unknown error occurred during fetch.",
        error,
      );
    }

    const content = result.data.choices?.[0]?.message?.content;
    if (content === undefined || content === null) {
      throw new LLMResponseError("Empty or missing content in OpenAI completion choices.");
    }

    const requestedModel = this.config.modelName;
    const routedModel =
      result.responseHeaders["x-routed-model"] ||
      result.responseHeaders["x-routed-model-name"] ||
      result.data.model ||
      requestedModel;
    const fallbackAttempts = parseInt(result.responseHeaders["x-fallback-attempts"] || "0", 10);

    return {
      content,
      usage: {
        inputTokens: result.data.usage?.prompt_tokens ?? prompt.inputTokensEstimate ?? 0,
        outputTokens: result.data.usage?.completion_tokens ?? 0,
      },
      latencyMs: Date.now() - startTime,
      model: result.data.model ?? this.config.modelName,
      responseHeaders: result.responseHeaders,
      requestedModel,
      routedModel,
      fallbackAttempts: fallbackAttempts > 0 ? fallbackAttempts : result.attemptCount - 1,
    };
  }
}