import { describe, it, expect } from "vitest";
import type {
  AgentAcceptanceContext,
  CommittedEvent,
  GoalProposal,
  GoalRating,
} from "@perfectman/shared";
import {
  AgentAcceptanceGate,
  AutoAcceptanceGate,
  createAcceptanceGate,
} from "../acceptance-gate.js";

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

function makeBehaviorEvent(
  id: string,
  actorId: string,
  type: string,
  channelId = "ch_public",
): CommittedEvent {
  return {
    id,
    simulationId: "sim_1",
    channelId,
    actorId,
    type,
    payload: {},
    sourceEventIds: [],
    emotionalSalience: "low",
    pulseIndex: 0,
    createdAt: 4000,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public",
    },
  };
}

function makeContext(window: CommittedEvent[]): AgentAcceptanceContext {
  return {
    behaviorWindow: window,
    digest: { personaId: "persona-mia", recentMemories: [], privateMotiveSummaries: [] },
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

  it("ignores the acceptance context — output identical with and without it", () => {
    const gate = new AutoAcceptanceGate();
    const rating = makeRating(true, ["novelty high"]);
    const withContext = gate.decide(makeProposal(), rating, makeContext([]));
    const withoutContext = gate.decide(makeProposal(), rating);
    expect(withContext).toEqual(withoutContext);
    expect(withContext.decision).toBe("accept");
  });
});

describe("AgentAcceptanceGate", () => {
  it("accepts when the agent engaged its channel after the proposal, naming the observed behavior", () => {
    const gate = new AgentAcceptanceGate();
    const decision = gate.decide(
      makeProposal(),
      makeRating(false, ["critic score low"]),
      makeContext([
        makeBehaviorEvent("e1", AGENT, "message_sent"),
        makeBehaviorEvent("e2", AGENT, "reply_sent"),
        makeBehaviorEvent("e3", AGENT, "reaction_sent"),
      ]),
    );
    expect(decision.decision).toBe("accept");
    expect(decision.reason).toContain("message_sent");
    expect(decision.reason).toContain("reply_sent");
    expect(decision.reason).toContain("reaction_sent");
    expect(decision.reason).toContain(AGENT);
    // SDT ownership: behavior overrides a critic rating that would decline.
    expect(decision.reason).toContain("ch_public");
  });

  it("accepts on a single engagement event of any of the three message kinds", () => {
    const gate = new AgentAcceptanceGate();
    for (const type of ["message_sent", "reply_sent", "reaction_sent"] as const) {
      const decision = gate.decide(
        makeProposal(),
        makeRating(true, []),
        makeContext([makeBehaviorEvent(`e-${type}`, AGENT, type)]),
      );
      expect(decision.decision).toBe("accept");
    }
  });

  it("declines on an empty window with the absence as reason", () => {
    const gate = new AgentAcceptanceGate();
    const decision = gate.decide(
      makeProposal(),
      makeRating(true, ["critic loves it"]),
      makeContext([]),
    );
    expect(decision.decision).toBe("decline");
    expect(decision.reason).toContain("no message/reply/reaction");
  });

  it("declines when only other agents engaged the goal channel", () => {
    const gate = new AgentAcceptanceGate();
    const decision = gate.decide(
      makeProposal(),
      makeRating(true, []),
      makeContext([
        makeBehaviorEvent("other-1", "agent_2", "message_sent"),
        makeBehaviorEvent("other-2", "agent_2", "reaction_sent"),
      ]),
    );
    expect(decision.decision).toBe("decline");
  });

  it("declines without context — an unwired caller gets no engagement signal", () => {
    const gate = new AgentAcceptanceGate();
    const decision = gate.decide(makeProposal(), makeRating(true, []));
    expect(decision.decision).toBe("decline");
  });

  it("declines when the window holds only non-engagement activity from the agent itself", () => {
    // D-21 counts exactly message_sent / reply_sent / reaction_sent — other
    // authored events (e.g. typing) are not ownership.
    const gate = new AgentAcceptanceGate();
    const decision = gate.decide(
      makeProposal(),
      makeRating(true, []),
      makeContext([
        makeBehaviorEvent("typing-1", AGENT, "typing_started"),
        makeBehaviorEvent("typing-2", AGENT, "typing_cancelled"),
      ]),
    );
    expect(decision.decision).toBe("decline");
    expect(decision.reason).toContain("no message/reply/reaction");
  });
});

describe("createAcceptanceGate", () => {
  it("resolves the auto implementation for auto mode", () => {
    expect(createAcceptanceGate("auto")).toBeInstanceOf(AutoAcceptanceGate);
  });

  it("resolves the agent-mode implementation for agent mode", () => {
    expect(createAcceptanceGate("agent")).toBeInstanceOf(AgentAcceptanceGate);
  });
});