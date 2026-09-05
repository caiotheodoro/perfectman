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
  const [g0, g1] = GOLDEN_LABELS;
  // Identical rater: same scores the golden set holds, per scene.
  // (calibrateJudge requires >=2 matched pairs per axis to compute kappa,
  // so a single scene would be vacuous by construction.)
  const judgeScores = new Map([
    [g0!.scenarioId, { ...g0!.axes }],
    [g1!.scenarioId, { ...g1!.axes }],
  ]);

  it("matches judge scores keyed by base scenario id", () => {
    const report = calibrateJudge(judgeScores, [g0!, g1!], 0.7);
    expect(report.nScenes).toBe(2);
    // Identical raters on every matched axis -> kappa 1.
    expect(report.kappa).toBeGreaterThan(0.99);
    expect(report.disagreements).toEqual([]);
  });

  it("reports no_data when nothing matches — never PASS, never FAIL", () => {
    const report = calibrateJudge(new Map(), GOLDEN_LABELS.slice(0, 1), 0.7);
    expect(report.status).toBe("no_data");
    expect(report.passed).toBeNull();
    expect(report.nGolden).toBe(1);
    expect(report.nScenes).toBe(0);
    expect(report.nAxisPairs).toBe(0);
  });
});
