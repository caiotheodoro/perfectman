import { describe, it, expect } from "vitest";
import { calibrateJudge } from "../judge/calibration.js";
import { GOLDEN_NARRATIONS } from "../judge/golden-narrations.js";

describe("narration calibration matching (reuses calibrateJudge, not a new implementation)", () => {
  it("has one good (~5) and one bad (~1-2) entry per scenario category", () => {
    const categories = new Set(GOLDEN_NARRATIONS.map(g => g.scenario.category));
    expect(categories.size).toBe(5);
    for (const category of categories) {
      const entries = GOLDEN_NARRATIONS.filter(g => g.scenario.category === category);
      expect(entries.length).toBe(2);
      const scores = entries.map(g => Object.values(g.axes).reduce((a, b) => a + b, 0) / Object.values(g.axes).length);
      expect(Math.max(...scores)).toBeGreaterThanOrEqual(4);
      expect(Math.min(...scores)).toBeLessThanOrEqual(2.5);
    }
  });

  it("matches judge scores keyed by golden narration id", () => {
    const [g0, g1] = GOLDEN_NARRATIONS;
    // Identical rater: same scores the golden set holds, per entry.
    const judgeScores = new Map([
      [g0!.id, { ...g0!.axes }],
      [g1!.id, { ...g1!.axes }],
    ]);
    const report = calibrateJudge(
      judgeScores,
      GOLDEN_NARRATIONS.slice(0, 2).map(g => ({ scenarioId: g.id, axes: g.axes, note: g.note })),
      0.7,
    );
    expect(report.nScenes).toBe(2);
    expect(report.kappa).toBeGreaterThan(0.99);
    expect(report.disagreements).toEqual([]);
  });

  it("reports no_data when nothing matches — never PASS, never FAIL", () => {
    const report = calibrateJudge(
      new Map(),
      GOLDEN_NARRATIONS.slice(0, 1).map(g => ({ scenarioId: g.id, axes: g.axes, note: g.note })),
      0.7,
    );
    expect(report.status).toBe("no_data");
    expect(report.passed).toBeNull();
    expect(report.nScenes).toBe(0);
  });
});
