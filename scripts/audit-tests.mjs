#!/usr/bin/env node
/**
 * Test audit: inventory + hygiene sweep across all packages.
 * Produces docs/test-inventory.md (markdown) and a machine-readable findings JSON.
 * Later becomes the enforcement script behind docs/testing-strategy.md (P6).
 *
 * Usage: node scripts/audit-tests.mjs [--json]
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const GLOB = ["packages", "**", "src"];
const OUT_MD = join(ROOT, "docs", "test-inventory.md");
const OUT_JSON = join(ROOT, "docs", "test-inventory.json");

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === ".stryker-tmp") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".test.ts")) acc.push(p);
  }
  return acc;
}

const CAP_ITS_PER_FILE = 25;
const files = walk(join(ROOT, "packages")).sort();
const rows = [];

for (const f of files) {
  const src = readFileSync(f, "utf8");
  const lines = src.split("\n");
  const pkg = relative(ROOT, f).split("/")[1];

  const its = (src.match(/^\s*(it|test)\(/gm) ?? []).length;
  const itsEach = (src.match(/\bit\.each\b|\btest\.each\b/g) ?? []).length;
  const forcedCasts = (src.match(/\bas (any|unknown)\b/g) ?? []).length;
  const tsBypasses = (src.match(/@ts-(ignore|expect-error)\b/g) ?? []).length;
  const eslintDisables = (src.match(/eslint-disable/g) ?? []).length;
  const onlys = (src.match(/\.only\(/g) ?? []).length;
  const skips = (src.match(/\.skip\(/g) ?? []).length;
  const consoleLogs = (src.match(/console\.(log|debug)/g) ?? []).length;
  const truthy = (src.match(/toBeTruthy\(/g) ?? []).length;
  const defined = (src.match(/toBeDefined\(/g) ?? []).length;
  const deadIdTruthy = (src.match(/\.id\)\.toBeTruthy\(\)/g) ?? []).length;
  const nonNull = (src.match(/(?<![\w$])[\w$)\]\]"']!\s*(?:\)|\.|,|;|:|\s)/g) ?? []).length;
  const spies = (src.match(/vi\.(fn|spyOn)\(/g) ?? []).length;
  const asyncPauses = (src.match(/new Promise|setTimeout|await sleep/g) ?? []).length;

  // weak terminal toBeDefined/toBeTruthy: existence-only assertion is the LAST
  // executable assertion in its block (no other expect() before `});`).
  // Heuristic, not a verdict — audit findings are manually verified (trust-nothing).
  const weakTerminals = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/toBeDefined\(\)|toBeTruthy\(\)/.test(lines[i])) continue;
    let j = i + 1;
    let sawOtherExpect = false;
    while (j < lines.length) {
      const l = lines[j];
      if (/\}\);\s*$/.test(l)) break; // block closes before another assertion
      if (/expect\(|\bassert[A-Z]|toHaveBeen|check[A-Z]/.test(l)) { sawOtherExpect = true; break; }
      j++;
    }
    if (!sawOtherExpect) weakTerminals.push(i + 1);
  }

  // layer classification per docs/testing-strategy.md
  const rel = relative(ROOT, f);
  let layer;
  if (pkg === "shared") layer = "contract";
  else if (rel.includes("__e2e__")) layer = "e2e";
  else if (pkg === "eval") layer = "eval-harness";
  else layer = "integration"; // engine + server unit-style files = integration per taxonomy

  const flags = [];
  if (forcedCasts) flags.push(`forced-cast(${forcedCasts})`);
  if (tsBypasses) flags.push(`ts-bypass(${tsBypasses})`);
  if (eslintDisables) flags.push(`eslint-disable(${eslintDisables})`);
  if (onlys) flags.push(`ONLY(${onlys})`);
  if (skips) flags.push(`skip(${skips})`);
  if (consoleLogs) flags.push(`console(${consoleLogs})`);
  if (deadIdTruthy) flags.push(`dead-id-truthy(${deadIdTruthy})`);
  if (weakTerminals.length) flags.push(`weak-terminal-toBeDefined(${weakTerminals.join(",")})`);
  if (asyncPauses) flags.push(`async-pause(${asyncPauses})`);
  if (its > CAP_ITS_PER_FILE) flags.push(`over-cap(${its}>${CAP_ITS_PER_FILE})`);

  // Zero-tolerance (CI-failing) vs informational (documented exceptions)
  const violations = [];
  if (forcedCasts) violations.push(`forced-cast`);
  if (tsBypasses) violations.push(`ts-bypass`);
  if (eslintDisables) violations.push(`eslint-disable`);
  if (onlys) violations.push(`ONLY`);
  if (skips) violations.push(`skip`);
  if (deadIdTruthy) violations.push(`dead-id-truthy`);
  if (weakTerminals.length) violations.push(`weak-terminal`);
  if (its > CAP_ITS_PER_FILE) violations.push(`over-cap`);

  rows.push({
    file: rel, pkg, layer, its, itsEach, forcedCasts, tsBypasses, eslintDisables,
    onlys, skips, consoleLogs, truthy, defined, deadIdTruthy, nonNull, spies,
    asyncPauses, weakTerminals, flags, violations,
  });
}

const byPkg = {};
for (const r of rows) {
  byPkg[r.pkg] ??= { files: 0, its: 0, flags: [] };
  byPkg[r.pkg].files++;
  byPkg[r.pkg].its += r.its;
  byPkg[r.pkg].flags.push(...r.flags);
}
const totalIts = rows.reduce((s, r) => s + r.its, 0);
const flagged = rows.filter((r) => r.flags.length);

const md = [];
md.push("# Test Inventory & Hygiene Snapshot");
md.push("");
md.push("Generated: " + new Date().toISOString() + " — audited " + rows.length + " files, " + totalIts + " `it`/`test` blocks (some it.each expand further at runtime).");
md.push("");
md.push("Layer classification follows `docs/testing-strategy.md`: `contract` (zod/boundary, once per package) / `integration` (through public surface, the honeycomb's big middle) / `e2e` (max 6 suites) / `eval-harness` (vitest tests of the eval tooling — the 123-task *benchmark* is out of scope).");
md.push("");
md.push("## Totals by package");
md.push("");
md.push("| Package | Files | it/test | Hygiene flags");
md.push("|---|---|---|---|");
for (const [p, v] of Object.entries(byPkg)) {
  md.push(`| ${p} | ${v.files} | ${v.its} | ${v.flags.length ? v.flags.slice(0, 6).join(", ") : "—"}`);
}
md.push("");
md.push(`**Total: ${rows.length} files, ${totalIts} it/test blocks; ${flagged.length} files flagged.**`);
md.push("");
md.push("## Per-file inventory");
md.push("");
md.push("| File | Layer | it/test | Flags");
md.push("|---|---|---|---|");
for (const r of rows.sort((a, b) => a.file.localeCompare(b.file))) {
  md.push(`| ${r.file} | ${r.layer} | ${r.its} | ${r.flags.length ? r.flags.join("; ") : ""}`);
}
md.push("");
md.push("## Hygiene legend");
md.push("- `forced-cast(n)`: bare `as any`/`as unknown` — Q11 violation unless narrow cast + comment for negative fixtures");
md.push("- `dead-id-truthy(n)`: `expect(x.id).toBeTruthy()` — cannot fail for generated IDs (nanoid) — Q11 dead assertion");
md.push("- `weak-terminal-toBeDefined(lines)`: behavior test ending at existence-only assertion — Q11 weak terminal");
md.push("- `ts-bypass` / `eslint-disable` / `ONLY` / `skip` / `console`: must be absent (skip/ONLY must never merge to main)");
md.push("- `async-pause(n)`: `new Promise`/`setTimeout` in tests — determinism risk (Q7); simulated clock should replace");
md.push("- `over-cap(n>cap)`: more than 25 it/test per file — force parameterization (Q4)");
md.push("");
md.push("> WIP snapshot, not a gate yet. The enforcement script (P6) will fail CI on: `.only(`/`.skip(`, `as any`, `@ts-ignore`, dead-id-truthy, weak terminals, and over-cap files.");

mkdirSync(join(ROOT, "docs"), { recursive: true });
writeFileSync(OUT_MD, md.join("\n"));
writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), totals: { files: rows.length, its: totalIts }, byPackage: byPkg, files: rows }, null, 2));

console.log(`Wrote ${OUT_MD} (${rows.length} files, ${totalIts} its, ${flagged.length} flagged)`);
console.log("By package:", Object.entries(byPkg).map(([p, v]) => `${p}=${v.its}it/${v.files}f`).join(" "));
console.log("Flagged files:");
for (const r of flagged) console.log(`  ${r.file} — ${r.flags.join("; ")}`);

if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 1));

// --check: act as a CI gate. Exit non-zero if any zero-tolerance violation exists.
// Informational flags (console, async-pause) are allowlisted as documented exceptions
// (see docs/testing-findings.md), so they do not fail the gate.
if (process.argv.includes("--check")) {
  const violators = rows.filter((r) => r.violations.length);
  if (violators.length) {
    console.error("\n[audit-tests] TEST HYGIENE GATE FAILED — zero-tolerance violations:");
    for (const r of violators) {
      console.error(`  ${r.file} — ${r.violations.join(", ")}`);
    }
    process.exit(1);
  }
  console.log(`\n[audit-tests] PASS — ${rows.length} files scanned, ${totalIts} its, no violations.`);
  process.exit(0);
}