import { describe, it, expect } from "vitest";
import type { GoalProposal } from "@perfectman/shared";
import {
  createGoalSynthesizer,
  DeterministicGoalSynthesizer,
} from "../goal-synthesizer.js";

const AGENT = "agent_1";

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
  it("passes the candidate through verbatim with zero reframing", () => {
    const candidate = makeCandidate("candidate-1");
    const results = new DeterministicGoalSynthesizer().synthesize({
      agentId: AGENT,
      candidates: [candidate],
      context: { personaId: "p1", recentMemories: [], privateMotiveSummaries: [] },
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.proposal).toEqual(candidate);
  });

  it("frames with the target-state description and full certainty", () => {
    const candidate = makeCandidate("candidate-1");
    const [result] = new DeterministicGoalSynthesizer().synthesize({
      agentId: AGENT,
      candidates: [candidate],
      context: { personaId: "p1", recentMemories: [], privateMotiveSummaries: [] },
    });
    expect(result!.narrativeFraming).toBe(candidate.targetState.description);
    expect(result!.confidence).toBe(1);
    expect(result!.synthesizer).toBe("deterministic");
  });

  it("preserves input order", () => {
    const a = makeCandidate("candidate-a");
    const b = makeCandidate("candidate-b");
    const results = new DeterministicGoalSynthesizer().synthesize({
      agentId: AGENT,
      candidates: [a, b],
      context: { personaId: "p1", recentMemories: [], privateMotiveSummaries: [] },
    });
    expect(results.map((r) => r.proposal.id)).toEqual(["candidate-a", "candidate-b"]);
  });

  it("passes duplicate candidate ids through unchanged (registry dedupes, not the synthesizer)", () => {
    const dupe = makeCandidate("candidate-1");
    const results = new DeterministicGoalSynthesizer().synthesize({
      agentId: AGENT,
      candidates: [dupe, dupe],
      context: { personaId: "p1", recentMemories: [], privateMotiveSummaries: [] },
    });
    expect(results).toHaveLength(2);
    expect(results[0]!.proposal).toEqual(dupe);
    expect(results[1]!.proposal).toEqual(dupe);
  });

  it("returns an empty list for empty candidates", () => {
    const results = new DeterministicGoalSynthesizer().synthesize({
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

  it("throws for the unwired llm mode naming the D-13 slice", () => {
    expect(() => createGoalSynthesizer("llm")).toThrow(
      'synthesizer.mode "llm" is not wired in this slice; lands with the LLM synthesizer slice',
    );
  });
});