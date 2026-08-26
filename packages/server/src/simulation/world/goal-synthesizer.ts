import type {
  GoalSynthesisResult,
  GoalSynthesizerInput,
  OperatorEvent,
  SynthesizerConfig,
  SynthesizerMode,
} from "@perfectman/shared";
import { GoalLayerLLMClient } from "./goal-layer-llm.js";
import {
  deterministicPassthrough,
  type GoalLayerLLMOutcome,
} from "./goal-layer-llm.js";
import type { GoalRegistry } from "./goal-registry.js";
import type { LLMConfig } from "../../llm/llm-config.js";
import type { LLMBudgetTracker } from "../../llm/llm-budget.js";

const DEFAULT_MAX_SELF_VERDICTS = 3;

/**
 * Goal-synthesis seam (LLMProvider pattern): the wrapper owns the await. The
 * deterministic implementation resolves synchronously; the LLM implementation
 * wraps the provider call in the server layer. This interface is the
 * reversible seam for that slice.
 */
export interface GoalSynthesizer {
  synthesize(input: GoalSynthesizerInput): Promise<GoalSynthesisResult[]>;
}

/**
 * Deterministic V1: verbatim passthrough — the crystallized proposal is the
 * framing. The agent-context digest is carried but not consumed; exercising
 * the contract now keeps the LLM slice growing into a proven shape.
 */
export class DeterministicGoalSynthesizer implements GoalSynthesizer {
  synthesize(input: GoalSynthesizerInput): Promise<GoalSynthesisResult[]> {
    return Promise.resolve(
      input.candidates.map((candidate) => ({
        proposal: candidate,
        narrativeFraming: candidate.targetState.description,
        confidence: 1,
        synthesizer: "deterministic",
      })),
    );
  }
}

/**
 * The evaluator resolves per-agent provider configs + the shared budget into
 * the synthesizer's deps; the optional client factory is the injected test
 * seam, while the evaluator-owned default constructs the real
 * `GoalLayerLLMClient` (D-18 configured-provider routing).
 */
export type GoalLayerClientFactory = (params: {
  simulationId: string;
  agentId: string;
  pulseIndex: number;
  llmConfig: LLMConfig;
  budget: LLMBudgetTracker;
}) => GoalLayerLLMClient;

export type LLMGoalSynthesizerDeps = {
  simulationId: string;
  llmConfigs: ReadonlyMap<string, LLMConfig>;
  budget: LLMBudgetTracker;
  registry: GoalRegistry;
  synthesizerConfig: SynthesizerConfig;
  clientFactory?: GoalLayerClientFactory;
};

/**
 * LLM-mode synthesizer: one combined interval call per agent (D-20) carrying
 * candidates + active goals. The client outcome's operator events accumulate
 * in a per-synthesizer buffer which the evaluator drains after each
 * synthesize; fallback/blocked/failed intervals return deterministic
 * passthrough with `selfVerdicts: []` and record nothing (D-19).
 */
export class LLMGoalSynthesizer implements GoalSynthesizer {
  private readonly pendingOperatorEvents: OperatorEvent[] = [];
  private reviewContext: { pulseIndex: number; now: number } = {
    pulseIndex: 0,
    now: 0,
  };

  constructor(private readonly deps: LLMGoalSynthesizerDeps) {}

  /**
   * Package-local per-review context (not on the GoalSynthesizer interface):
   * the evaluator sets it before each synthesize so the operator-event
   * literals and usage records carry the review's pulse/time.
   */
  setReviewContext(pulseIndex: number, now: number): void {
    this.reviewContext = { pulseIndex, now };
  }

  /** Drains and clears the accumulated operator events. */
  takeOperatorEvents(): OperatorEvent[] {
    return this.pendingOperatorEvents.splice(
      0,
      this.pendingOperatorEvents.length,
    );
  }

  async synthesize(input: GoalSynthesizerInput): Promise<GoalSynthesisResult[]> {
    const {
      simulationId,
      llmConfigs,
      budget,
      registry,
      synthesizerConfig,
      clientFactory,
    } = this.deps;
    const llmConfig = llmConfigs.get(input.agentId);
    if (!llmConfig) {
      throw new Error(
        `No LLM provider config for agent ${input.agentId}; goal-layer llm mode requires a configured provider per agent`,
      );
    }
    const activeGoals = registry
      .getGoals()
      .filter((goal) => goal.agentId === input.agentId)
      .slice(0, synthesizerConfig.maxSelfVerdictsPerReview ?? DEFAULT_MAX_SELF_VERDICTS);

    const clientParams = {
      simulationId,
      agentId: input.agentId,
      pulseIndex: this.reviewContext.pulseIndex,
      llmConfig,
      budget,
    };
    const client = clientFactory
      ? clientFactory(clientParams)
      : new GoalLayerLLMClient({ ...clientParams, now: this.reviewContext.now });

    let outcome: GoalLayerLLMOutcome;
    try {
      outcome = await client.call({
        candidates: input.candidates,
        activeGoals,
        digest: input.context,
      });
    } catch (err) {
      // A throwing injected client never escapes synthesize: deterministic
      // proposals still emit and the failure reaches the review.
      outcome = {
        result: deterministicPassthrough(input.candidates),
        operatorEvents: [
          {
            type: "llm_failure",
            simulationId,
            agentId: input.agentId,
            pulseIndex: this.reviewContext.pulseIndex,
            detail: `Goal-layer LLM call failed for agent ${input.agentId}: ${errorMessage(err)}`,
            createdAt: this.reviewContext.now,
          },
        ],
      };
    }

    // D-19 record gate: only a genuine LLM outcome stores self-verdicts.
    // Blocked/failed/thrown intervals record nothing, so a previously stored
    // "llm" belief survives the interval — stored-first resolution keeps
    // serving it and the structural in_progress verdict stays V1's transient
    // fallback, never persisted.
    const blocked = outcome.operatorEvents.some(
      (event) =>
        event.type === "llm_failure" || event.type === "llm_budget_exceeded",
    );
    if (!blocked) {
      // Mirrors the client's canonical reattach: only verdicts whose goalId
      // was actually fed to the model may enter the junction — a fabricated or
      // cap-excluded goalId would otherwise linger as unreachable state.
      const fedGoalIds = new Set(activeGoals.map((goal) => goal.id));
      for (const verdict of outcome.result.selfVerdicts) {
        if (fedGoalIds.has(verdict.goalId)) {
          registry.recordSelfVerdict(verdict.goalId, verdict, "llm");
        }
      }
    }
    this.pendingOperatorEvents.push(...outcome.operatorEvents);
    return outcome.result.proposals;
  }
}

/**
 * Factory resolution: deterministic ignores deps; the "llm" branch requires
 * the goal-layer deps and fails loudly (missing config is surfaced, never
 * silent).
 */
export function createGoalSynthesizer(
  mode: SynthesizerMode,
  deps?: LLMGoalSynthesizerDeps,
): GoalSynthesizer {
  switch (mode) {
    case "deterministic":
      return new DeterministicGoalSynthesizer();
    case "llm":
      if (!deps) {
        throw new Error(
          'synthesizer.mode "llm" requires the goal-layer LLM deps (llmConfigs, budget, registry, synthesizerConfig)',
        );
      }
      return new LLMGoalSynthesizer(deps);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
