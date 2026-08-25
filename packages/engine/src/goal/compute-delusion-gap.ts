import type {
  DelusionGap,
  DelusionGapSample,
  DelusionWeights,
  SelfVerdict,
  WorldVerdict,
} from "@perfectman/shared";

/**
 * Derive the delusion gap as divergence between the agent's own belief and
 * (a) the canonical event log and (b) the world verdict — tracked over time,
 * never stored as a flag. The two-factor reading (R2) enters through the
 * weights: wSignal covers the felt-success signal (Factor 1), wSocial the
 * sociometer/social-feedback channel, wIdentity the identity-threat side of
 * belief evaluation. revisionThreshold gates belief revision in the agent's
 * own machinery (deferred), not this derivation.
 */

export const DEFAULT_DELUSION_WEIGHTS: DelusionWeights = {
  wSignal: 0.4,
  wSocial: 0.4,
  wIdentity: 0.2,
  revisionThreshold: 0.5,
};

const HISTORY_LIMIT = 32; // rolling window per goal, oldest samples dropped

export function computeDelusionGap(
  selfVerdict: SelfVerdict,
  worldVerdict: WorldVerdict,
  divergenceFromLog: number, // 0..1, self-narrative vs canonical event log (caller-computed)
  history: DelusionGapSample[],
  at: number,
  weights: DelusionWeights = DEFAULT_DELUSION_WEIGHTS,
): DelusionGap {
  const divergenceFromWorld = claimVsWorld(selfVerdict, worldVerdict);

  // Felt conviction only inflates the gap when the agent claims completion —
  // an in-progress claim diverges from nothing.
  const feltBoost =
    selfVerdict.claim === "reached" ? clamp01(selfVerdict.feltSignal) : 0;

  const magnitude = clamp01(
    weights.wSignal * clamp01(divergenceFromLog) +
      weights.wSocial * divergenceFromWorld +
      weights.wIdentity * feltBoost,
  );

  const sample: DelusionGapSample = {
    at,
    magnitude,
    divergenceFromLog: clamp01(divergenceFromLog),
    divergenceFromWorld,
  };
  const prev = history[history.length - 1];
  const nextHistory =
    prev !== undefined && prev.at === at
      ? [...history.slice(0, -1), sample]
      : [...history, sample];

  return {
    goalId: selfVerdict.goalId,
    agentId: selfVerdict.agentId,
    magnitude,
    divergenceFromLog: clamp01(divergenceFromLog),
    divergenceFromWorld,
    history: nextHistory.slice(-HISTORY_LIMIT),
  };
}

function claimVsWorld(selfVerdict: SelfVerdict, worldVerdict: WorldVerdict): number {
  const claim = selfVerdict.claim;
  const determination = worldVerdict.determination;
  switch (claim) {
    case "reached":
      if (determination === "reached") return 0;
      if (determination === "contested") return 0.5;
      return 1; // determination === "not_reached" — the flagship deluded achiever
    case "in_progress":
      return 0; // no completion claim — nothing to diverge on
    case "abandoned":
      return determination === "reached" ? 0.5 : 0;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}