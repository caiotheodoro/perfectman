/**
 * Grade an evidence directory without re-running anything.
 *
 *   node dist/cli/grade.js docs/eval/evidence/<run-id>
 *
 * Reads `bench-report.json`, `run-meta.json` and `scenarios/*.json` as the
 * bench wrote them, grades every hidden-objective run, folds runs into
 * scenes (median over seeds) and scenes into a round (worst scene), prints
 * the table and writes `<dir>/grades.json` next to the inputs. A formula
 * change in `grade.ts` therefore re-grades every committed run at zero model
 * cost.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getScenario } from "@perfectman/shared";
import { baseScenarioId } from "../judge/calibration.js";
import {
  formatGradeTable,
  gradeRound,
  gradeRun,
  gradeScene,
  signalKind,
  type RoundGrade,
  type SceneGrade,
} from "../grade/grade.js";

type PerScenarioRecord = {
  id: string;
  seed?: number;
  axisScores: Record<string, number>;
  narrativeAxisScores?: Record<string, number>;
  judgeSalvaged?: boolean;
  juryVoterCount?: number;
  juryAxisVoterCounts?: Record<string, number>;
  imputedAxes?: string[];
  failed?: string;
};

type ScenarioFile = {
  signalResults?: Array<{ signal: string; passed: boolean; skipped?: boolean }>;
  probeResults?: Array<{ probe: string; passed: boolean }>;
};

export type GradesFile = {
  version: "grades-v1";
  runId: string | null;
  gitSha: string | null;
  promptTemplateVersions: string[];
  gradedAt: string;
  round: RoundGrade;
};

export const HIDDEN_OBJECTIVE_RUBRIC_ID = "hidden-objective-v1";

export function gradeEvidenceDir(dir: string): GradesFile {
  const root = resolve(dir);
  const report = JSON.parse(readFileSync(join(root, "bench-report.json"), "utf8")) as {
    runId?: string;
    promptTemplateVersions?: string[];
    perScenario: PerScenarioRecord[];
  };
  const metaPath = join(root, "run-meta.json");
  const meta = existsSync(metaPath)
    ? (JSON.parse(readFileSync(metaPath, "utf8")) as { gitSha?: string | null })
    : {};

  const byScene = new Map<string, SceneGrade["runs"]>();
  for (const rec of report.perScenario) {
    if (rec.failed) continue;
    const baseId = baseScenarioId(rec.id);
    const scenario = getScenario(baseId);
    if (!scenario || scenario.rubric.id !== HIDDEN_OBJECTIVE_RUBRIC_ID) continue;
    const file = join(root, "scenarios", `${rec.id}${rec.seed !== undefined ? `__s${rec.seed}` : ""}.json`);
    const scene: ScenarioFile = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ScenarioFile) : {};
    const graded = gradeRun({
      axes: rec.axisScores,
      imputedAxes: rec.imputedAxes ?? [],
      rubric: scenario.rubric,
      narrativeAxes: rec.narrativeAxisScores,
      signals: (scene.signalResults ?? []).map((s) => ({ kind: signalKind(s.signal), passed: s.passed, skipped: s.skipped })),
      probes: (scene.probeResults ?? []).map((p) => ({ probe: p.probe, passed: p.passed })),
      juryVoterCount: rec.juryVoterCount,
      juryAxisVoterCounts: rec.juryAxisVoterCounts,
      judgeSalvaged: rec.judgeSalvaged,
    });
    const runs = byScene.get(baseId) ?? [];
    runs.push({ ...graded, seed: rec.seed, runId: rec.id });
    byScene.set(baseId, runs);
  }

  const scenes = [...byScene.entries()].map(([id, runs]) => gradeScene(id, runs));
  return {
    version: "grades-v1",
    runId: report.runId ?? null,
    gitSha: meta.gitSha ?? null,
    promptTemplateVersions: report.promptTemplateVersions ?? [],
    gradedAt: new Date().toISOString(),
    round: gradeRound(scenes),
  };
}

export function writeGrades(dir: string, grades: GradesFile): string {
  const out = join(resolve(dir), "grades.json");
  writeFileSync(out, JSON.stringify(grades, null, 2), "utf8");
  return out;
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: grade <evidence-dir>");
    process.exit(2);
  }
  const grades = gradeEvidenceDir(dir);
  console.log(formatGradeTable(grades.round));
  if (grades.round.scenes.length === 0) console.log("(no hidden-objective runs in this evidence directory)");
  console.log(`wrote ${writeGrades(dir, grades)}`);
}

if (process.argv[1]?.endsWith("grade.js") || process.argv[1]?.endsWith("grade.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
