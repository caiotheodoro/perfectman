import { describe, it, expect } from "vitest";
import type {
  AgentContextDigest,
  EmergentGoal,
  GoalProposal,
} from "@perfectman/shared";
import { promptVersionHash } from "../../../agent/prompt-version.js";
import { buildGoalLayerPrompt } from "../goal-layer-prompt-builder.js";

const AGENT = "agent_1";

function makeDigest(overrides: Partial<AgentContextDigest> = {}): AgentContextDigest {
  return {
    personaId: "persona-mia",
    recentMemories: [],
    privateMotiveSummaries: [],
    ...overrides,
  };
}

function makeCandidate(id: string, title: string): GoalProposal {
  return {
    id,
    agentId: AGENT,
    title,
    targetState: {
      id: `predicate-${id}`,
      description: `description for ${id}`,
      observableCriteria: [`criterion ${id}`],
    },
    kind: "resolve",
    origin: "crystallized_from",
    sourceEventIds: ["seed-1"],
    createdAt: 1000,
  };
}

function makeGoal(id: string, title: string): EmergentGoal {
  return {
    id,
    agentId: AGENT,
    title,
    targetState: {
      id: `predicate-${id}`,
      description: `description for active ${id}`,
      observableCriteria: [`criterion ${id}`],
    },
    kind: "affiliation",
    status: "active",
    origin: "crystallized_from",
    sourceEventIds: ["seed-1"],
    createdAt: 2000,
  };
}

describe("buildGoalLayerPrompt", () => {
  const candidate = makeCandidate("candidate-1", "Overcome the block in ch_public");
  const goal = makeGoal("goal-1", "Stay close to the group after the argument");
  const digest = makeDigest();

  it("renders a BuiltPrompt with the goal_synthesis purpose and a stable version contract", () => {
    const a = buildGoalLayerPrompt({ agentId: AGENT, digest, candidates: [candidate], activeGoals: [goal] });
    const b = buildGoalLayerPrompt({ agentId: AGENT, digest, candidates: [candidate], activeGoals: [goal] });

    expect(a.purpose).toBe("goal_synthesis");
    expect(a.templateVersion).toBe("goal-layer-v1");
    expect(a.version).toBe(promptVersionHash([a.system, a.user]));
    expect(a.version).toBe(b.version);
    expect(a.inputTokensEstimate).toBeGreaterThan(0);
  });

  it("names the persona id and the JSON contract markers in the system text", () => {
    const prompt = buildGoalLayerPrompt({ agentId: AGENT, digest, candidates: [candidate], activeGoals: [goal] });

    expect(prompt.system).toContain(digest.personaId);
    expect(prompt.system).toContain('"proposals"');
    expect(prompt.system).toContain('"selfVerdicts"');
    expect(prompt.system).toContain("Goldilocks");
  });

  it("lists every candidate title and every active-goal title in the user text", () => {
    const other = makeCandidate("candidate-2", "Ship a lesson for the community");
    const otherGoal = makeGoal("goal-2", "Keep the resolve arc moving");
    const prompt = buildGoalLayerPrompt({
      agentId: AGENT,
      digest,
      candidates: [candidate, other],
      activeGoals: [goal, otherGoal],
    });

    for (const title of [
      candidate.title,
      other.title,
      goal.title,
      otherGoal.title,
    ]) {
      expect(prompt.user).toContain(title);
    }
  });

  it("renders every candidate and active goal with its bracketed id (the prompt↔reattach contract)", () => {
    const other = makeCandidate("candidate-2", "Ship a lesson for the community");
    const otherGoal = makeGoal("goal-2", "Keep the resolve arc moving");
    const prompt = buildGoalLayerPrompt({
      agentId: AGENT,
      digest,
      candidates: [candidate, other],
      activeGoals: [goal, otherGoal],
    });

    for (const id of [candidate.id, other.id, goal.id, otherGoal.id]) {
      expect(prompt.user).toContain(`[${id}]`);
      expect(prompt.system).toContain("proposalId");
      expect(prompt.system).toContain("goalId");
    }
  });

  it("renders an explicit empty candidate section when no candidates exist", () => {
    const prompt = buildGoalLayerPrompt({ agentId: AGENT, digest, candidates: [], activeGoals: [goal] });

    expect(prompt.user).toContain("Candidate goals crystallized from recent history:\n- none");
    expect(prompt.user).toContain(goal.title);
  });

  it("renders an explicit empty active-goals section when none exist", () => {
    const prompt = buildGoalLayerPrompt({ agentId: AGENT, digest, candidates: [candidate], activeGoals: [] });

    expect(prompt.user).toContain("Active goals to self-assess:\n- none");
    expect(prompt.user).toContain(candidate.title);
  });

  it("caps the digest memory rendering at 10 memories regardless of input size", () => {
    const memories = Array.from({ length: 15 }, (_, i) => ({
      summary: `mem-${i}`,
      sourceEventIds: [`source-${i}`],
    }));
    const prompt = buildGoalLayerPrompt({
      agentId: AGENT,
      digest: makeDigest({ recentMemories: memories }),
      candidates: [],
      activeGoals: [],
    });

    expect((prompt.user.match(/mem-\d/g) ?? []).length).toBe(10);
  });

  it("caps the digest motive rendering at 5 motives regardless of input size", () => {
    const motives = Array.from({ length: 8 }, (_, i) => `mot-${i}`);
    const prompt = buildGoalLayerPrompt({
      agentId: AGENT,
      digest: makeDigest({ privateMotiveSummaries: motives }),
      candidates: [],
      activeGoals: [],
    });

    expect((prompt.user.match(/mot-\d/g) ?? []).length).toBe(5);
  });
});
