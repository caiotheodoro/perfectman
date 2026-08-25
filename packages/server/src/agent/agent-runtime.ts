import type { AgentRuntimeInput } from "@perfectman/shared";
import type {
  AgentRuntimeContext,
  AgentRuntimeOutput,
} from "./agent-runtime.types.js";
import { PersonaLoader } from "./persona-loader.js";
import { llmSurfaceRegistry } from "./surface/index.js";
import type { LLMStep, StepRunContext } from "./surface/llm-step.js";
import { createLLMProvider } from "../llm/provider-factory.js";
import type { LLMConfig } from "../llm/llm-config.js";
import type { LLMProvider } from "../llm/llm-provider.js";
import type { AgentConfigRegistry } from "./agent-config-registry.js";
import type { RepetitionPolicy } from "./repetition-guard.js";

export class AgentRuntime {
  constructor(
    private readonly configOverrides?: Record<string, Partial<LLMConfig>>,
    private readonly agentConfigRegistry?: AgentConfigRegistry,
    private readonly providerFactory?: (llmConfig: LLMConfig, agentId: string) => LLMProvider,
    private readonly repetitionPolicy?: RepetitionPolicy,
  ) {}

  async generateIntent(
    input: AgentRuntimeInput,
    context: AgentRuntimeContext,
  ): Promise<AgentRuntimeOutput> {
    const startTime = Date.now();
    const agentId = input.agentId;

    const profile = this.agentConfigRegistry?.getPromptProfile(agentId) ?? PersonaLoader.getProfile(agentId);
    const llmConfig =
      this.agentConfigRegistry?.getLLMConfig(agentId) ??
      PersonaLoader.getLLMConfig(agentId, this.configOverrides?.[agentId]);

    let provider: LLMProvider;
    if (this.providerFactory) {
      provider = this.providerFactory(llmConfig, agentId);
    } else {
      provider = createLLMProvider(llmConfig, agentId);
    }

    const step: LLMStep<AgentRuntimeInput, AgentRuntimeOutput> = llmSurfaceRegistry.action_intent;
    const baseCtx: StepRunContext = {
      now: context.now,
      pulseIndex: context.pulseIndex,
      provider,
      llmConfig,
      profile,
      repetitionPolicy: this.repetitionPolicy,
    };
    const prompt = step.render(input, baseCtx);
    const ctx: StepRunContext = { ...baseCtx, prompt };

    const gateBlock = step.gate(input, ctx);
    if (gateBlock) {
      const blocked = gateBlock.ok ? gateBlock.value : gateBlock.fallback;
      blocked.latencyMs = Date.now() - startTime;
      return blocked;
    }

    const outcome = await step.execute(input, ctx);
    const result = outcome.ok ? outcome.value : outcome.fallback;
    result.latencyMs = Date.now() - startTime;
    return result;
  }
}
