import { describe, it, expect } from "vitest";
import type {
  GoalProposal,
  SelfVerdict,
  SynthesizerConfig,
} from "@perfectman/shared";
import { LLMBudgetTracker } from "../../../llm/llm-budget.js";
import type { LLMConfig } from "../../../llm/llm-config.js";
import {
  GoalLayerLLMClient,
  type GoalLayerCallInput,
  type GoalLayerLLMOutcome,
} from "../goal-layer-llm.js";
import { GoalRegistry } from "../goal-registry.js";
import {
  createGoalSynthesizer,
  DeterministicGoalSynthesizer,
  LLMGoalSynthesizer,
  type GoalLayerClientFactory,
} from "../goal-synthesizer.js";

const AGENT = "agent_1";

const MOCK_LLM: LLMConfig = {
  providerType: "mock",
  modelName: "mock-model",
  baseUrl: "http://localhost",
  maxInputTokens: 2000,
  maxOutputTokens: 512,
  temperature: 1,
  timeoutMs: 5000,
  retryCount: 0,
  responseFormatJson: false,
};

function makeCandidate(id: string): GoalProposal {
  return {
    id,
    agentId: AGENT,
    title: "Overcome the repeated block in ch_public",
    targetState: {
      id: "predicate-resolve-ch_public",
      description: "no more blocked intents from agent_1 in ch_public",
      observableCriteria: [
        "no more blocked intents from agent_1 in ch_public",
        "a successful follow-up in ch_public after the blocks",
      ],
    },
    kind: "resolve",
    origin: "crystallized_from",
    sourceEventIds: ["seed-1", "seed-2", "seed-3"],
    createdAt: 3000,
  };
}

describe("DeterministicGoalSynthesizer", () => {
  it("passes the candidate through verbatim with zero reframing", async () => {
    const candidate = makeCandidate("candidate-1");
    const results = await new DeterministicGoalSynthesizer().synthesize({
      agentId: AGENT,
      candidates: [candidate],
      context: { personaId: "p1", recentMemories: [], privateMotiveSummaries: [] },
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.proposal).toEqual(candidate);
  });

  it("frames with the target-state description and full certainty", async () => {
    const candidate = makeCandidate("candidate-1");
    const [result] = await new DeterministicGoalSynthesizer().synthesize({
      agentId: AGENT,
      candidates: [candidate],
      context: { personaId: "p1", recentMemories: [], privateMotiveSummaries: [] },
    });
    expect(result!.narrativeFraming).toBe(candidate.targetState.description);
    expect(result!.confidence).toBe(1);
    expect(result!.synthesizer).toBe("deterministic");
  });

  it("preserves input order", async () => {
    const a = makeCandidate("candidate-a");
    const b = makeCandidate("candidate-b");
    const results = await new DeterministicGoalSynthesizer().synthesize({
      agentId: AGENT,
      candidates: [a, b],
      context: { personaId: "p1", recentMemories: [], privateMotiveSummaries: [] },
    });
    expect(results.map((r) => r.proposal.id)).toEqual(["candidate-a", "candidate-b"]);
  });

  it("passes duplicate candidate ids through unchanged (registry dedupes, not the synthesizer)", async () => {
    const dupe = makeCandidate("candidate-1");
    const results = await new DeterministicGoalSynthesizer().synthesize({
      agentId: AGENT,
      candidates: [dupe, dupe],
      context: { personaId: "p1", recentMemories: [], privateMotiveSummaries: [] },
    });
    expect(results).toHaveLength(2);
    expect(results[0]!.proposal).toEqual(dupe);
    expect(results[1]!.proposal).toEqual(dupe);
  });

  it("returns an empty list for empty candidates", async () => {
    const results = await new DeterministicGoalSynthesizer().synthesize({
      agentId: AGENT,
      candidates: [],
      context: { personaId: "p1", recentMemories: [], privateMotiveSummaries: [] },
    });
    expect(results).toEqual([]);
  });
});

describe("createGoalSynthesizer", () => {
  it("resolves the deterministic implementation for deterministic mode", () => {
    expect(createGoalSynthesizer("deterministic")).toBeInstanceOf(
      DeterministicGoalSynthesizer,
    );
  });

  it("throws for llm mode without the goal-layer LLM deps, naming the requirement", () => {
    expect(() => createGoalSynthesizer("llm")).toThrow(
      'synthesizer.mode "llm" requires the goal-layer LLM deps (llmConfigs, budget, registry, synthesizerConfig)',
    );
  });
});

describe("LLMGoalSynthesizer", () => {
  function promote(registry: GoalRegistry, id: string): void {
    const proposal = makeCandidate(id);
    registry.recordProposal(proposal);
    registry.promoteProposal(proposal.id);
  }

  function makeSynthesizer(registry: GoalRegistry, clientFactory: GoalLayerClientFactory) {
    const config: SynthesizerConfig = {
      mode: "llm",
      intervalPulses: 2,
      maxCandidatesPerReview: 5,
      maxSelfVerdictsPerReview: 1,
    };
    return new LLMGoalSynthesizer({
      simulationId: "sim_1",
      llmConfigs: new Map([[AGENT, MOCK_LLM]]),
      budget: new LLMBudgetTracker(),
      registry,
      synthesizerConfig: config,
      clientFactory,
    });
  }

  it("stores only self-verdicts whose goalId was actually fed to the client (mirror of the canonical reattach)", async () => {
    const registry = new GoalRegistry();
    promote(registry, "goal-fed");
    promote(registry, "goal-capped");
    const verdictFor = (goalId: string): SelfVerdict => ({
      agentId: AGENT,
      goalId,
      claim: "in_progress",
      confidence: 0.8,
      feltSignal: 0.5,
      narrative: `${goalId}: in progress`,
    });
    const clientFactory: GoalLayerClientFactory = () => {
      // GoalLayerLLMClient's private constructor params make a literal stub
      // untypeable, so build from the prototype — only call() is overridden.
      const caller = Object.create(GoalLayerLLMClient.prototype) as GoalLayerLLMClient;
      caller.call = async (input: GoalLayerCallInput): Promise<GoalLayerLLMOutcome> => ({
        result: {
          proposals: input.candidates.map((candidate) => ({
            proposal: candidate,
            narrativeFraming: candidate.targetState.description,
            confidence: 0.8,
            synthesizer: "llm" as const,
          })),
          selfVerdicts: [
            verdictFor("goal-fed"),
            verdictFor("goal-capped"),
            verdictFor("hallucinated-9"),
          ],
        },
        operatorEvents: [],
      });
      return caller;
    };
    const synthesizer = makeSynthesizer(registry, clientFactory);

    const results = await synthesizer.synthesize({
      agentId: AGENT,
      candidates: [makeCandidate("candidate-1")],
      context: { personaId: "p1", recentMemories: [], privateMotiveSummaries: [] },
    });

    expect(results).toHaveLength(1);
    expect(registry.getSelfVerdict("goal-fed")).toBeDefined();
    expect(registry.getSelfVerdict("goal-capped")).toBeUndefined();
    expect(registry.getSelfVerdict("hallucinated-9")).toBeUndefined();
  });

  it("stamps the llm_failure operator event from a throwing client with wall-clock time, not the review's sim clock", async () => {
    const registry = new GoalRegistry();
    promote(registry, "goal-1");
    const clientFactory: GoalLayerClientFactory = () => {
      // GoalLayerLLMClient's private constructor params make a literal stub
      // untypeable, so build from the prototype — only call() is overridden.
      const caller = Object.create(GoalLayerLLMClient.prototype) as GoalLayerLLMClient;
      caller.call = async (): Promise<GoalLayerLLMOutcome> => {
        throw new Error("client blew up");
      };
      return caller;
    };
    const synthesizer = makeSynthesizer(registry, clientFactory);
    synthesizer.setReviewContext(7, 5000);

    await synthesizer.synthesize({
      agentId: AGENT,
      candidates: [makeCandidate("candidate-1")],
      context: { personaId: "p1", recentMemories: [], privateMotiveSummaries: [] },
    });

    const events = synthesizer.takeOperatorEvents();
    const failure = events.find((e) => e.type === "llm_failure");
    expect(failure!.pulseIndex).toBe(7);
    expect(failure!.createdAt).toBeGreaterThan(1_600_000_000_000);
  });
});