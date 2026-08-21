export type LlmConfig = {
  providerType: "mock" | "qwen3_8b" | "ollama" | "freellmapi";
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
   * Structured decoding (Ollama native path only): send the full
   * ActionIntent JSON Schema as the `format` target instead of bare "json",
   * making shape-invalid output mechanically impossible. Requires
   * responseFormatJson. Off by default — defense in depth, not a gate.
   */
  constrainedDecoding?: boolean;
  extraBody?: Record<string, unknown>;
};
