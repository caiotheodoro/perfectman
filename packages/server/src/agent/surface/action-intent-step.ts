import type {
  AgentRuntimeInput,
  LLMUsage,
  OperatorEvent,
  TargetResolutionFlooredData,
} from "@perfectman/shared";
import type {
  AgentRuntimeContext,
  AgentRuntimeOutput,
  BuiltPrompt,
} from "../agent-runtime.types.js";
import type { LLMConfig } from "../../llm/llm-config.js";
import type { LLMProvider } from "../../llm/llm-provider.js";
import { llmBudget } from "../../llm/llm-budget.js";
import { IntentParser, type TargetResolutionContext } from "../intent-parser.js";
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
 * Correction appended to the system prompt on the single reply/react target
 * retry: names the unresolvable handle, lists the valid handle set for this
 * render, and offers the send_message escape hatch. The retry prompt version
 * hash covers this text.
 */
function targetRetryCorrectionNote(field: string, badHandle: string, validHandles: string[]): string {
  const valid = validHandles.length > 0 ? validHandles.join(", ") : "(no event handles are available this turn)";
  return `IMPORTANT: you set "${field}" to "${badHandle || "(empty)"}", which is not one of the event handles shown in <events>. The only valid handles this turn are: ${valid}. Either set "${field}" to exactly one of those handles, or — if this was not actually a reply/reaction to one specific message — set "intentType" to "send_message" and omit "${field}".`;
}

/**
 * The `action_intent` LLM surface as a typed step. This is the canonical
 * implementation of the project's "engine owns structure, model owns language"
 * rule for the one active production surface: the provider call, strict parse,
 * the single bounded retry arm (repetition guard + target resolution) and
 * controlled fallback all live here as an explicit, closed outcome instead of
 * ad-hoc branches in the runtime.
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
      createdAt: Date.now(),
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
        createdAt: Date.now(),
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

    const targetContext: TargetResolutionContext = {
      eventHandles: input.perceptionPacket.eventHandles,
      events: [
        ...(input.perceptionPacket.triggeringEvent ? [input.perceptionPacket.triggeringEvent] : []),
        ...input.perceptionPacket.visibleContextEvents,
      ],
      triggeringEventId: input.perceptionPacket.triggeringEvent?.id,
    };

    let parseResult = IntentParser.parse(providerResult.content, agentId, input.availableActions, "no_op", targetContext);

    // Single bounded retry arm for the two structural guard violations — a
    // near-duplicate message and an unresolvable reply/react target. The
    // prompt already instructs the model on both, but empirically small local
    // models violate them anyway; the re-prompt names every currently
    // violated constraint (default: one retry, budget permitting), and the
    // latest attempt is then judged structurally: repetition block first,
    // then the target floor. A failed retry is reported as an llm_failure,
    // not as a repetition block.
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

    if (!fallbackApplied && (isRepeat(intent) || parseResult.unresolvedTarget)) {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        // The gate's budget check runs once before the first call; each retry
        // is a further wire call it did not authorize, so re-check before
        // issuing one. A denial must not turn into a free retry. With a
        // near-duplicate still on the table the pulse is blocked below; a
        // merely unresolved target falls to the floor instead.
        const budgetDecision = llmBudget.canCall({
          simulationId,
          agentId,
          priority: input.budgetPriority,
          inputTokensEstimate: prompt.inputTokensEstimate,
        });
        if (!budgetDecision.allowed) {
          if (isRepeat(intent)) {
            repetitionBlocked = true;
            retryKind = "repeat_failed";
          }
          break;
        }
        const corrections: string[] = [];
        if (isRepeat(intent)) corrections.push(retryCorrectionNote(intent.visibleContent ?? ""));
        if (parseResult.unresolvedTarget) {
          corrections.push(
            targetRetryCorrectionNote(
              parseResult.unresolvedTarget.field,
              parseResult.unresolvedTarget.badHandle,
              parseResult.unresolvedTarget.validHandles,
            ),
          );
        }
        const correction = corrections.join("\n\n");
        const retryPrompt = {
          ...prompt,
          version: promptVersionHash([`${prompt.system}\n\n${correction}`, prompt.user]),
          system: `${prompt.system}\n\n${correction}`,
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
          const retryParse = IntentParser.parse(retryResult.content, agentId, input.availableActions, "no_op", targetContext);
          if (!retryParse.fallbackApplied && !isRepeat(retryParse.intent) && !retryParse.unresolvedTarget) {
            parseResult = retryParse;
            intent = retryParse.intent;
            fallbackApplied = false;
            break;
          }
          // Adopt the latest attempt even when it still violates a guard, so
          // the structural outcomes below judge the model's final answer: a
          // still-repeating answer is blocked, a still-unresolved target is
          // floored. A parse fallback ends the arm as an llm_failure.
          parseResult = retryParse;
          intent = retryParse.intent;
          if (retryParse.fallbackApplied) {
            fallbackApplied = true;
            retryKind = "parse_failed";
            break;
          }
        } catch {
          fallbackApplied = true;
          intent = IntentParser.createFallback(agentId, "no_op", "Retry call failed.");
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

    // Target floor: after the retry arm, an intent whose reply/react target
    // is still unresolved never commits as-is — the triggering event (or the
    // most recent visible message) is inferred as the target; with no event
    // left to target, a reply downgrades to send_message and a reaction is
    // dropped. The repetition block above takes precedence: a near-duplicate
    // is never floored into a commit.
    let targetFloor: { detail: string; data: TargetResolutionFlooredData } | undefined;
    if (!fallbackApplied && parseResult.unresolvedTarget) {
      const bad = parseResult.unresolvedTarget;
      const floored = IntentParser.floorTargets(intent, targetContext);
      if (floored.outcome === "dropped") {
        fallbackApplied = true;
        retryKind = "parse_failed";
        parseResult = {
          ...parseResult,
          errorDetail: floored.detail ?? "Reaction target unresolvable; reaction dropped.",
          unresolvedTarget: undefined,
        };
        intent = IntentParser.createFallback(
          agentId,
          "no_op",
          floored.detail ?? "Reaction target unresolvable; reaction dropped.",
        );
      } else {
        intent = floored.intent;
        parseResult = { ...parseResult, errorDetail: undefined, unresolvedTarget: undefined };
        if (floored.outcome === "floored" || floored.outcome === "downgraded") {
          targetFloor = {
            detail: floored.detail ?? "",
            data: {
              field: floored.field,
              badHandle: bad.badHandle,
              outcome:
                floored.outcome === "downgraded"
                  ? "downgraded_to_send_message"
                  : "triggering_or_visible_event",
              ...(floored.resolvedEventId ? { resolvedEventId: floored.resolvedEventId } : {}),
            },
          };
        }
      }
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
    operatorEvents.push({
      type: "pulse_metrics",
      simulationId,
      agentId,
      pulseIndex: ctx.pulseIndex,
      detail: `LLM cognition call completed for agent ${agentId}`,
      createdAt: Date.now(),
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

    if (targetFloor) {
      operatorEvents.push({
        type: "target_resolution_floored",
        simulationId,
        agentId,
        pulseIndex: ctx.pulseIndex,
        detail: `Reply/reaction target for agent ${agentId} could not be resolved; engine floor applied: ${targetFloor.detail}`,
        createdAt: ctx.now,
        data: targetFloor.data,
      });
    }

    if (fallbackApplied && !repetitionBlocked) {
      const detail =
        retryKind === "provider_failed"
          ? `Retry provider call failed for agent ${agentId}; falling back to no_op.`
          : `LLM parsing or target constraint validation failed for agent ${agentId}: ${parseResult.errorDetail}`;
      operatorEvents.push({
        type: "llm_failure",
        simulationId,
        agentId,
        pulseIndex: ctx.pulseIndex,
        detail,
        createdAt: Date.now(),
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
        createdAt: Date.now(),
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
