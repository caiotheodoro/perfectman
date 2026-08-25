import { describe, it, expect } from "vitest";
import type { GoalProposal, GoalRating } from "@perfectman/shared";
import { AutoAcceptanceGate, createAcceptanceGate } from "../acceptance-gate.js";

const AGENT = "agent_1";

function makeProposal(): GoalProposal {
  return {
    id: "crystal-agent_1-resolve-ch_public",
    agentId: AGENT,
    title: "Overcome the repeated block in ch_public",
    targetState: {
      id: "predicate-resolve-ch_public",
      description: "no more blocked intents from agent_1 in ch_public",
      observableCriteria: ["no more blocked intents from agent_1 in ch_public"],
    },
    kind: "resolve",
    origin: "crystallized_from",
    sourceEventIds: [],
    createdAt: 3000,
  };
}

function makeRating(recommendAccept: boolean, reasons: string[]): GoalRating {
  return {
    proposalId: "crystal-agent_1-resolve-ch_public",
    recommendAccept,
    score: recommendAccept ? 1 : 0.1,
    empowermentGain: 0.5,
    reasons,
  };
}

describe("AutoAcceptanceGate", () => {
  it("accepts an accept-rated proposal with the critic's reasons", () => {
    const gate = new AutoAcceptanceGate();
    const decision = gate.decide(
      makeProposal(),
      makeRating(true, ["novelty 1.00 × learnability 1.00"]),
    );
    expect(decision.decision).toBe("accept");
    expect(decision.reason).toBe("novelty 1.00 × learnability 1.00");
  });

  it("declines a reject-rated proposal with the critic's reasons", () => {
    const gate = new AutoAcceptanceGate();
    const decision = gate.decide(
      makeProposal(),
      makeRating(false, ["already trivial", "outside the Goldilocks band"]),
    );
    expect(decision.decision).toBe("decline");
    expect(decision.reason).toBe("already trivial; outside the Goldilocks band");
  });
});

describe("createAcceptanceGate", () => {
  it("resolves the auto implementation for auto mode", () => {
    expect(createAcceptanceGate("auto")).toBeInstanceOf(AutoAcceptanceGate);
  });

  it("throws for the unwired agent mode naming the D-13 slice", () => {
    expect(() => createAcceptanceGate("agent")).toThrow(
      'acceptance.mode "agent" is not wired in this slice; lands with the LLM synthesizer slice',
    );
  });
});