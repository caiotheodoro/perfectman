import { runDramaSim } from "../embodiment/drama-sim.js";
import type { SimResult } from "../embodiment/drama-sim.js";
import { computeHumanlike } from "./metrics.js";
import type { HumanlikeMetrics } from "./metrics.js";
import { run63Config } from "./run63-preview.js";
import { scoreHumanlike } from "./score.js";
import type { HumanlikeScore } from "./score.js";

export type Arm = { likeness: number; sim: SimResult; metrics: HumanlikeMetrics; score: HumanlikeScore };

/** The three arms of the preview: the body as it was (h = 0), the default (0.6), and the strongest (1). */
export const PREVIEW_ARMS = [0, 0.6, 1] as const;

export function runArm(likeness: number, o: { seed?: number; durationMs?: number } = {}): Arm {
  const sim = runDramaSim(run63Config(likeness, o));
  const metrics = computeHumanlike(sim.trace!);
  return { likeness, sim, metrics, score: scoreHumanlike(metrics) };
}
