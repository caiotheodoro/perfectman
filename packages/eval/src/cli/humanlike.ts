/**
 * humanlike: how close to real people a run's bodies and turns look (cinematic revamp B5).
 *
 *   pnpm --filter @perfectman/eval humanlike --run <run dir> [--run <dir> ...] [--json]
 *   pnpm --filter @perfectman/eval humanlike --runs-root <dir> --ids 55-63 [--json] [--write-md docs/eval/humanlike-baseline.md] [--write-json docs/eval/humanlike-baseline.json]
 *
 * Reads `frames.jsonl`, `body-frames.json` and `replay.json` of each run folder (the hotel's frame log and the sidecar's), and prints the distance
 * distribution against the proximity bands, stacking, gaze to the addressee, reaction latency, overlap and interruption, typing, gesture and
 * non-verbal backchannel rates, idle motion, and walks per actor-minute, with a 0-100 score the cinematic score's embodiment group can take.
 * Deterministic, no network.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { computeHumanlike } from "../humanlike/metrics.js";
import { renderBaselineMarkdown, renderRow } from "../humanlike/report.js";
import type { HumanlikeRow } from "../humanlike/report.js";
import { loadRunTrace } from "../humanlike/run-trace.js";
import { scoreHumanlike } from "../humanlike/score.js";

function values(args: readonly string[], name: string): string[] {
  return args.flatMap((a, i) => (a === `--${name}` && args[i + 1] !== undefined ? [args[i + 1]!] : []));
}

function ids(spec: string): string[] {
  return spec.split(",").flatMap((part) => {
    const m = /^(\d+)-(\d+)$/.exec(part.trim());
    if (!m) return [part.trim()];
    return Array.from({ length: Number(m[2]) - Number(m[1]) + 1 }, (_, i) => String(Number(m[1]) + i));
  });
}

export function rowOf(dir: string, label?: string): HumanlikeRow {
  const metrics = computeHumanlike(loadRunTrace(dir, label));
  return { metrics, score: scoreHumanlike(metrics) };
}

export async function runHumanlikeCli(argv: string[]): Promise<void> {
  const args = argv.filter((a) => a !== "--");
  const base = process.env["INIT_CWD"] ?? process.cwd();
  const dirs: Array<{ dir: string; label?: string }> = values(args, "run").map((d) => ({ dir: resolve(base, d) }));
  const root = values(args, "runs-root")[0];
  const spec = values(args, "ids")[0];
  if (root && spec) for (const id of ids(spec)) dirs.push({ dir: resolve(base, root, id), label: id });
  if (dirs.length === 0) {
    console.error("usage: humanlike --run <run dir> [--run <dir> ...] [--json]  |  --runs-root <dir> --ids 55-63  [--write-md <file>] [--write-json <file>]");
    process.exit(2);
  }
  const rows = dirs.map((d) => rowOf(d.dir, d.label));
  const mdPath = values(args, "write-md")[0];
  const jsonPath = values(args, "write-json")[0];
  if (jsonPath) {
    const file = resolve(base, jsonPath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`);
  }
  if (mdPath) {
    const file = resolve(base, mdPath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, renderBaselineMarkdown("Human-likeness baseline: runs 55 to 63", rows, "Measured with `pnpm --filter @perfectman/eval humanlike` on the hotel runs 55-63 (a cast of three, cinematic mode, before the human layer). Rates are per actor-minute of the scene, counted from the first line. Runs 55 to 58 predate the addressee log (`body-frames.json` `chat` frames), so their distance and gaze rows are n/a: their lines have no known addressee. The score only counts the bands that have a number."));
  }
  if (args.includes("--json")) console.log(JSON.stringify(rows.length === 1 ? rows[0] : rows, null, 2));
  else for (const r of rows) console.log(`${renderRow(r)}\n`);
}

if (process.argv[1]?.endsWith("humanlike.js") || process.argv[1]?.endsWith("humanlike.ts")) {
  runHumanlikeCli(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
