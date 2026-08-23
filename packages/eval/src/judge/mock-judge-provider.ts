import type { RoleplayScenario } from "@perfectman/shared";
import type { AxisScores, JudgeResult } from "./judge.js";

/**
 * Deterministic judge for tests and dry runs: every rubric axis scores the
 * same neutral value, never salvaged, no network. The judge-config's
 * providerType: "mock" dispatches here.
 */
export class MockJudgeProvider {
  constructor(private readonly score = 3) {}

  judge(scenario: RoleplayScenario): JudgeResult {
    const axes: AxisScores = {};
    for (const axis of scenario.rubric.axes) {
      axes[axis.id] = this.score;
    }
    return { axes, salvaged: false, imputedAxes: [] };
  }
}