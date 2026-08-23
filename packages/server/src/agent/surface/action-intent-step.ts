import type {
  AgentRuntimeInput,
  LLMUsage,
  OperatorEvent,
} from "@perfectman/shared";
import type {
  AgentRuntimeContext,
  AgentRuntimeOutput,
  BuiltPrompt,
} from "../agent-runtime.types.js";
import type { LLMConfig } from "../../llm/llm-config.js";
import type { LLMProvider } from "../../llm/llm-provider.js";
import { llmBudget } from "../../llm/llm-budget.js";
import { IntentParser } from "../intent-parser.js";
import {
  isNearRepeat,
  REPETITION_GUARD_MARKER,
  getRepetitionPolicy,
} from "../repetition-guard.js";
import { promptVersionHash } from "../prompt-version.js";
import { PromptBuilder } from "../prompt-builder.js";
import {
  LLMStep,
  purposeToCallType,
  StepOutcome,
  StepRunContext,
} from "./llm-step.js";

type RetryKind = "none" | "repeat_failed" | "parse_failed" | "provider_failed";

/**
 * The `action_intent` LLM surface as a typed step. This is the canonical
 * implementation of the project's "engine owns structure, model owns language"
 * rule for the one active production surface: the provider call, strict parse,
 * repetition-guard retry arm and controlled fallback all live here as an
 * explicit, closed outcome instead of ad-hoc branches in the runtime.
 */
export class ActionIntentStep implements LLMStep<AgentRuntimeInput, AgentRuntimeOutput> {
  readonly purpose = "action_intent" as const;
  readonly label = "action_intent";

  render(input: AgentRuntimeInput, ctx: StepRunContext): BuiltPrompt {
    // Route through the dispatcher so unused prompt purposes still fail
    // closed (see prompt-builder.ts) and the render entry stays singular.
    return PromptBuilder.build(input, ctx.profile, "action_intent");
  }

  gate(input: AgentRuntimeInput, ctx: StepRunContext): StepOutcome<AgentRuntimeOutput> | undefined {
    if (!ctx.prompt) return undefined;
    const startTime = Date.now();
    const budgetDecision = llmBudget.canCall({
      simulationId: input.simulationId,
      agentId: input.agentId,
      priority: input.budgetPriority,
      inputTokensEstimate: ctx.prompt.inputTokensEstimate,
    });
    if (budgetDecision.allowed) return undefined;

    const fallbackIntent = IntentParser.createFallback(
      input.agentId,
      "no_op",
      `LLM budget exceeded: ${budgetDecision.reason || "unknown reason"}`,
    );
    const opEvent: OperatorEvent = {
      type: "llm_budget_exceeded",
      simulationId: input.simulationId,
      agentId: input.agentId,
      pulseIndex: ctx.pulseIndex,
      detail: `LLM budget pre-check blocked call for agent ${input.agentId}: ${budgetDecision.reason}`,
      createdAt: ctx.now,
    };
    return {
      ok: false,
      gateBlocked: true,
      fallback: {
        intent: fallbackIntent,
        llmUsage: null,
        latencyMs: Date.now() - startTime,
        fallbackApplied: true,
        operatorEvents: [opEvent],
      },
    };
  }

  async execute(
    input: AgentRuntimeInput,
    ctx: StepRunContext,
  ): Promise<StepOutcome<AgentRuntimeOutput>> {
    if (!ctx.prompt) throw new Error("ActionIntentStep.execute requires a rendered prompt (run render first)");
    const { provider, llmConfig, prompt } = ctx;
    const runtimeContext: AgentRuntimeContext = { pulseIndex: ctx.pulseIndex, now: ctx.now };
    const { agentId, simulationId } = input;
    const startTime = Date.now();

    let providerResult;
    try {
      providerResult = await provider.generateIntent(input, runtimeContext, prompt);
    } catch (error: any) {
      const fallbackReason = `Provider failed: ${error.message || String(error)}`;
      const fallbackIntent = IntentParser.createFallback(agentId, "no_op", fallbackReason);
      const opEvent: OperatorEvent = {
        type: "llm_failure",
        simulationId,
        agentId,
        pulseIndex: ctx.pulseIndex,
        detail: `LLM provider execution failed for agent ${agentId}: ${error.message || String(error)}`,
        createdAt: ctx.now,
      };
      return {
        ok: false,
        fallback: {
          intent: fallbackIntent,
          llmUsage: null,
          latencyMs: Date.now() - startTime,
          fallbackApplied: true,
          operatorEvents: [opEvent],
        },
        errorDetail: `Provider failed: ${error.message || String(error)}`,
      };
    }

    let parseResult = IntentParser.parse(providerResult.content, agentId, input.availableActions, "no_op");

    // Repetition guard: the prompt already tells the model not to repeat
    // itself and shows it the exact text to avoid, but empirically small
    // local models repeat anyway. Give the model exactly one chance to try
    // again with a pointed correction. Outcomes are tracked separately so a
    // failed retry is reported as an llm_failure, not as a repetition block.
    let intent = parseResult.intent;
    let fallbackApplied = parseResult.fallbackApplied;
    let repetitionBlocked = false;
    let retryKind: RetryKind = "none";
    let totalInputTokens = providerResult.usage.inputTokens;
    let totalOutputTokens = providerResult.usage.outputTokens;
    const mainInputTokens = providerResult.usage.inputTokens;
    const mainOutputTokens = providerResult.usage.outputTokens;
    let retryUsage: { inputTokens: number; outputTokens: number; latencyMs: number; promptVersion: string } | undefined;

    const { threshold, maxRetries } = getRepetitionPolicy();
    const isRepeat = (candidateIntent: typeof intent): boolean =>
      (candidateIntent.intentType === "send_message" || candidateIntent.intentType === "reply_to_message") &&
      !!candidateIntent.visibleContent &&
      isNearRepeat(candidateIntent.visibleContent, input.perceptionPacket.ownRecentUtterances, threshold);

    if (!fallbackApplied && isRepeat(intent)) {
      let attemptsMade = 0;
      let lastAttemptContent = intent.visibleContent;
      let lastFailure: "repeat_failed" | "parse_failed" | "provider_failed" | null = null;

      if (maxRetries <= 0) {
        // No retry budget: the detected repeat blocks right away.
        repetitionBlocked = true;
        retryKind = "repeat_failed";
      }

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // Retries are wire calls too — re-check the budget before each one
        // so a retry budget cannot be used to bypass the token gate.
        const budgetRecheck = llmBudget.canCall({
          simulationId: input.simulationId,
          agentId: input.agentId,
          priority: input.budgetPriority,
          inputTokensEstimate: ctx.prompt.inputTokensEstimate,
        });
        if (!budgetRecheck.allowed) {
          lastFailure = "provider_failed";
          repetitionBlocked = true;
          break;
        }

        const escalation =
          attempt > 1 ? ` This is retry attempt ${attempt} of ${maxRetries} — the previous correction was ignored; change approach entirely.` : "";
        const retryPrompt = {
          ...prompt,
          version: promptVersionHash([
            `${prompt.system}\n\nIMPORTANT: your last attempt this turn ("${lastAttemptContent}") was too close to something you already said. Say something genuinely different — a new angle, a reaction to someone else, a topic change — while staying true to what you actually want right now; do not invent novelty that your current motive and emotional state wouldn't justify. Or choose "no_op" if you truly have nothing new to add.${escalation}`,
            prompt.user,
          ]),
          system: `${prompt.system}\n\nIMPORTANT: your last attempt this turn ("${lastAttemptContent}") was too close to something you already said. Say something genuinely different — a new angle, a reaction to someone else, a topic change — while staying true to what you actually want right now; do not invent novelty that your current motive and emotional state wouldn't justify. Or choose "no_op" if you truly have nothing new to add.${escalation}`,
        };
        try {
          const retryResult = await provider.generateIntent(input, runtimeContext, retryPrompt);
          attemptsMade = attempt;
          totalInputTokens += retryResult.usage.inputTokens;
          totalOutputTokens += retryResult.usage.outputTokens;
          retryUsage = {
            inputTokens: retryResult.usage.inputTokens,
            outputTokens: retryResult.usage.outputTokens,
            latencyMs: retryResult.latencyMs,
            promptVersion: retryPrompt.version,
          };
          const retryParse = IntentParser.parse(retryResult.content, agentId, input.availableActions, "no_op");
          if (!retryParse.fallbackApplied && !isRepeat(retryParse.intent)) {
            parseResult = retryParse;
            intent = retryParse.intent;
            fallbackApplied = false;
            break;
          }
          if (retryParse.fallbackApplied) {
            parseResult = retryParse;
            intent = retryParse.intent;
            fallbackApplied = true;
            lastFailure = "parse_failed";
          } else {
            lastAttemptContent = retryParse.intent.visibleContent ?? lastAttemptContent;
            lastFailure = "repeat_failed";
          }
          if (attempt === maxRetries) {
            repetitionBlocked = lastFailure === "repeat_failed";
            retryKind = lastFailure === "repeat_failed" ? "repeat_failed" : "parse_failed";
          }
        } catch {
          fallbackApplied = true;
          intent = IntentParser.createFallback(agentId, "no_op", "Repetition retry call failed.");
          retryKind = "provider_failed";
          break;
        }
      }
      void attemptsMade;
    }

    if (repetitionBlocked) {
      fallbackApplied = true;
      intent = IntentParser.createFallback(
        agentId,
        "no_op",
        `${REPETITION_GUARD_MARKER}: near-duplicate of a message you already sent — blocked structurally${maxRetries === 0 ? " without any retry attempt" : ` after ${maxRetries} retry attempt(s)`}.`,
      );
    }

    const model = providerResult.model || llmConfig.modelName;
    const makeUsage = (u: {
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
      promptVersion: string;
    }): LLMUsage => ({
      simulationId,
      agentId,
      model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      latencyMs: u.latencyMs,
      callType: purposeToCallType("action_intent"),
      pulseIndex: ctx.pulseIndex,
      createdAt: ctx.now,
      promptVersion: u.promptVersion,
      promptTemplateVersion: prompt.templateVersion,
    });

    // Record each provider call with the prompt version that actually produced
    // it, so attribution stays per-prompt even when a retry used a modified
    // prompt (see m4). The retry's tokens are not double-counted: the main call
    // is recorded with the base prompt version, the retry with its own.
    llmBudget.recordUsage(makeUsage({
      inputTokens: mainInputTokens,
      outputTokens: mainOutputTokens,
      latencyMs: providerResult.latencyMs,
      promptVersion: prompt.version,
    }));
    if (retryUsage) {
      llmBudget.recordUsage(makeUsage(retryUsage));
    }
    // Aggregated view for the returned output (summed across main+retry).
    const totalLatencyMs = providerResult.latencyMs + (retryUsage?.latencyMs ?? 0);
    const usageRecord = makeUsage({
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      latencyMs: totalLatencyMs,
      promptVersion: prompt.version,
    });

    const operatorEvents: OperatorEvent[] = [];
    operatorEvents.push({
      type: "pulse_metrics",
      simulationId,
      agentId,
      pulseIndex: ctx.pulseIndex,
      detail: `LLM cognition call completed for agent ${agentId}`,
      createdAt: ctx.now,
      data: {
        model: providerResult.model || llmConfig.modelName,
        requestedModel: providerResult.requestedModel || llmConfig.modelName,
        routedModel: providerResult.routedModel ?? null,
        fallbackAttempts: providerResult.fallbackAttempts ?? null,
        latencyMs: totalLatencyMs,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      },
    });

    if (fallbackApplied && !repetitionBlocked) {
      const detail =
        retryKind === "provider_failed"
          ? `Repetition retry provider call failed for agent ${agentId}; falling back to no_op.`
          : `LLM parsing or target constraint validation failed for agent ${agentId}: ${parseResult.errorDetail}`;
      operatorEvents.push({
        type: "llm_failure",
        simulationId,
        agentId,
        pulseIndex: ctx.pulseIndex,
        detail,
        createdAt: ctx.now,
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
        pulseIndex: ctx.pulseIndex,
        detail: `Repetition guard blocked a near-duplicate message from agent ${agentId}; substituted no_op.`,
        createdAt: ctx.now,
      });
    }

    const output: AgentRuntimeOutput = {
      intent,
      llmUsage: usageRecord,
      latencyMs: Date.now() - startTime,
      fallbackApplied,
      operatorEvents,
    };

    return { ok: true, value: output };
  }
}
