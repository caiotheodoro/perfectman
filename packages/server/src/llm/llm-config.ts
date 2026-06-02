export type LlmConfig = {
  providerType: "mock" | "qwen3" | "freellmapi";
  baseUrl?: string;
  apiKeyEnv?: string;
  modelName: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  temperature: number;
  timeoutMs: number;
  retryCount: number;
  responseFormatJson?: boolean;
  extraBody?: Record<string, unknown>;
};
