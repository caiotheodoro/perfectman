#!/usr/bin/env node
/**
 * Runs a scene preset end to end on the fake grid hotel with the mock model and the real drama director and planner, and writes what happened.
 *
 *   pnpm --filter @perfectman/eval drama:sim -- --scenario tapa-na-cara [--seed 7] [--duration 240] [--drama off] --out <dir>
 *   pnpm --filter @perfectman/eval drama:sim -- --all --out <dir>          one folder per preset under <dir>
 *
 * Writes `frames.jsonl` (the hotel's frame log wrapper), `events.jsonl` (the drama events), `probes.json` (the probe report) and
 * `timeline.txt` (the frames in words). Exit 1 when a probe fails, so a script can gate on it.
 */
import { isAbsolute, join, resolve } from "node:path";
import { runDramaSim } from "../embodiment/drama-sim.js";
import { DRAMA_PRESETS, PRESETS_ROOT, presetSimConfig } from "../embodiment/drama-sim-preset.js";
import { probeReport, writeSim } from "../embodiment/sim-report.js";
import { loadPresets } from "@perfectman/server/hotel";

function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(argv: readonly string[]): Promise<number> {
  const args = argv.filter((a) => a !== "--");
  const out = flag(args, "out");
  const all = args.includes("--all");
  const scenario = flag(args, "scenario");
  if (!out || (!all && !scenario)) {
    console.error("usage: drama:sim -- --scenario <preset> | --all  [--seed n] [--duration seconds] [--drama off]  --out <dir>");
    return 2;
  }
  const dir = isAbsolute(out) ? out : resolve(process.env["INIT_CWD"] ?? process.cwd(), out);
  const seed = flag(args, "seed");
  const duration = flag(args, "duration");
  const ids = all ? [...DRAMA_PRESETS] : [scenario!];
  const known = (await loadPresets(PRESETS_ROOT)).scenes.map((s) => s.id);
  let failed = 0;
  for (const id of ids) {
    if (!known.includes(id)) {
      console.error(`no preset "${id}" (have ${known.join(", ")})`);
      return 2;
    }
    const config = await presetSimConfig(id, { ...(seed ? { seed: Number(seed) } : {}), ...(duration ? { durationMs: Number(duration) * 1000 } : {}), ...(flag(args, "drama") === "off" ? { dramaOn: false } : {}) });
    const result = runDramaSim(config);
    const target = all ? join(dir, id) : dir;
    writeSim(target, result);
    const report = probeReport(result);
    console.log(`${id}: seed ${report.seed}, ${report.acts.started} acts (${Object.entries(report.verbs).map(([v, n]) => `${v} ${n}`).join(", ")}), probes ${report.passed}/${report.total}${report.failed.length ? `, failed: ${report.failed.join("; ")}` : ""} -> ${target}`);
    if (report.failed.length > 0) failed += 1;
  }
  return failed > 0 ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  },
);
