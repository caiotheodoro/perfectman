import type { AgentRuntimeInput } from "@perfectman/shared";
import type { AgentRuntimeContext, BuiltPrompt } from "../agent/agent-runtime.types.js";

export type LLMProviderResult = {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  latencyMs: number;
  model: string;
  responseHeaders?: Record<string, string>;
  requestedModel?: string;
  routedModel?: string;
  fallbackAttempts?: number;
};

export interface LLMProvider {
  generateIntent(
    input: AgentRuntimeInput,
    context: AgentRuntimeContext,
    prompt: BuiltPrompt
  ): Promise<LLMProviderResult>;
}
