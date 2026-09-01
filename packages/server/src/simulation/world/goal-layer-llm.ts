import type {
  AgentContextDigest,
  EmergentGoal,
  GoalProposal,
  GoalSynthesisResult,
  LLMUsage,
  OperatorEvent,
  SelfVerdict,
} from "@perfectman/shared";
import {
  GoalLayerLLMResponseSchema,
  type GoalLayerLLMResponse,
} from "@perfectman/shared";
import type { BuiltPrompt } from "../../agent/agent-runtime.types.js";
import type { LLMConfig } from "../../llm/llm-config.js";
import type { LLMBudgetTracker } from "../../llm/llm-budget.js";
import type { LlmTransportDeps } from "../../llm/sdk-transport.js";
import {
  generateOllamaIntent,
  generateOpenAiCompatibleIntent,
} from "../../llm/sdk-transport.js";
import { buildGoalLayerPrompt } from "./goal-layer-prompt-builder.js";

export type GoalLayerLLMResult = {
  proposals: GoalSynthesisResult[];
  selfVerdicts: SelfVerdict[];
};

export type GoalLayerLLMOutcome = {
  result: GoalLayerLLMResult;
  operatorEvents: OperatorEvent[];
};

export type GoalLayerLLMClientParams = {
  simulationId: string;
  agentId: string;
  pulseIndex: number;
  now: number;
  /** The simulation's configured provider — routed by providerType, never fabricated. */
  llmConfig: LLMConfig;
  budget: LLMBudgetTracker;
  deps?: LlmTransportDeps;
};

export type GoalLayerCallInput = {
  candidates: GoalProposal[];
  activeGoals: EmergentGoal[];
  digest: AgentContextDigest;
};

/**
 * The goal-layer LLM call class ("goal" call type): render the combined prompt,
 * budget-gate, dispatch over the exported transport functions (mock | ollama |
 * openai-compatible), salvage + zod-parse the combined JSON, and fall back
 * honestly (deterministic passthrough + `selfVerdicts: []`, provenance
 * `"deterministic"`) with an operator event when blocked or failed. Failures
 * never escape `call`; nothing transient is stored as a belief (D-19).
 */
export class GoalLayerLLMClient {
  constructor(private readonly params: GoalLayerLLMClientParams) {}

  async call(input: GoalLayerCallInput): Promise<GoalLayerLLMOutcome> {
    const { candidates } = input;
    if (candidates.length === 0) {
      return { result: { proposals: [], selfVerdicts: [] }, operatorEvents: [] };
    }
    const { simulationId, agentId, pulseIndex } = this.params;
    const prompt = buildGoalLayerPrompt({
      agentId,
      digest: input.digest,
      candidates,
      activeGoals: input.activeGoals,
    });

    const priority = this.params.budget.getPriority(simulationId, agentId);
    const budgetDecision = this.params.budget.canCall({
      simulationId,
      agentId,
      priority,
      inputTokensEstimate: prompt.inputTokensEstimate,
    });
    if (!budgetDecision.allowed) {
      return {
        result: deterministicPassthrough(candidates),
        operatorEvents: [
          {
            type: "llm_budget_exceeded",
            simulationId,
            agentId,
            pulseIndex,
            detail: `LLM budget pre-check blocked goal synthesis for agent ${agentId}: ${budgetDecision.reason ?? "unknown reason"}`,
            createdAt: Date.now(),
          },
        ],
      };
    }

    try {
      const transport = await this.callTransport(prompt, input);
      const parsed = parseGoalLayerResponse(transport.content);
      const canonicalById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      // Engine owns the proposal structure: only candidates actually fed to the
      // model may be endorsed (a hallucinated id is dropped), and provenance is
      // forced honest — the model only ever supplies framing.
      const proposals = parsed.proposals
        .filter((entry) => canonicalById.has(entry.proposalId))
        .map((entry) => ({
          proposal: canonicalById.get(entry.proposalId)!,
          narrativeFraming: entry.narrativeFraming,
          confidence: entry.confidence,
          synthesizer: "llm" as const,
        }));

      this.params.budget.recordUsage(this.toUsage(transport, prompt));
      return {
        result: { proposals, selfVerdicts: parsed.selfVerdicts },
        operatorEvents: [],
      };
    } catch (error) {
      return {
        result: deterministicPassthrough(candidates),
        operatorEvents: [
          {
            type: "llm_failure",
            simulationId,
            agentId,
            pulseIndex,
            detail: `Goal-layer LLM call failed for agent ${agentId}: ${errorMessage(error)}`,
            createdAt: Date.now(),
          },
        ],
      };
    }
  }

  private async callTransport(
    prompt: BuiltPrompt,
    input: GoalLayerCallInput,
  ): Promise<GoalLayerTransportResult> {
    const { llmConfig, deps } = this.params;
    if (llmConfig.providerType === "mock") {
      return {
        content: mockCombinedJson(input),
        model: "mock-model",
        usage: {
          inputTokens: prompt.inputTokensEstimate,
          outputTokens: 0,
          latencyMs: 0,
        },
      };
    }
    // Text mode: the local salvage owns the JSON contract, so the intent-packet
    // schema must never reach the transport (P2 — llm/ stays untouched).
    const transportConfig = {
      ...llmConfig,
      responseFormatJson: false,
      responseFormatJsonSchema: false,
    };
    const startTime = Date.now();
    const result =
      llmConfig.providerType === "ollama"
        ? await generateOllamaIntent(transportConfig, prompt, startTime, deps)
        : await generateOpenAiCompatibleIntent(transportConfig, prompt, startTime, deps);
    return {
      content: result.content,
      model: result.model || llmConfig.modelName,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        latencyMs: result.latencyMs,
      },
    };
  }

  private toUsage(
    transport: GoalLayerTransportResult,
    prompt: BuiltPrompt,
  ): LLMUsage {
    const { simulationId, agentId, pulseIndex, now } = this.params;
    const { model, usage } = transport;
    return {
      simulationId,
      agentId,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      latencyMs: usage.latencyMs,
      callType: "goal",
      pulseIndex,
      createdAt: now,
      promptVersion: prompt.version,
      promptTemplateVersion: prompt.templateVersion,
    };
  }
}

type GoalLayerTransportResult = {
  content: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; latencyMs: number };
};

/** Deterministic canned combined-JSON mock producer (D-19), routed through the same parse path. */
function mockCombinedJson(input: GoalLayerCallInput): string {
  return JSON.stringify({
    proposals: input.candidates.map((candidate) => ({
      proposalId: candidate.id,
      narrativeFraming: `${candidate.title} — ${candidate.targetState.description}`,
      confidence: 0.8,
      synthesizer: "llm",
    })),
    selfVerdicts: input.activeGoals.map((goal) => ({
      agentId: goal.agentId,
      goalId: goal.id,
      claim: "in_progress",
      confidence: 0.8,
      feltSignal: 0.5,
      narrative: `${goal.title}: in progress`,
    })),
  });
}

function parseGoalLayerResponse(content: string): GoalLayerLLMResponse {
  const salvaged = salvageJsonObject(content);
  if (salvaged === null) {
    throw new Error("Goal-layer LLM response contained no parseable JSON object.");
  }
  return GoalLayerLLMResponseSchema.parse(JSON.parse(salvaged));
}

/**
 * Balanced-brace scan for the first top-level JSON object (the narrator's
 * extractJsonObject analog): immune to prose braces before the object and to a
 * trailing reasoning block after it.
 */
function salvageJsonObject(content: string): string | null {
  const start = content.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < content.length; i++) {
    const ch = content[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0) return content.slice(start, i + 1);
    }
  }
  return null;
}

/** Fallback = deterministic passthrough proposals + no verdicts (D-19, V-1). */
export function deterministicPassthrough(
  candidates: GoalProposal[],
): GoalLayerLLMResult {
  return {
    proposals: candidates.map((candidate) => ({
      proposal: candidate,
      narrativeFraming: candidate.targetState.description,
      confidence: 1,
      synthesizer: "deterministic",
    })),
    selfVerdicts: [],
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
