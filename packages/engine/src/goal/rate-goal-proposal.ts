import type { GoalProposal, GoalRating } from "@perfectman/shared";

/**
 * The critic — independent of the crystallizer. Applies Schmidhuber's
 * Goldilocks rule ("previously unknown, but learnable"): reject goals the
 * agent already trivially satisfies and goals verifiably impossible in this
 * world. Empowerment (expansion of the future action space) is the tie-breaker
 * across proposals — callers rank equal scores by empowermentGain.
 */

const DISTANCE_EPSILON = 0.05; // at or below this the target is effectively satisfied
const ACCEPT_MIN_SCORE = 0.5; // balanced novelty × feasibility band

export type GoalRatingContext = {
  currentDistance: number; // 0..1 state-space distance remaining; ~0 = already satisfied
  feasibility: number; // 0..1 assessed chance the target is reachable in this world; 0 = impossible
  empowermentGain: number; // 0..1 expansion of the agent's future action space if pursued
};

export function rateGoalProposal(
  proposal: GoalProposal,
  context: GoalRatingContext,
): GoalRating {
  if (context.currentDistance <= DISTANCE_EPSILON) {
    return decline(proposal, 0, "already trivial — the target state is satisfied");
  }
  if (context.feasibility <= 0) {
    return decline(proposal, 0, "verifiably impossible in this world");
  }

  const score = clamp01(context.currentDistance * context.feasibility);
  const reasons = [
    `novelty ${context.currentDistance.toFixed(2)} × learnability ${context.feasibility.toFixed(2)}`,
  ];
  if (score < ACCEPT_MIN_SCORE) {
    return {
      proposalId: proposal.id,
      recommendAccept: false,
      score,
      empowermentGain: context.empowermentGain,
      reasons: [...reasons, "outside the not-too-easy, not-too-hard band"],
    };
  }
  return {
    proposalId: proposal.id,
    recommendAccept: true,
    score,
    empowermentGain: context.empowermentGain,
    reasons,
  };
}

function decline(
  proposal: GoalProposal,
  score: number,
  reason: string,
): GoalRating {
  return {
    proposalId: proposal.id,
    recommendAccept: false,
    score,
    empowermentGain: 0,
    reasons: [reason],
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}