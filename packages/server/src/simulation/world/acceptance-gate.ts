import type {
  AcceptanceMode,
  GoalAcceptanceDecision,
  GoalProposal,
  GoalRating,
} from "@perfectman/shared";

/**
 * Proposal-acceptance seam: acceptance is a config-selected policy, never a
 * hard-coded branch in the evaluator. The interface is shaped for both
 * decisions — an agent-mode implementation wraps the agent's intent output
 * in the server layer.
 */
export interface AcceptanceGate {
  decide(proposal: GoalProposal, rating: GoalRating): GoalAcceptanceDecision;
}

/** Deterministic V1: the critic's rating is the decision. */
export class AutoAcceptanceGate implements AcceptanceGate {
  decide(proposal: GoalProposal, rating: GoalRating): GoalAcceptanceDecision {
    const reason = rating.reasons.join("; ");
    if (rating.recommendAccept) {
      return { decision: "accept", reason };
    }
    return { decision: "decline", reason };
  }
}

export function createAcceptanceGate(mode: AcceptanceMode): AcceptanceGate {
  switch (mode) {
    case "auto":
      return new AutoAcceptanceGate();
    case "agent":
      throw new Error(
        `acceptance.mode "agent" is not wired in this slice; lands with the LLM synthesizer slice`,
      );
  }
}