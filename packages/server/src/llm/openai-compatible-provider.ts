import type { AgentRuntimeInput } from "@perfectman/shared";
import type { AgentRuntimeContext, BuiltPrompt } from "../agent/agent-runtime.types.js";
import type { LLMConfig } from "./llm-config.js";
import type { LLMProvider, LLMProviderResult } from "./llm-provider.js";
import { generateOpenAiCompatibleIntent, type LlmTransportDeps } from "./sdk-transport.js";

/**
 * Thin SDK-backed facade over the OpenAI-compatible transport in
 * sdk-transport.ts; all request-shape, retry/timeout, error-mapping, and
 * header/usage logic lives in the seam.
 */
export class OpenAiCompatibleProvider implements LLMProvider {
  constructor(
    private readonly config: LLMConfig,
    private readonly deps: LlmTransportDeps = {},
  ) {}

  async generateIntent(
    input: AgentRuntimeInput,
    context: AgentRuntimeContext,
    prompt: BuiltPrompt
  ): Promise<LLMProviderResult> {
    return generateOpenAiCompatibleIntent(this.config, prompt, Date.now(), this.deps);
  }
}