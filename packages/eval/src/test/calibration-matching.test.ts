import { describe, it, expect } from "vitest";
import { baseScenarioId, calibrateJudge } from "../judge/calibration.js";
import { GOLDEN_LABELS } from "../judge/golden-labels.js";

describe("baseScenarioId", () => {
  it("strips the deterministic variant suffix", () => {
    expect(baseScenarioId("motive_gossip__v2")).toBe("motive_gossip");
    expect(baseScenarioId("v1_casual_chat__v0")).toBe("v1_casual_chat");
  });

  it("leaves base ids untouched", () => {
    expect(baseScenarioId("motive_gossip")).toBe("motive_gossip");
    expect(baseScenarioId("edge_public_mock")).toBe("edge_public_mock");
  });
});

describe("calibration matching (#24)", () => {
  const golden = GOLDEN_LABELS[0]!;
  // Identical rater: same scores the golden set holds.
  const axes = { ...golden.axes };

  it("matches judge scores keyed by base scenario id", () => {
    const judgeScores = new Map([[golden.scenarioId, axes]]);
    const report = calibrateJudge(judgeScores, [golden], 0.7);
    // Identical raters on every matched axis -> kappa 1.
    expect(report.kappa).toBeGreaterThan(0.99);
  });

  it("reports kappa 0 when nothing matches (vacuous case stays detectable)", () => {
    const report = calibrateJudge(new Map(), GOLDEN_LABELS.slice(0, 1), 0.7);
    expect(report.passed).toBe(false);
  });
});
