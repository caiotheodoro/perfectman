export type LLMConfig = {
  providerType: "mock" | "ollama" | "openai-compatible";
  baseUrl?: string;
  apiKeyEnv?: string;
  modelName: string;
  maxInputTokens: number;
  /**
   * Hotel mode only: "compact" renders the small-window prompt (persona card,
   * top memories, near-only body block, short event window). Unset or "full"
   * is the prompt as it has always been; outside the hotel the field is ignored.
   */
  promptStyle?: "full" | "compact";
  maxOutputTokens: number;
  temperature: number;
  timeoutMs: number;
  retryCount: number;
  responseFormatJson?: boolean;
  /**
   * Use shape-constrained json_schema decoding when the provider supports it.
   * Defaults to true (with an automatic 400/422 fallback to json_object in the
   * OpenAI-compatible provider); set false to force syntax-only json_object.
   */
  responseFormatJsonSchema?: boolean;
  /**
   * Extra provider-specific keys spread onto the OpenAI-compatible request
   * body root (and translated into Ollama's nested `options` on the native
   * path). Reasoning-capable hosted models that think by default must be
   * given an explicit reasoning-disable entry here, or the reasoning block
   * consumes the output-token budget before the intent JSON and every call
   * fails to parse. DeepSeek's key is `{ thinking: { type: "disabled" } }`.
   */
  extraBody?: Record<string, unknown>;
};
