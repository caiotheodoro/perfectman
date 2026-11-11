#!/usr/bin/env node
/**
 * Runs a scene preset end to end on the fake grid hotel with the mock model and the real drama director and planner, and writes what happened.
 *
 *   pnpm --filter @perfectman/eval drama:sim -- --scenario tapa-na-cara [--seed 7] [--duration 240] [--drama off] --out <dir>
 *   pnpm --filter @perfectman/eval drama:sim -- --all --out <dir>          one folder per preset under <dir>
 *   pnpm --filter @perfectman/eval drama:sim -- --scenario confronto-da-traicao --sheet [mock|<sheet.json>] [--climax slap] [--climax-at 170] --out <dir>
 *                                                                          the preset played from a beat sheet (Contract A): exit 1 unless the climax act comes by 240 s
 *
 * Writes `frames.jsonl` (the hotel's frame log wrapper), `events.jsonl` (the drama events), `probes.json` (the probe report) and
 * `timeline.txt` (the frames in words). Exit 1 when a probe fails, so a script can gate on it.
 */
import { isAbsolute, join, resolve } from "node:path";
import { runDramaSim } from "../embodiment/drama-sim.js";
import { DRAMA_PRESETS, PRESETS_ROOT, presetSimConfig, sheetSimConfig } from "../embodiment/drama-sim-preset.js";
import { sheetProbes } from "../probes/sheet.js";
import { readFileSync } from "node:fs";
import type { ActVerb } from "@perfectman/shared";
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
    const sheetArg = flag(args, "sheet");
    const config = sheetArg !== undefined || args.includes("--sheet")
      ? await sheetSimConfig(id, { ...(seed ? { seed: Number(seed) } : {}), ...(duration ? { durationMs: Number(duration) * 1000 } : {}), ...(sheetArg && sheetArg !== "mock" && !sheetArg.startsWith("--") ? { sheet: JSON.parse(readFileSync(isAbsolute(sheetArg) ? sheetArg : resolve(process.env["INIT_CWD"] ?? process.cwd(), sheetArg), "utf8")) as unknown } : {}), ...(flag(args, "climax") ? { climax: flag(args, "climax") as ActVerb } : {}), ...(flag(args, "climax-at") ? { climaxAtMs: Number(flag(args, "climax-at")) * 1000 } : {}) })
      : await presetSimConfig(id, { ...(seed ? { seed: Number(seed) } : {}), ...(duration ? { durationMs: Number(duration) * 1000 } : {}), ...(flag(args, "drama") === "off" ? { dramaOn: false } : {}) });
    const result = runDramaSim(config);
    const target = all ? join(dir, id) : dir;
    writeSim(target, result);
    const report = probeReport(result);
    if (config.sheet) {
      const sp = sheetProbes(result, config.sheet);
      const bad = sp.filter((p) => !p.passed);
      const climax = sp.find((p) => p.probe === "sheet-climax-by-240s");
      console.log(`${id} [sheet]: climax ${climax && climax.measured < 1e9 ? `at ${(climax.measured / 1000).toFixed(1)} s` : "NEVER"}, sheet probes ${sp.length - bad.length}/${sp.length}${bad.length ? `, failed: ${bad.map((p) => `${p.probe}=${p.measured}`).join("; ")}` : ""}`);
      if (bad.length > 0) failed += 1;
    }
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
