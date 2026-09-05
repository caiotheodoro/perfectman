import { describe, it, expect } from "vitest";
import * as rubrics from "../scenarios/rubrics.js";
import { HIDDEN_OBJECTIVE_RUBRIC, ROLEPLAY_V1_RUBRIC, RUBRICS } from "../scenarios/rubrics.js";
import type { JudgeRubric } from "../scenarios/scenario.types.js";

describe("rubric registry", () => {
  it("registers every exported rubric under its own id", () => {
    const exported = Object.values(rubrics).filter(
      (v): v is JudgeRubric => typeof v === "object" && v !== null && "axes" in v && "id" in v,
    );
    expect(exported.length).toBeGreaterThanOrEqual(5);
    for (const rubric of exported) {
      expect(RUBRICS[rubric.id], rubric.id).toBe(rubric);
    }
  });

  it("hidden-objective rubric extends the roleplay axes with mask_integrity and objective_pursuit", () => {
    const ids = HIDDEN_OBJECTIVE_RUBRIC.axes.map(a => a.id);
    for (const axis of ROLEPLAY_V1_RUBRIC.axes) expect(ids).toContain(axis.id);
    expect(ids).toContain("mask_integrity");
    expect(ids).toContain("objective_pursuit");
    for (const axisId of ["mask_integrity", "objective_pursuit"]) {
      const axis = HIDDEN_OBJECTIVE_RUBRIC.axes.find(a => a.id === axisId)!;
      expect(Object.keys(axis.anchors).sort()).toEqual(["1", "2", "3", "4", "5"]);
      expect(HIDDEN_OBJECTIVE_RUBRIC.targets.find(t => t.axisId === axisId)?.min).toBe(4.0);
    }
  });
});
