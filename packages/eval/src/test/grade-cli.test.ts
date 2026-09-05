import { describe, it, expect } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gradeEvidenceDir, writeGrades } from "../cli/grade.js";

// A slimmed copy of the first real hidden-objective run
// (hoc-treatment-9a14eb4-one-scene: DeepSeek generator, Qwen + DeepSeek
// jury, GLM dropped). Events stripped; scores, signals and probes verbatim.
const fixture = fileURLToPath(new URL("./fixtures/hoc-one-scene-evidence", import.meta.url));

describe("grade CLI", () => {
  it("grades the real one-scene run A- for creativity 3 and the missed silence, and writes grades.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "grade-cli-"));
    cpSync(fixture, dir, { recursive: true });
    const grades = gradeEvidenceDir(dir);
    expect(grades.runId).toBe("hoc-treatment-9a14eb4-one-scene");
    expect(grades.round.scenes).toHaveLength(1);
    const scene = grades.round.scenes[0]!;
    expect(scene.scenarioId).toBe("hoc_fatia_que_nao_existe");
    expect(scene.grade).toBe("A-");
    const run = scene.runs[0]!;
    expect(run.seed).toBe(42);
    expect(run.axesBelow4).toEqual(["creativity_unhinged"]);
    expect(run.reasons).toContain("creativity_unhinged 3 < 4");
    expect(run.reasons).toContain("chosen_silence_present failed");
    expect(run.hygieneFailures).toEqual([]);
    // 4 forbidden-phrase checks + private channel + 2 memory references pass; chosen silence fails
    expect(run.signalPassRate).toBeCloseTo(7 / 8, 3);
    // two jurors voted; the per-axis counts were not recorded by that harness version
    expect(run.provisional).toBe(false);
    expect(grades.round.grade).toBe("A-");
    const out = writeGrades(dir, grades);
    expect(existsSync(out)).toBe(true);
    expect(JSON.parse(readFileSync(out, "utf8")).round.grade).toBe("A-");
  });

  it("ignores runs whose scenario is not on the hidden-objective rubric", () => {
    const dir = mkdtempSync(join(tmpdir(), "grade-cli-"));
    cpSync(fixture, dir, { recursive: true });
    const report = JSON.parse(readFileSync(join(dir, "bench-report.json"), "utf8")) as { perScenario: Array<{ id: string }> };
    report.perScenario[0]!.id = "v1_casual_chat__v0";
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(join(dir, "bench-report.json"), JSON.stringify(report));
    expect(gradeEvidenceDir(dir).round.scenes).toHaveLength(0);
  });
});
