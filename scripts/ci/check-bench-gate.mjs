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
 * Usage: node scripts/ci/check-bench-gate.mjs [--skip-signal-gate] <bench-report.json> [expectedIdsCsv]
 *
 * --skip-signal-gate: assert only structural sanity (no scenario run
 * hard-failed, expected ids present). Used for real-model runs where
 * signal rates legitimately vary; the offline gate keeps the 100% bar.
 *
 * When expectedIdsCsv is provided, every id must appear in the report's
 * perScenario list — protects against silent coverage shrink when a
 * scenario id gets renamed out of the requested slice.
 */
import { readFileSync } from "node:fs";

const skipSignalGate = process.argv.includes("--skip-signal-gate");
const positional = process.argv.slice(2).filter(a => !a.startsWith("--"));
const path = positional[0];
if (!path) {
  console.error("usage: node scripts/ci/check-bench-gate.mjs [--skip-signal-gate] <bench-report.json> [expectedIdsCsv]");
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
if (!skipSignalGate && report.signalPassRate < 1) {
  failures.push(`signal pass rate ${(report.signalPassRate * 100).toFixed(1)}% < 100%`);
}

const expectedIds = (positional[1] ?? "").split(",").map(s => s.trim()).filter(Boolean);
if (expectedIds.length > 0) {
  // Variant-expanded ids carry a __vN suffix (e.g. motive_gossip__v2);
  // match on the base id before the suffix.
  const seen = new Set(
    (report.perScenario ?? []).map(s => s.id.split("__")[0]),
  );
  const missing = expectedIds.filter(id => !seen.has(id));
  if (missing.length > 0) {
    failures.push(`expected scenario id(s) missing from the run: ${missing.join(", ")}`);
  }
}

console.log(
  `bench gate: ${report.scenariosRun} scenarios, signal pass ${(report.signalPassRate * 100).toFixed(1)}%, probe pass ${(report.probePassRate * 100).toFixed(1)}%`,
);

if (failures.length > 0) {
  console.error(`\nBENCH GATE FAILED:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("BENCH GATE PASSED");
