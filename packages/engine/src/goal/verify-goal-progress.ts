import type { EmergentGoal, ProgressScore } from "@perfectman/shared";

/**
 * World-fact verifier — independent of the agent's self-report (critic-capture
 * guard). Progress is state-space distance from the current world state to the
 * goal's target predicate, scored as a rate so plateaus are detectable rather
 * than only binary reached/not-reached.
 */

const DISTANCE_EPSILON = 0.05; // distance movement below this is a plateau
const PLATEAU_WINDOW = 3; // reviews that must show no meaningful movement

export type WorldStateSnapshot = {
  at: number;
  satisfiedCriteria: string[]; // targetState.observableCriteria satisfied at this snapshot
};

export function verifyGoalProgress(
  goal: EmergentGoal,
  snapshots: WorldStateSnapshot[],
): ProgressScore {
  if (snapshots.length === 0) {
    return { distanceToTarget: 1, progressRate: 0, plateaued: false };
  }

  const total = Math.max(1, goal.targetState.observableCriteria.length);
  const distanceAt = (s: WorldStateSnapshot): number =>
    clamp01(1 - s.satisfiedCriteria.length / total);

  const latest = snapshots[snapshots.length - 1]!; // length checked above
  const distanceToTarget = distanceAt(latest);

  const baseline = distanceAt(snapshots[0]!);
  const progressRate =
    baseline <= DISTANCE_EPSILON
      ? 0
      : clamp01((baseline - distanceToTarget) / baseline);

  const window = snapshots.slice(-PLATEAU_WINDOW).map(distanceAt);
  const plateaued =
    window.length >= PLATEAU_WINDOW &&
    Math.max(...window) - Math.min(...window) < DISTANCE_EPSILON;

  return { distanceToTarget, progressRate, plateaued };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}