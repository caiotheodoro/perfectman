import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentContextDigest,
  EmergentGoal,
  GoalProposal,
} from "@perfectman/shared";
import { LLMBudgetTracker } from "../../../llm/llm-budget.js";
import type { LLMConfig } from "../../../llm/llm-config.js";
import { GoalLayerLLMClient } from "../goal-layer-llm.js";

const SIM = "sim_1";
const AGENT = "agent_1";
const PULSE = 5;

function makeDigest(): AgentContextDigest {
  return { personaId: "persona-mia", recentMemories: [], privateMotiveSummaries: [] };
}

function makeCandidate(id: string): GoalProposal {
  return {
    id,
    agentId: AGENT,
    title: "Overcome the block in ch_public",
    targetState: {
      id: `predicate-${id}`,
      description: "no more blocked intents from agent_1 in ch_public",
      observableCriteria: ["no more blocked intents from agent_1 in ch_public"],
    },
    kind: "resolve",
    origin: "crystallized_from",
    sourceEventIds: ["seed-1"],
    createdAt: 1000,
  };
}

function makeGoal(id: string): EmergentGoal {
  return {
    id,
    agentId: AGENT,
    title: "Stay close to the group",
    targetState: {
      id: `predicate-${id}`,
      description: "keeps engaging in ch_public",
      observableCriteria: ["keeps engaging in ch_public"],
    },
    kind: "affiliation",
    status: "active",
    origin: "crystallized_from",
    sourceEventIds: ["seed-1"],
    createdAt: 2000,
  };
}

function makeClient(
  budget: LLMBudgetTracker,
  llmConfig: LLMConfig,
  now = Date.now(),
): GoalLayerLLMClient {
  return new GoalLayerLLMClient({
    simulationId: SIM,
    agentId: AGENT,
    pulseIndex: PULSE,
    now,
    llmConfig,
    budget,
  });
}

const MOCK_CONFIG: LLMConfig = {
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

const OPENAI_CONFIG: LLMConfig = {
  providerType: "openai-compatible",
  baseUrl: "http://goal-host/v1",
  modelName: "goal-model",
  maxInputTokens: 2000,
  maxOutputTokens: 512,
  temperature: 1,
  timeoutMs: 5000,
  retryCount: 0,
  responseFormatJson: false,
};

function freshBudget(): LLMBudgetTracker {
  const budget = new LLMBudgetTracker();
  budget.registerLimits(SIM, { llmCallBudgetPerMinute: 20, tokenBudgetPerHour: 100000 });
  return budget;
}

function okResponse(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

describe("GoalLayerLLMClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("mock leg: parses the canned combined JSON, records one 'goal' usage with promptVersion", async () => {
    const budget = freshBudget();
    const recordSpy = vi.spyOn(budget, "recordUsage");
    const client = makeClient(budget, MOCK_CONFIG);

    const outcome = await client.call({
      candidates: [makeCandidate("candidate-1")],
      activeGoals: [makeGoal("goal-1")],
      digest: makeDigest(),
    });

    expect(outcome.operatorEvents).toEqual([]);
    expect(outcome.result.proposals).toHaveLength(1);
    expect(outcome.result.proposals[0]!.proposal.id).toBe("candidate-1");
    expect(outcome.result.proposals[0]!.synthesizer).toBe("llm");
    expect(outcome.result.proposals[0]!.confidence).toBe(0.8);
    expect(outcome.result.selfVerdicts).toHaveLength(1);
    expect(outcome.result.selfVerdicts[0]!.goalId).toBe("goal-1");
    expect(outcome.result.selfVerdicts[0]!.claim).toBe("in_progress");

    expect(budget.getStatus(SIM).callsThisMinute).toBe(1);
    expect(recordSpy).toHaveBeenCalledTimes(1);
    const usage = recordSpy.mock.calls[0]![0];
    expect(usage.callType).toBe("goal");
    expect(usage.model).toBe("mock-model");
    expect(usage.simulationId).toBe(SIM);
    expect(usage.pulseIndex).toBe(PULSE);
    expect(usage.promptVersion).toMatch(/^[0-9a-z]+$/);
    expect(usage.promptTemplateVersion).toBe("goal-layer-v1");
  });

  it("budget-blocked: deterministic passthrough, empty selfVerdicts, llm_budget_exceeded, no usage", async () => {
    const budget = new LLMBudgetTracker();
    budget.registerLimits(SIM, { llmCallBudgetPerMinute: 0, tokenBudgetPerHour: 100000 });
    const recordSpy = vi.spyOn(budget, "recordUsage");
    const client = makeClient(budget, MOCK_CONFIG);

    const outcome = await client.call({
      candidates: [makeCandidate("candidate-1")],
      activeGoals: [makeGoal("goal-1")],
      digest: makeDigest(),
    });

    expect(outcome.result.proposals[0]!.synthesizer).toBe("deterministic");
    expect(outcome.result.proposals[0]!.narrativeFraming).toBe(
      makeCandidate("candidate-1").targetState.description,
    );
    expect(outcome.result.selfVerdicts).toEqual([]);
    const event = outcome.operatorEvents.find((e) => e.type === "llm_budget_exceeded");
    expect(event?.detail).toContain("goal synthesis");
    expect(event?.simulationId).toBe(SIM);
    expect(recordSpy).not.toHaveBeenCalled();
    expect(budget.getStatus(SIM).callsThisMinute).toBe(0);
  });

  it("provider 5xx: llm_failure operator event + deterministic fallback with empty selfVerdicts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 })),
    );
    const budget = freshBudget();
    const client = makeClient(budget, OPENAI_CONFIG);

    const outcome = await client.call({
      candidates: [makeCandidate("candidate-1")],
      activeGoals: [],
      digest: makeDigest(),
    });

    expect(outcome.result.proposals).toHaveLength(1);
    expect(outcome.result.proposals[0]!.synthesizer).toBe("deterministic");
    expect(outcome.result.selfVerdicts).toEqual([]);
    const event = outcome.operatorEvents.find((e) => e.type === "llm_failure");
    expect(event?.detail).toContain("failed");
    // A failed wire call records no usage.
    expect(budget.getStatus(SIM).callsThisMinute).toBe(0);
  });

  it("transport rejection: llm_failure operator event + deterministic fallback, no usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    const budget = freshBudget();
    const client = makeClient(budget, OPENAI_CONFIG);

    const outcome = await client.call({
      candidates: [makeCandidate("candidate-1")],
      activeGoals: [],
      digest: makeDigest(),
    });

    expect(outcome.result.proposals[0]!.synthesizer).toBe("deterministic");
    expect(outcome.result.selfVerdicts).toEqual([]);
    const event = outcome.operatorEvents.find((e) => e.type === "llm_failure");
    expect(event?.detail).toContain("network down");
    expect(budget.getStatus(SIM).callsThisMinute).toBe(0);
  });

  it("stamps llm_budget_exceeded and llm_failure createdAt with wall-clock time, not the sim clock", async () => {
    const simClock = 5000;

    const blockedBudget = new LLMBudgetTracker();
    blockedBudget.registerLimits(SIM, { llmCallBudgetPerMinute: 0, tokenBudgetPerHour: 100000 });
    const blockedOutcome = await makeClient(blockedBudget, MOCK_CONFIG, simClock).call({
      candidates: [makeCandidate("candidate-1")],
      activeGoals: [makeGoal("goal-1")],
      digest: makeDigest(),
    });
    const budgetEvent = blockedOutcome.operatorEvents.find(
      (e) => e.type === "llm_budget_exceeded",
    );
    expect(budgetEvent!.createdAt).toBeGreaterThan(1_600_000_000_000);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const failureOutcome = await makeClient(freshBudget(), OPENAI_CONFIG, simClock).call({
      candidates: [makeCandidate("candidate-1")],
      activeGoals: [],
      digest: makeDigest(),
    });
    const failureEvent = failureOutcome.operatorEvents.find((e) => e.type === "llm_failure");
    expect(failureEvent!.createdAt).toBeGreaterThan(1_600_000_000_000);
  });

  it("unparseable JSON: whole-call fallback via llm_failure, nothing recorded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse(JSON.stringify({ unexpected: true }))),
    );
    const budget = freshBudget();
    const client = makeClient(budget, OPENAI_CONFIG);

    const outcome = await client.call({
      candidates: [makeCandidate("candidate-1")],
      activeGoals: [makeGoal("goal-1")],
      digest: makeDigest(),
    });

    expect(outcome.result.proposals).toHaveLength(1);
    expect(outcome.result.proposals[0]!.synthesizer).toBe("deterministic");
    expect(outcome.result.selfVerdicts).toEqual([]);
    const event = outcome.operatorEvents.find((e) => e.type === "llm_failure");
    expect(event).toBeDefined();
    expect(budget.getStatus(SIM).callsThisMinute).toBe(0);
  });

  it("drops hallucinated proposal ids not fed to the model (engine owns the proposal set)", async () => {
    const candidate = makeCandidate("candidate-1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse(
          JSON.stringify({
            proposals: [
              {
                proposalId: "candidate-1",
                narrativeFraming: "real framing",
                confidence: 0.9,
                synthesizer: "llm",
              },
              {
                proposalId: "hallucinated-9",
                narrativeFraming: "hallucinated framing",
                confidence: 0.9,
                synthesizer: "llm",
              },
            ],
            selfVerdicts: [],
          }),
        ),
      ),
    );
    const budget = freshBudget();
    const client = makeClient(budget, OPENAI_CONFIG);

    const outcome = await client.call({
      candidates: [candidate],
      activeGoals: [],
      digest: makeDigest(),
    });

    expect(outcome.result.proposals).toHaveLength(1);
    expect(outcome.result.proposals[0]!.proposal.id).toBe("candidate-1");
    expect(outcome.result.proposals[0]!.narrativeFraming).toBe("real framing");
    expect(budget.getStatus(SIM).callsThisMinute).toBe(1);
  });

  it("reattaches a model-shaped response that references the fed ids (proposalId + goalId)", async () => {
    const candidate = makeCandidate("candidate-1");
    const goal = makeGoal("goal-1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse(
          JSON.stringify({
            proposals: [
              {
                proposalId: candidate.id,
                narrativeFraming: "in-character framing",
                confidence: 0.7,
                synthesizer: "llm",
              },
            ],
            selfVerdicts: [
              {
                agentId: AGENT,
                goalId: goal.id,
                claim: "in_progress",
                confidence: 0.6,
                feltSignal: 0.4,
                narrative: "still working it",
              },
            ],
          }),
        ),
      ),
    );
    const budget = freshBudget();
    const client = makeClient(budget, OPENAI_CONFIG);

    const outcome = await client.call({
      candidates: [candidate],
      activeGoals: [goal],
      digest: makeDigest(),
    });

    expect(outcome.result.proposals).toHaveLength(1);
    expect(outcome.result.proposals[0]!.proposal).toEqual(candidate);
    expect(outcome.result.proposals[0]!.narrativeFraming).toBe("in-character framing");
    expect(outcome.result.proposals[0]!.synthesizer).toBe("llm");
    expect(outcome.result.selfVerdicts).toHaveLength(1);
    expect(outcome.result.selfVerdicts[0]!.goalId).toBe(goal.id);
    expect(budget.getStatus(SIM).callsThisMinute).toBe(1);
  });

  it("empty candidates with empty active goals: no call, empty outcome", async () => {
    const budget = freshBudget();
    const recordSpy = vi.spyOn(budget, "recordUsage");
    const client = makeClient(budget, MOCK_CONFIG);

    const outcome = await client.call({
      candidates: [],
      activeGoals: [],
      digest: makeDigest(),
    });

    expect(outcome).toEqual({ result: { proposals: [], selfVerdicts: [] }, operatorEvents: [] });
    expect(recordSpy).not.toHaveBeenCalled();
    expect(budget.getStatus(SIM).callsThisMinute).toBe(0);
  });

  it("empty candidates with active goals present still skips the call (candidates gate the combined call)", async () => {
    const budget = freshBudget();
    const recordSpy = vi.spyOn(budget, "recordUsage");
    const client = makeClient(budget, MOCK_CONFIG);

    const outcome = await client.call({
      candidates: [],
      activeGoals: [makeGoal("goal-1")],
      digest: makeDigest(),
    });

    expect(outcome.result.proposals).toEqual([]);
    expect(outcome.result.selfVerdicts).toEqual([]);
    expect(recordSpy).not.toHaveBeenCalled();
    expect(budget.getStatus(SIM).callsThisMinute).toBe(0);
  });
});
