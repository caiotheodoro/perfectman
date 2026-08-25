import type { AgentRuntimeInput } from "@perfectman/shared";
import type { AgentRuntimeContext, BuiltPrompt } from "../agent/agent-runtime.types.js";
import type { LLMConfig } from "./llm-config.js";
import type { LLMProvider, LLMProviderResult } from "./llm-provider.js";
import { generateOllamaIntent, type LlmTransportDeps } from "./sdk-transport.js";

/**
 * Thin SDK-backed facade over the Ollama native /api/chat transport in
 * sdk-transport.ts (think: false for Qwen3, schema-object format, flat→nested
 * options translation all live in the seam).
 */
export class OllamaProvider implements LLMProvider {
  constructor(
    private readonly config: LLMConfig,
    private readonly deps: LlmTransportDeps = {},
  ) {}

  async generateIntent(
    input: AgentRuntimeInput,
    context: AgentRuntimeContext,
    prompt: BuiltPrompt
  ): Promise<LLMProviderResult> {
    return generateOllamaIntent(this.config, prompt, Date.now(), this.deps);
  }
}