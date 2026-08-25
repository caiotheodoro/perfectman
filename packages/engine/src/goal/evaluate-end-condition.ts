import type {
  EmergentGoal,
  EndConditionResult,
  EndingOffer,
  SelfVerdict,
  WorldVerdict,
} from "@perfectman/shared";

/**
 * The termination gate. Ending is offered, world-verified, and earned:
 * terminate only when the world verdict is reached AND the archetypal
 * completion beat is in the log AND meaning was made (agent narrative
 * converges with the facts). A deluded achiever (self claims reached, world
 * says not reached) re-goals and never terminates (Wrosch disengage-and-
 * re-engage). A plateau with no critic-surviving next goal closes as a
 * Dwarf-Fortress-style "story is over" ending — the run's history is its
 * own terminus either way.
 */

export type EndConditionGates = {
  completionBeatPresent: boolean; // Propp task→recognition→exposure→return beat in the log
  meaningMade: boolean; // agent narrative converges with the event log
  nextGoalAvailable: boolean; // a rated proposal survived the critic
};

export function evaluateEndCondition(
  goal: EmergentGoal,
  selfVerdict: SelfVerdict,
  worldVerdict: WorldVerdict,
  gates: EndConditionGates,
): EndConditionResult {
  const determination = worldVerdict.determination;

  if (
    determination === "reached" &&
    gates.completionBeatPresent &&
    gates.meaningMade
  ) {
    return {
      kind: "end_offered",
      offer: buildOffer(
        goal.id,
        ["world verdict: reached", "completion beat present", "meaning made"],
        `${goal.title}: reached, witnessed, and carried home — the story holds.`,
      ),
    };
  }

  // The flagship case: world says never reached, the agent insists. Re-goal,
  // never terminate; the mismatch stays legible as a gap in the world layer.
  if (determination === "not_reached" && selfVerdict.claim === "reached") {
    return {
      kind: "re_goal",
      reason: "agent claims reached but the world verdict is not_reached — deluded achiever arc",
    };
  }

  // Reached by the world but un-earned (no return leg, or meaning never made)
  // does not discharge into closure — the arc re-goals instead (SDT).
  if (determination === "reached") {
    return {
      kind: "re_goal",
      reason: "world verdict reached but completion is un-earned — hollow completion re-goals",
    };
  }

  // Plateau with nothing new to pursue: the story is over (Dwarf Fortress:
  // "losing is fun") — reached and deluded arcs have already returned above.
  if (worldVerdict.objective.plateaued && !gates.nextGoalAvailable) {
    return {
      kind: "end_offered",
      offer: buildOffer(
        goal.id,
        ["progress plateaued", "no next goal survived the critic"],
        `${goal.title} was never reached, and no new goal called. The story is over — the run's history stands as its own record.`,
      ),
    };
  }

  return {
    kind: "continue",
    reason: "arc still open: no terminating condition reached",
  };
}

function buildOffer(goalId: string, reasons: string[], epilogue: string): EndingOffer {
  return { goalId, reasons, epilogue, status: "pending" };
}