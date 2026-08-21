#!/usr/bin/env node
/**
 * PR-gate assertion over a bench-report-v1 JSON file.
 *
 * Fails (exit 1) when:
 *  - any scenario run failed outright, or
 *  - the aggregate signal pass rate is below 1.0.
 *
 * The repo's iteration discipline requires expected signals to hold at
 * 100%; rule-judge axis scores are advisory until the judge passes its
 * kappa calibration gate, so they are NOT gated here.
 *
 * Usage: node scripts/ci/check-bench-gate.mjs <bench-report.json>
 */
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/ci/check-bench-gate.mjs <bench-report.json>");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(path, "utf8"));
} catch (err) {
  console.error(`cannot read bench report at ${path}: ${err.message}`);
  process.exit(2);
}

if (report.version !== "bench-report-v1") {
  console.error(`unexpected report version: ${report.version}`);
  process.exit(2);
}

const failures = [];
if (report.scenariosFailed > 0) {
  const failed = (report.perScenario ?? [])
    .filter(s => s.failed)
    .map(s => `${s.id}: ${s.failed}`);
  failures.push(`${report.scenariosFailed} scenario run(s) failed:\n    ${failed.join("\n    ")}`);
}
if (report.signalPassRate < 1) {
  const worst = Object.entries(report.signalsByKind ?? {})
    .sort((a, b) => a[1].passRate - b[1].passRate)
    .slice(0, 5)
    .map(([kind, a]) => `${kind} ${(a.passRate * 100).toFixed(0)}% (${a.passed}/${a.total})`);
  failures.push(
    `signal pass rate ${(report.signalPassRate * 100).toFixed(1)}% < 100%` +
      (worst.length ? `\n  worst kinds:\n    ${worst.join("\n    ")}` : ""),
  );
}

console.log(
  `bench gate: ${report.scenariosRun} scenarios, signal pass ${(report.signalPassRate * 100).toFixed(1)}%, probe pass ${(report.probePassRate * 100).toFixed(1)}%`,
);

if (failures.length > 0) {
  console.error(`\nBENCH GATE FAILED:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("BENCH GATE PASSED");
