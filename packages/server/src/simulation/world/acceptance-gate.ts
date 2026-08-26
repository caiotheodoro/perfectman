import type {
  AcceptanceMode,
  AgentAcceptanceContext,
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
  decide(
    proposal: GoalProposal,
    rating: GoalRating,
    context?: AgentAcceptanceContext,
  ): GoalAcceptanceDecision;
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

/**
 * Agent-mode acceptance (D-21): SDT autonomy as engagement — the goal is
 * owned only if the agent acted in its channel after perceiving the
 * proposal, so a forced goal is declined. The window arrives pre-scoped by
 * the evaluator to the proposal's commit position and channel (ADR-0009
 * positional rule), so the gate only has to read who acted and how.
 */
export class AgentAcceptanceGate implements AcceptanceGate {
  decide(
    proposal: GoalProposal,
    _rating: GoalRating,
    context?: AgentAcceptanceContext,
  ): GoalAcceptanceDecision {
    const window = context?.behaviorWindow ?? [];
    const observed = window.filter(
      (event) =>
        event.actorId === proposal.agentId &&
        (event.type === "message_sent" ||
          event.type === "reply_sent" ||
          event.type === "reaction_sent"),
    );
    if (observed.length > 0) {
      const kinds = [...new Set(observed.map((event) => event.type))].join(", ");
      return {
        decision: "accept",
        reason: `observed ${kinds} from ${proposal.agentId} in ${observed[0]!.channelId} after the goal proposal`,
      };
    }
    return {
      decision: "decline",
      reason: `no message/reply/reaction from ${proposal.agentId} since the goal proposal`,
    };
  }
}

export function createAcceptanceGate(mode: AcceptanceMode): AcceptanceGate {
  switch (mode) {
    case "auto":
      return new AutoAcceptanceGate();
    case "agent":
      return new AgentAcceptanceGate();
  }
}