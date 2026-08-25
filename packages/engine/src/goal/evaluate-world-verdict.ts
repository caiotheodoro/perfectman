import type {
  ProgressScore,
  RatificationState,
  WorldDetermination,
  WorldVerdict,
} from "@perfectman/shared";

/**
 * Combine the objective check with the emergent consensus of other agents
 * into a WorldVerdict. The verdict is computed from the event log and other
 * agents' deference/ridicule signals — never from the target agent's own
 * claim (R2: a verdict derived from a single agent-oracle is not a world
 * verdict). Consensus is a breakable ratification (Ridgeway), not an oracle.
 */

const DISTANCE_EPSILON = 0.05; // at or below this the objective check says reached
const RIDICULE_WEIGHT = 1.25; // ridicule rejects harder than a calm challenge
const RATIFIED_MIN = 0.5; // ratification ratio at/above this = ratified
const REJECTED_MAX = -0.5; // ratification ratio at/below this = rejected

export type DeferenceSignal = {
  sourceAgentId: string;
  stance: "defer" | "challenge" | "ridicule";
  strength: number; // 0..1 intensity of the signal
};

export function evaluateWorldVerdict(
  goalId: string,
  objective: ProgressScore,
  signals: DeferenceSignal[],
): WorldVerdict {
  const { state, ratio } = deriveConsensus(signals);
  const determination = deriveDetermination(objective, state);
  return {
    goalId,
    objective,
    consensus: state,
    determination,
    confidence: deriveConfidence(determination, ratio),
  };
}

/**
 * Ratification ratio in [-1, 1]: positive = the collective defers, negative =
 * it rejects. Uncontested means nobody signaled — no social evidence either way.
 */
function deriveConsensus(
  signals: DeferenceSignal[],
): { state: RatificationState; ratio: number } {
  if (signals.length === 0) return { state: "uncontested", ratio: 0 };

  let defer = 0;
  let reject = 0;
  for (const signal of signals) {
    const strength = clamp01(signal.strength);
    if (signal.stance === "defer") defer += strength;
    else if (signal.stance === "ridicule") reject += strength * RIDICULE_WEIGHT;
    else reject += strength;
  }
  const ratio = (defer - reject) / (defer + reject);

  if (ratio >= RATIFIED_MIN) return { state: "ratified", ratio };
  if (ratio <= REJECTED_MAX) return { state: "rejected", ratio };
  return { state: "contested", ratio };
}

/**
 * "Reached" requires the objective check and the social consensus to agree;
 * a disagreement in either direction lands on "contested" (one of the two
 * readings is briefly wrong, per R2's breakable consensus).
 */
function deriveDetermination(
  objective: ProgressScore,
  consensus: RatificationState,
): WorldDetermination {
  const objectiveReached = objective.distanceToTarget <= DISTANCE_EPSILON;
  switch (consensus) {
    case "ratified":
    case "uncontested":
      return objectiveReached ? "reached" : "contested";
    case "rejected":
      return objectiveReached ? "contested" : "not_reached";
    case "contested":
      return "contested";
  }
}

function deriveConfidence(
  determination: WorldDetermination,
  ratio: number,
): number {
  // Agreement between the two independent readings raises confidence; a
  // contested verdict stays mid-scale by construction.
  const agreementBoost = determination === "contested" ? 0 : 0.25;
  return clamp01(0.5 + agreementBoost + 0.25 * Math.abs(ratio));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}