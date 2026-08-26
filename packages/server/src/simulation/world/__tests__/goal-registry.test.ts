import { describe, it, expect } from "vitest";
import type {
  CommittedEvent,
  DelusionGapSample,
  EmergentGoal,
  EndingOffer,
  GoalProposal,
  SimulationEvent,
  WorldVerdict,
} from "@perfectman/shared";
import { GoalRegistry } from "../goal-registry.js";

const AGENT = "agent_1";
const CHANNEL = "ch_public";

function makeProposal(id = "crystal-agent_1-resolve-ch_public"): GoalProposal {
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

function makeCommitted(
  type: CommittedEvent["type"],
  payload: SimulationEvent["payload"],
  pulseIndex: number,
): CommittedEvent {
  return {
    id: `evt-${type}-${pulseIndex}`,
    simulationId: "sim_1",
    channelId: CHANNEL,
    actorId: "system",
    type,
    payload,
    sourceEventIds: [],
    emotionalSalience: "low",
    pulseIndex,
    createdAt: pulseIndex * 1000,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "goal_layer",
    },
  };
}

describe("GoalRegistry", () => {
  it("starts empty with no seeded proposals (G1)", () => {
    const registry = new GoalRegistry();
    expect(registry.getProposals()).toEqual([]);
    expect(registry.getGoals()).toEqual([]);
    expect(registry.getPendingOffer()).toBeNull();
  });

  it("promotes a recorded proposal to an active goal (G1)", () => {
    const registry = new GoalRegistry();
    const proposal = makeProposal();
    registry.recordProposal(proposal);
    expect(registry.hasProposal(proposal.id)).toBe(true);

    const goal = registry.promoteProposal(proposal.id)!;
    expect(goal.id).toBe(proposal.id);
    expect(goal.status).toBe("active");
    expect(goal.agentId).toBe(AGENT);
    expect(goal.sourceEventIds).toEqual(proposal.sourceEventIds);
    expect(registry.getProposals()).toEqual([]);
    expect(registry.getGoals()).toEqual([goal]);
  });

  it("decline drops the proposal without promoting it", () => {
    const registry = new GoalRegistry();
    registry.recordProposal(makeProposal());
    registry.declineProposal("crystal-agent_1-resolve-ch_public");
    expect(registry.getProposals()).toEqual([]);
    expect(registry.getGoals()).toEqual([]);
  });

  it("promote of an unknown id returns null", () => {
    const registry = new GoalRegistry();
    expect(registry.promoteProposal("missing")).toBeNull();
  });

  it("records verdicts and appends gap samples capped at 32", () => {
    const registry = new GoalRegistry();
    const goalId = "crystal-agent_1-resolve-ch_public";
    const verdict: WorldVerdict = {
      goalId,
      objective: { distanceToTarget: 0.5, progressRate: 0, plateaued: false },
      consensus: "uncontested",
      determination: "contested",
      confidence: 0.75,
    };
    registry.recordVerdict(verdict);
    expect(registry.getLatestVerdict(goalId)).toEqual(verdict);

    for (let i = 0; i < 40; i += 1) {
      registry.recordGapSample(goalId, {
        at: 1000 + i,
        magnitude: 0.1,
        divergenceFromLog: 0.2,
        divergenceFromWorld: 0.3,
      });
    }
    expect(registry.getGapHistory(goalId)).toHaveLength(32);
    expect(registry.getGapHistory(goalId)[0]!.at).toBe(1000 + 8);

    // Same-`at` replace mirrors `computeDelusionGap`: a new sample whose `at`
    // ties the NEWEST entry replaces it in place.
    const replaced: DelusionGapSample = {
      at: 1000 + 39,
      magnitude: 0.9,
      divergenceFromLog: 0.1,
      divergenceFromWorld: 0.1,
    };
    registry.recordGapSample(goalId, replaced);
    expect(registry.getGapHistory(goalId)).toHaveLength(32);
    expect(registry.getGapHistory(goalId)[0]!.at).toBe(1000 + 8);
    expect(registry.getGapHistory(goalId)[31]).toEqual(replaced);

    // A duplicate `at` that is NOT the newest appends like any other sample
    // and evicts the oldest entry (no positional rewrite of history).
    registry.recordGapSample(goalId, {
      at: 1000 + 8,
      magnitude: 0.2,
      divergenceFromLog: 0,
      divergenceFromWorld: 0,
    });
    expect(registry.getGapHistory(goalId)).toHaveLength(32);
    expect(registry.getGapHistory(goalId)[0]!.at).toBe(1000 + 9);
  });

  it("refuses a second pending offer (single-offer invariant)", () => {
    const registry = new GoalRegistry();
    const first: EndingOffer = {
      goalId: "crystal-agent_1-resolve-ch_public",
      reasons: ["progress plateaued"],
      epilogue: "The story is over.",
      status: "pending",
    };
    const second: EndingOffer = { ...first, goalId: "other" };
    expect(registry.setPendingOffer(first, 6)).toBe(true);
    expect(registry.getPendingOffer()).toEqual({ offer: first, offeredAtPulse: 6 });
    expect(registry.setPendingOffer(second, 7)).toBe(false);
    expect(registry.getPendingOffer()!.offer.goalId).toBe(first.goalId);
  });

  it("rebuilds full state from a replayable log of the six event types", () => {
    const proposal = makeProposal();
    const goal: EmergentGoal = { ...proposal, status: "active" };
    const verdict: WorldVerdict = {
      goalId: proposal.id,
      objective: { distanceToTarget: 0.5, progressRate: 0, plateaued: true },
      consensus: "uncontested",
      determination: "contested",
      confidence: 0.75,
    };
    const offer: EndingOffer = {
      goalId: proposal.id,
      reasons: ["progress plateaued"],
      epilogue: "The story is over.",
      status: "pending",
    };
    const log: CommittedEvent[] = [
      makeCommitted("goal_proposed", { goalId: proposal.id, proposal }, 1),
      makeCommitted("goal_accepted", { goalId: goal.id, goal }, 2),
      makeCommitted("world_verdict", { goalId: proposal.id, verdict }, 3),
      makeCommitted(
        "delusion_gap_sampled",
        {
          goalId: proposal.id,
          agentId: AGENT,
          at: 3000,
          magnitude: 0,
          divergenceFromLog: 0,
          divergenceFromWorld: 0,
        },
        3,
      ),
      makeCommitted("ending_offered", { goalId: proposal.id, offer }, 6),
    ];

    const state = GoalRegistry.rebuildFromLog(log);
    expect(state.proposals.size).toBe(0);
    expect(state.goals.get(proposal.id)).toEqual(goal);
    expect(state.verdicts.get(proposal.id)).toEqual(verdict);
    expect(state.gapHistory.get(proposal.id)).toHaveLength(1);
    expect(state.pendingOffer).toEqual({ offer, offeredAtPulse: 6 });

    const declinedLog = [
      makeCommitted("goal_proposed", { goalId: proposal.id, proposal }, 1),
      makeCommitted("goal_declined", { goalId: proposal.id, proposal }, 2),
    ];
    expect(GoalRegistry.rebuildFromLog(declinedLog).proposals.size).toBe(0);
  });

  it("replays through the constructor for restart continuity", () => {
    const proposal = makeProposal();
    const log: CommittedEvent[] = [
      makeCommitted("goal_proposed", { goalId: proposal.id, proposal }, 1),
      makeCommitted(
        "goal_accepted",
        {
          goalId: proposal.id,
          goal: { ...proposal, status: "active" },
        },
        2,
      ),
    ];
    const registry = new GoalRegistry(log);
    expect(registry.getGoals()).toHaveLength(1);
    expect(registry.getProposals()).toEqual([]);
  });
});