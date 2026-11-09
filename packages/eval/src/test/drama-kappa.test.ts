import { describe, it, expect } from "vitest";
import { DRAMA_AXES, labelAgreement, weightedKappa, type ClipLabel, type DramaAxis } from "../drama/index.js";
import { weightedKappa as calibrationWeightedKappa } from "../judge/calibration.js";

const clip = (clipId: string, scores: Partial<Record<DramaAxis, number | null>>, fill: number | null = 3): ClipLabel => ({
  clipId,
  labeler: "x",
  labeledAt: "2026-11-08T17:00:00.000Z",
  scores: Object.fromEntries(DRAMA_AXES.map((a) => [a, { score: a in scores ? scores[a]! : fill }])) as ClipLabel["scores"],
  failureCodes: [],
  pass: true,
});

describe("weightedKappa is the existing calibration kappa, not a copy", () => {
  it("re-exports the same function", () => {
    expect(weightedKappa).toBe(calibrationWeightedKappa);
  });
});

describe("labelAgreement", () => {
  it("is 1 on every axis when the judge repeats the human exactly", () => {
    const human = [clip("a", { restraint: 1 }), clip("b", { restraint: 3 }), clip("c", { restraint: 5 })];
    const r = labelAgreement(human, human.map((l) => ({ ...l, labeler: "judge" })));
    expect(r.n).toBe(3);
    expect(r.perAxis.restraint).toMatchObject({ n: 3, kappa: 1 });
    expect(r.kappa).toBeCloseTo(1, 10);
  });

  it("matches a hand-computed quadratic-weighted kappa: [1,2,3,4] vs [1,2,3,5] is 13/14", () => {
    // observed weighted agreement (3 + 15/16) / 4 = 0.984375; chance 12.5 / 16 = 0.78125; (0.984375 - 0.78125) / (1 - 0.78125) = 13/14
    const human = [1, 2, 3, 4].map((s, i) => clip(`c${i}`, { restraint: s }));
    const judge = [1, 2, 3, 5].map((s, i) => clip(`c${i}`, { restraint: s }));
    const r = labelAgreement(human, judge);
    expect(r.perAxis.restraint.kappa).toBeCloseTo(13 / 14, 10);
    expect(r.perAxis.restraint.n).toBe(4);
  });

  it("is -1 when two raters swap the extremes", () => {
    const r = labelAgreement([clip("a", { restraint: 1 }), clip("b", { restraint: 5 })], [clip("a", { restraint: 5 }), clip("b", { restraint: 1 })]);
    expect(r.perAxis.restraint.kappa).toBeCloseTo(-1, 10);
  });

  it("leaves not-applicable scores out of the axis kappa and counts the ones only one side marked", () => {
    const human = [clip("a", { escalation_arc: 3 }), clip("b", { escalation_arc: null }), clip("c", { escalation_arc: 4 }), clip("d", { escalation_arc: 5 })];
    const judge = [clip("a", { escalation_arc: 3 }), clip("b", { escalation_arc: 2 }), clip("c", { escalation_arc: null }), clip("d", { escalation_arc: 5 })];
    const arc = labelAgreement(human, judge).perAxis.escalation_arc;
    expect(arc.n).toBe(2);
    expect(arc.kappa).toBeCloseTo(1, 10);
    expect(arc.notApplicableMismatch).toBe(2);
    expect(arc.bothNotApplicable).toBe(0);
  });

  it("counts clips both sides marked not applicable, and gives no kappa when that leaves nothing", () => {
    const human = [clip("a", { escalation_arc: null }), clip("b", { escalation_arc: null })];
    const judge = [clip("a", { escalation_arc: null }), clip("b", { escalation_arc: null })];
    const arc = labelAgreement(human, judge).perAxis.escalation_arc;
    expect(arc).toMatchObject({ n: 0, kappa: null, bothNotApplicable: 2, notApplicableMismatch: 0 });
  });

  it("gives no kappa (null, not 0) with fewer than two paired scores, and lets the caller raise the bar", () => {
    const one = labelAgreement([clip("a", { restraint: 4 })], [clip("a", { restraint: 4 })]);
    expect(one.perAxis.restraint).toMatchObject({ n: 1, kappa: null });
    expect(one.kappa).toBeNull();
    const three = [1, 3, 5].map((s, i) => clip(`c${i}`, { restraint: s }));
    expect(labelAgreement(three, three, { minPairs: 4 }).perAxis.restraint.kappa).toBeNull();
    expect(labelAgreement(three, three, { minPairs: 3 }).perAxis.restraint.kappa).toBeCloseTo(1, 10);
  });

  it("pairs by clip id, in any order, and reports clips only one side labeled", () => {
    const human = [clip("a", { restraint: 2 }), clip("b", { restraint: 4 }), clip("only-human", { restraint: 3 })];
    const judge = [clip("b", { restraint: 4 }), clip("a", { restraint: 2 }), clip("only-judge", { restraint: 1 })];
    const r = labelAgreement(human, judge);
    expect(r.n).toBe(2);
    expect(r.unmatched).toEqual({ human: ["only-human"], judge: ["only-judge"] });
    expect(r.perAxis.restraint.kappa).toBeCloseTo(1, 10);
  });

  it("averages only the axes that produced a kappa", () => {
    const human = [clip("a", { restraint: 1, escalation_arc: null }), clip("b", { restraint: 5, escalation_arc: null })];
    const judge = [clip("a", { restraint: 5, escalation_arc: null }), clip("b", { restraint: 1, escalation_arc: null })];
    const r = labelAgreement(human, judge);
    expect(r.perAxis.escalation_arc.kappa).toBeNull();
    const defined = DRAMA_AXES.filter((a) => r.perAxis[a].kappa !== null);
    expect(defined).toHaveLength(DRAMA_AXES.length - 1);
    const expected = defined.reduce((s, a) => s + r.perAxis[a].kappa!, 0) / defined.length;
    expect(r.kappa).toBeCloseTo(expected, 10);
  });

  it("returns an empty, null-kappa result for no labels at all", () => {
    const r = labelAgreement([], []);
    expect(r.n).toBe(0);
    expect(r.kappa).toBeNull();
    expect(DRAMA_AXES.every((a) => r.perAxis[a].kappa === null && r.perAxis[a].n === 0)).toBe(true);
  });

  it("refuses two labels for one clip within a set instead of picking one", () => {
    expect(() => labelAgreement([clip("a", {}), clip("a", {})], [clip("a", {})])).toThrow(/duplicate clip id "a"/);
  });
});
