/**
 * Agreement between two sets of clip labels (a human's and a judge's), per
 * drama axis. The statistic is the existing ordinal-weighted (quadratic) Cohen's
 * kappa from `judge/calibration.ts`, the one the hotel calibration reports, so
 * drama numbers compare with the hotel ones.
 */
import { weightedKappa } from "../judge/calibration.js";
import { DRAMA_AXES, type DramaAxis } from "./axes.js";
import type { ClipLabel } from "./label.js";

export { weightedKappa };

/** Same floor `judge/calibration.ts` uses: fewer paired scores than this give no kappa. */
export const MIN_AGREEMENT_PAIRS = 2;

export type AxisLabelAgreement = {
  /** Clips where both sides gave a 1-5 score on this axis. */
  n: number;
  /** Quadratic-weighted kappa over those `n` pairs; null when `n` is below the floor (never a made-up 0). */
  kappa: number | null;
  /** Clips both sides marked not applicable. */
  bothNotApplicable: number;
  /** Clips exactly one side marked not applicable: a disagreement the kappa cannot see. */
  notApplicableMismatch: number;
};

export type LabelAgreement = {
  /** Clips labeled by both sides. */
  n: number;
  perAxis: Record<DramaAxis, AxisLabelAgreement>;
  /** Mean of the axis kappas that exist; null when none do. */
  kappa: number | null;
  /** Clip ids only one side labeled; left out of every number above. */
  unmatched: { human: string[]; judge: string[] };
};

export type LabelAgreementOptions = { minPairs?: number };

function byClip(labels: readonly ClipLabel[]): Map<string, ClipLabel> {
  const out = new Map<string, ClipLabel>();
  for (const l of labels) {
    if (out.has(l.clipId)) throw new Error(`duplicate clip id "${l.clipId}" in one label set`);
    out.set(l.clipId, l);
  }
  return out;
}

export function labelAgreement(humanLabels: readonly ClipLabel[], judgeLabels: readonly ClipLabel[], opts: LabelAgreementOptions = {}): LabelAgreement {
  const minPairs = opts.minPairs ?? MIN_AGREEMENT_PAIRS;
  const human = byClip(humanLabels);
  const judge = byClip(judgeLabels);
  const shared = [...human.keys()].filter((id) => judge.has(id));

  const perAxis = {} as Record<DramaAxis, AxisLabelAgreement>;
  for (const axis of DRAMA_AXES) {
    const a: number[] = [];
    const b: number[] = [];
    let bothNotApplicable = 0;
    let notApplicableMismatch = 0;
    for (const id of shared) {
      const h = human.get(id)!.scores[axis].score;
      const j = judge.get(id)!.scores[axis].score;
      if (h === null && j === null) bothNotApplicable++;
      else if (h === null || j === null) notApplicableMismatch++;
      else {
        a.push(h);
        b.push(j);
      }
    }
    perAxis[axis] = { n: a.length, kappa: a.length >= minPairs ? weightedKappa(a, b) : null, bothNotApplicable, notApplicableMismatch };
  }

  const kappas = DRAMA_AXES.map((axis) => perAxis[axis].kappa).filter((k): k is number => k !== null);
  return {
    n: shared.length,
    perAxis,
    kappa: kappas.length === 0 ? null : kappas.reduce((s, k) => s + k, 0) / kappas.length,
    unmatched: {
      human: [...human.keys()].filter((id) => !judge.has(id)),
      judge: [...judge.keys()].filter((id) => !human.has(id)),
    },
  };
}
