import type { LLMConfig } from "./llm-config.js";
import type { LLMProvider } from "./llm-provider.js";
import { MockLLMProvider } from "./mock-llm-provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider.js";

/**
 * The single provider-resolution site in the codebase: every LLMConfig →
 * LLMProvider decision (agent runtime, eval scenario runner, the persona-aware
 * mock's real path, health probes) funnels through this module. A provider
 * constructor or providerType branch anywhere else is a FR-003 regression.
 */
export function createLLMProvider(llmConfig: LLMConfig, agentId?: string): LLMProvider {
  if (llmConfig.providerType === "mock") {
    return new MockLLMProvider();
  }
  if (llmConfig.providerType === "ollama") {
    return new OllamaProvider(llmConfig);
  }
  return new OpenAiCompatibleProvider(llmConfig);
}

export type LlmEndpointShape = "ollama" | "openai-compatible";

/**
 * Maps a config to the wire shape its provider speaks: only `ollama` configs
 * use the native /api/chat endpoint (think:false, schema-object format);
 * every other member is the generic /chat/completions shape. Shape-sensitive
 * callers (health probes) must consult this export instead of branching on
 * providerType themselves.
 */
export function resolveEndpointShape(llmConfig: LLMConfig): LlmEndpointShape {
  return llmConfig.providerType === "ollama" ? "ollama" : "openai-compatible";
}