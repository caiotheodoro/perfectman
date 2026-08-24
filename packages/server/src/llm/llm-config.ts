export type LLMConfig = {
  providerType: "mock" | "ollama" | "openai-compatible";
  baseUrl?: string;
  apiKeyEnv?: string;
  modelName: string;
  maxInputTokens: number;
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
  extraBody?: Record<string, unknown>;
};
