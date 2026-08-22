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
import { isNearRepeat, REPETITION_SIMILARITY_THRESHOLD, REPETITION_GUARD_MARKER } from "./repetition-guard.js";
import { llmBudget } from "../llm/llm-budget.js";
import { MockLlmProvider } from "../llm/mock-llm-provider.js";
import { OpenAiCompatibleProvider } from "../llm/openai-compatible-provider.js";
import { OllamaProvider } from "../llm/ollama-provider.js";
import type { LlmConfig } from "../llm/llm-config.js";
import type { LlmProvider } from "../llm/llm-provider.js";
import type { AgentConfigRegistry } from "./agent-config-registry.js";

/**
 * Repetition-guard policy knobs. Defaults reproduce the shipped behavior:
 * Jaccard threshold 0.7, exactly one retry before a structural block.
 */
export type RepetitionPolicy = {
  threshold?: number;
  maxRetries?: number;
};

export class AgentRuntime {
  constructor(
    private readonly configOverrides?: Record<string, Partial<LlmConfig>>,
    private readonly agentConfigRegistry?: AgentConfigRegistry,
    private readonly providerFactory?: (llmConfig: LlmConfig, agentId: string) => LlmProvider,
    private readonly repetitionPolicy?: RepetitionPolicy,
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
    if (this.providerFactory) {
      provider = this.providerFactory(llmConfig, agentId);
    } else if (llmConfig.providerType === "mock") {
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
    let parseResult = IntentParser.parse(
      providerResult.content,
      agentId,
      input.availableActions,
      "no_op"
    );

    // Repetition guard: the prompt already tells the model not to repeat
    // itself and shows it the exact text to avoid (see
    // action-intent-prompt-builder.ts), but empirically small local models
    // repeat anyway — the instruction alone isn't sufficient enforcement.
    // Give the model exactly one chance to try again with an explicit,
    // pointed correction before falling back to no_op — a hard fallback on
    // the first near-repeat just trades spam for silence; a targeted retry
    // can recover real content instead.
    let intent = parseResult.intent;
    let fallbackApplied = parseResult.fallbackApplied;
    let repetitionBlocked = false;
    let repetitionRetried = false;
    let totalInputTokens = providerResult.usage.inputTokens;
    let totalOutputTokens = providerResult.usage.outputTokens;

    const repetitionThreshold = Math.min(
      1,
      Math.max(0, this.repetitionPolicy?.threshold ?? REPETITION_SIMILARITY_THRESHOLD),
    );
    const isRepeat = (candidateIntent: typeof intent): boolean =>
      (candidateIntent.intentType === "send_message" || candidateIntent.intentType === "reply_to_message") &&
      !!candidateIntent.visibleContent &&
      isNearRepeat(
        candidateIntent.visibleContent,
        input.perceptionPacket.ownRecentUtterances,
        repetitionThreshold,
      );

    if (!fallbackApplied && isRepeat(intent)) {
      repetitionRetried = true;
      const maxRetries = Math.max(0, Math.floor(this.repetitionPolicy?.maxRetries ?? 1));
      if (maxRetries <= 0) {
        // No retry budget: the detected repeat blocks right away.
        repetitionBlocked = true;
      }
      let lastAttemptContent = intent.visibleContent;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const retryPrompt = {
          ...prompt,
          system: `${prompt.system}\n\nIMPORTANT: your last attempt this turn ("${lastAttemptContent}") was too close to something you already said. Say something genuinely different — a new angle, a reaction to someone else, a topic change — or choose "no_op" if you truly have nothing new to add.`,
        };
        try {
          const retryResult = await provider.generateIntent(input, context, retryPrompt);
          totalInputTokens += retryResult.usage.inputTokens;
          totalOutputTokens += retryResult.usage.outputTokens;
          const retryParse = IntentParser.parse(retryResult.content, agentId, input.availableActions, "no_op");
          if (!retryParse.fallbackApplied && !isRepeat(retryParse.intent)) {
            parseResult = retryParse;
            intent = retryParse.intent;
            fallbackApplied = retryParse.fallbackApplied;
            break;
          }
          lastAttemptContent = retryParse.intent.visibleContent ?? lastAttemptContent;
          if (attempt === maxRetries - 1) repetitionBlocked = true;
        } catch {
          // Retry call itself failed — fall through to the block below.
          repetitionBlocked = true;
          break;
        }
      }
    }

    if (repetitionBlocked) {
      fallbackApplied = true;
      intent = IntentParser.createFallback(
        agentId,
        "no_op",
        `${REPETITION_GUARD_MARKER}: near-duplicate of a message you already sent, even after a retry — blocked structurally.`,
      );
    }

    // Track usage (includes the retry call's tokens, if one happened)
    const usageRecord: LlmUsage = {
      simulationId,
      agentId,
      model: providerResult.model || llmConfig.modelName,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
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

    if (fallbackApplied && !repetitionBlocked) {
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

    if (repetitionBlocked) {
      operatorEvents.push({
        type: "intent_blocked",
        simulationId,
        agentId,
        pulseIndex: context.pulseIndex,
        detail: `Repetition guard blocked a near-duplicate message from agent ${agentId}; substituted no_op.`,
        createdAt: context.now,
      });
    }

    return {
      intent,
      llmUsage: usageRecord,
      latencyMs: Date.now() - startTime,
      fallbackApplied,
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
