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
  DEFAULT_REPETITION_MAX_RETRIES,
  isNearRepeat,
  REPETITION_GUARD_MARKER,
  REPETITION_SIMILARITY_THRESHOLD,
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
 * Correction appended to the system prompt on each repetition retry. The
 * retry prompt version hash covers this text, so a reworded note yields a
 * new prompt version; the block motive keeps its own "Repetition guard"
 * prefix (repetition-guard.ts) that the offline sweeps match on.
 */
function retryCorrectionNote(lastAttempt: string): string {
  return `IMPORTANT: your last attempt this turn ("${lastAttempt}") was too close to something you already said. Say something genuinely different — a new angle, a reaction to someone else, a topic change — while staying true to what you actually want right now; do not invent novelty that your current motive and emotional state wouldn't justify. Or choose "no_op" if you truly have nothing new to add.`;
}

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
    return PromptBuilder.build(input, ctx.profile, "action_intent", ctx.llmConfig.maxInputTokens);
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

    const trimEvent = this.promptTrimEvent(prompt, simulationId, agentId, ctx.pulseIndex, ctx.now);

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
          operatorEvents: trimEvent ? [trimEvent, opEvent] : [opEvent],
        },
        errorDetail: `Provider failed: ${error.message || String(error)}`,
      };
    }

    let parseResult = IntentParser.parse(providerResult.content, agentId, input.availableActions, "no_op");

    // Repetition guard: the prompt already tells the model not to repeat
    // itself and shows it the exact text to avoid, but empirically small
    // local models repeat anyway. Give the model a bounded number of pointed
    // retries (default: one), then block structurally. Outcomes are tracked
    // separately so a failed retry is reported as an llm_failure, not as a
    // repetition block.
    const policy = ctx.repetitionPolicy ?? {};
    const threshold = Math.min(1, Math.max(0, policy.threshold ?? REPETITION_SIMILARITY_THRESHOLD));
    const maxRetries = Math.max(0, Math.floor(policy.maxRetries ?? DEFAULT_REPETITION_MAX_RETRIES));

    let intent = parseResult.intent;
    let fallbackApplied = parseResult.fallbackApplied;
    let repetitionBlocked = false;
    let retryKind: RetryKind = "none";
    let retriesAttempted = 0;
    let totalInputTokens = providerResult.usage.inputTokens;
    let totalOutputTokens = providerResult.usage.outputTokens;
    const mainInputTokens = providerResult.usage.inputTokens;
    const mainOutputTokens = providerResult.usage.outputTokens;
    const retryUsages: { inputTokens: number; outputTokens: number; latencyMs: number; promptVersion: string }[] = [];

    const isRepeat = (candidateIntent: typeof intent): boolean =>
      (candidateIntent.intentType === "send_message" || candidateIntent.intentType === "reply_to_message") &&
      !!candidateIntent.visibleContent &&
      isNearRepeat(candidateIntent.visibleContent, input.perceptionPacket.ownRecentUtterances, threshold);

    if (!fallbackApplied && isRepeat(intent)) {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        // The gate's budget check runs once before the first call; each retry
        // is a further wire call it did not authorize, so re-check before
        // issuing one. A denial must not turn into a free retry.
        const budgetDecision = llmBudget.canCall({
          simulationId,
          agentId,
          priority: input.budgetPriority,
          inputTokensEstimate: prompt.inputTokensEstimate,
        });
        if (!budgetDecision.allowed) {
          repetitionBlocked = true;
          retryKind = "repeat_failed";
          break;
        }
        const retryPrompt = {
          ...prompt,
          version: promptVersionHash([
            `${prompt.system}\n\n${retryCorrectionNote(intent.visibleContent ?? "")}`,
            prompt.user,
          ]),
          system: `${prompt.system}\n\n${retryCorrectionNote(intent.visibleContent ?? "")}`,
        };
        try {
          const retryResult = await provider.generateIntent(input, runtimeContext, retryPrompt);
          retriesAttempted++;
          totalInputTokens += retryResult.usage.inputTokens;
          totalOutputTokens += retryResult.usage.outputTokens;
          retryUsages.push({
            inputTokens: retryResult.usage.inputTokens,
            outputTokens: retryResult.usage.outputTokens,
            latencyMs: retryResult.latencyMs,
            promptVersion: retryPrompt.version,
          });
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
            retryKind = "parse_failed";
            break;
          }
          // Still a repeat; loop again if the retry budget allows.
        } catch {
          fallbackApplied = true;
          intent = IntentParser.createFallback(agentId, "no_op", "Repetition retry call failed.");
          retryKind = "provider_failed";
          break;
        }
      }
      // Exhausted the retry budget with the model still repeating.
      if (!fallbackApplied && isRepeat(intent)) {
        repetitionBlocked = true;
        retryKind = "repeat_failed";
      }
    }

    if (repetitionBlocked) {
      fallbackApplied = true;
      const retryPhrase =
        retriesAttempted === 0
          ? "with no retry allowed"
          : retriesAttempted === 1
            ? "even after a retry"
            : `even after ${retriesAttempted} retries`;
      intent = IntentParser.createFallback(
        agentId,
        "no_op",
        `${REPETITION_GUARD_MARKER}: near-duplicate of a message you already sent, ${retryPhrase} — blocked structurally.`,
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
    for (const retryUsage of retryUsages) {
      llmBudget.recordUsage(makeUsage(retryUsage));
    }
    // Aggregated view for the returned output (summed across all calls).
    const totalLatencyMs =
      providerResult.latencyMs + retryUsages.reduce((sum, usage) => sum + usage.latencyMs, 0);
    const usageRecord = makeUsage({
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      latencyMs: totalLatencyMs,
      promptVersion: prompt.version,
    });

    const operatorEvents: OperatorEvent[] = [];
    if (trimEvent) operatorEvents.push(trimEvent);
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

  /**
   * Operator record for a prompt whose raw assembly exceeded the agent's
   * `maxInputTokens` and was trimmed to fit (see ActionIntentPromptBuilder).
   * Returns null when no trim happened.
   */
  private promptTrimEvent(
    prompt: BuiltPrompt,
    simulationId: string,
    agentId: string,
    pulseIndex: number,
    now: number,
  ): OperatorEvent | null {
    const { trim } = prompt;
    if (!trim) return null;
    return {
      type: "prompt_trimmed",
      simulationId,
      agentId,
      pulseIndex,
      detail:
        `Prompt assembly for agent ${agentId} exceeded maxInputTokens ` +
        `(${trim.rawInputTokensEstimate} > ${trim.maxInputTokens} est. tokens); dropped ` +
        `${trim.droppedMemories} lowest-salience memory(ies) and ${trim.droppedEvents} oldest ` +
        `context event(s) (~${trim.droppedInputTokensEstimate} tokens) to fit ` +
        `${trim.finalInputTokensEstimate}.`,
      createdAt: now,
      data: {
        maxInputTokens: trim.maxInputTokens,
        rawInputTokensEstimate: trim.rawInputTokensEstimate,
        finalInputTokensEstimate: trim.finalInputTokensEstimate,
        droppedEvents: trim.droppedEvents,
        droppedMemories: trim.droppedMemories,
        droppedInputTokensEstimate: trim.droppedInputTokensEstimate,
      },
    };
  }
}
