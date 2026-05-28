import type { 
  AgentRuntimeInput, 
  LlmUsage, 
  OperatorEvent,
  PromptPurpose
} from "@perfectman/shared";
import type { 
  AgentRuntimeContext, 
  AgentRuntimeOutput 
} from "./agent-runtime.types.js";
import { PersonaLoader } from "./persona-loader.js";
import { PromptBuilder } from "./prompt-builder.js";
import { IntentParser } from "./intent-parser.js";
import { llmBudget } from "../llm/llm-budget.js";
import { MockLlmProvider } from "../llm/mock-llm-provider.js";
import { OpenAiCompatibleProvider } from "../llm/openai-compatible-provider.js";
import { OllamaProvider } from "../llm/ollama-provider.js";
import type { LlmConfig } from "../llm/llm-config.js";
import type { LlmProvider } from "../llm/llm-provider.js";
import type { AgentConfigRegistry } from "./agent-config-registry.js";

export class AgentRuntime {
  constructor(
    private readonly configOverrides?: Record<string, Partial<LlmConfig>>,
    private readonly agentConfigRegistry?: AgentConfigRegistry,
  ) {}

  async generateIntent(
    input: AgentRuntimeInput,
    context: AgentRuntimeContext
  ): Promise<AgentRuntimeOutput> {
    const startTime = Date.now();
    const agentId = input.agentId;
    const simulationId = input.simulationId;

    const profile = this.agentConfigRegistry?.getPromptProfile(agentId) ?? PersonaLoader.getProfile(agentId);
    const llmConfig =
      this.agentConfigRegistry?.getLlmConfig(agentId) ??
      PersonaLoader.getLlmConfig(agentId, this.configOverrides?.[agentId]);

    const prompt = PromptBuilder.build(input, profile, "action_intent");

    // Budget pre-check using the actual built prompt's estimated tokens
    const budgetDecision = llmBudget.canCall({
      simulationId,
      agentId,
      priority: input.budgetPriority,
      inputTokensEstimate: prompt.inputTokensEstimate,
    });

    if (!budgetDecision.allowed) {
      const fallbackIntent = IntentParser.createFallback(
        agentId,
        "no_op",
        `LLM budget exceeded: ${budgetDecision.reason || "unknown reason"}`
      );

      const opEvent: OperatorEvent = {
        type: "llm_budget_exceeded",
        simulationId,
        agentId,
        pulseIndex: context.pulseIndex,
        detail: `LLM budget pre-check blocked call for agent ${agentId}: ${budgetDecision.reason}`,
        createdAt: context.now,
      };

      return {
        intent: fallbackIntent,
        llmUsage: null,
        latencyMs: Date.now() - startTime,
        fallbackApplied: true,
        operatorEvents: [opEvent],
      };
    }

    // Determine LLM provider
    let provider: LlmProvider;
    if (llmConfig.providerType === "mock") {
      provider = new MockLlmProvider();
    } else if (llmConfig.providerType === "ollama") {
      provider = new OllamaProvider(llmConfig);
    } else {
      provider = new OpenAiCompatibleProvider(llmConfig);
    }

    let providerResult;
    try {
      providerResult = await provider.generateIntent(input, context, prompt);
    } catch (error: any) {
      const fallbackReason = `Provider failed: ${error.message || String(error)}`;
      const fallbackIntent = IntentParser.createFallback(
        agentId,
        "no_op",
        fallbackReason
      );

      const opEvent: OperatorEvent = {
        type: "llm_failure",
        simulationId,
        agentId,
        pulseIndex: context.pulseIndex,
        detail: `LLM provider execution failed for agent ${agentId}: ${error.message || String(error)}`,
        createdAt: context.now,
      };

      return {
        intent: fallbackIntent,
        llmUsage: null,
        latencyMs: Date.now() - startTime,
        fallbackApplied: true,
        operatorEvents: [opEvent],
      };
    }

    // Parse and validate intent
    const parseResult = IntentParser.parse(
      providerResult.content,
      agentId,
      input.availableActions,
      "no_op"
    );

    // Track usage
    const usageRecord: LlmUsage = {
      simulationId,
      agentId,
      model: providerResult.model || llmConfig.modelName,
      inputTokens: providerResult.usage.inputTokens,
      outputTokens: providerResult.usage.outputTokens,
      latencyMs: providerResult.latencyMs,
      callType: purposeToCallType(prompt.purpose),
      pulseIndex: context.pulseIndex,
      createdAt: context.now,
    };

    // Record the usage in budget tracker!
    llmBudget.recordUsage(usageRecord);

    const operatorEvents: OperatorEvent[] = [];

    // Always log pulse_metrics to capture FreeLLMAPI A/B testing models & provider latency
    operatorEvents.push({
      type: "pulse_metrics",
      simulationId,
      agentId,
      pulseIndex: context.pulseIndex,
      detail: `LLM cognition call completed for agent ${agentId}`,
      createdAt: context.now,
      data: {
        model: providerResult.model || llmConfig.modelName,
        requestedModel: providerResult.requestedModel || llmConfig.modelName,
        routedModel: providerResult.routedModel ?? null,
        fallbackAttempts: providerResult.fallbackAttempts ?? null,
        latencyMs: providerResult.latencyMs,
        inputTokens: providerResult.usage.inputTokens,
        outputTokens: providerResult.usage.outputTokens,
      },
    });

    if (parseResult.fallbackApplied) {
      operatorEvents.push({
        type: "llm_failure",
        simulationId,
        agentId,
        pulseIndex: context.pulseIndex,
        detail: `LLM parsing or target constraint validation failed for agent ${agentId}: ${parseResult.errorDetail}`,
        createdAt: context.now,
        data: {
          errorDetail: parseResult.errorDetail ?? null,
          requestedModel: providerResult.requestedModel || llmConfig.modelName,
          routedModel: providerResult.routedModel ?? null,
          fallbackAttempts: providerResult.fallbackAttempts ?? null,
        },
      });
    }

    return {
      intent: parseResult.intent,
      llmUsage: usageRecord,
      latencyMs: Date.now() - startTime,
      fallbackApplied: parseResult.fallbackApplied,
      operatorEvents,
    };
  }
}

function purposeToCallType(purpose: PromptPurpose): LlmUsage["callType"] {
  switch (purpose) {
    case "action_intent":         return "cognition";
    case "social_interpretation": return "interpretation";
    case "background_reflection": return "reflection";
    case "spectator_recap":       return "recap";
  }
}
