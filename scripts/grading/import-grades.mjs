#!/usr/bin/env node
// Turn the grading page's exported JSON into one label file per clip for the calibration step.
//
//   node scripts/grading/import-grades.mjs --in perfectman-human-grades.json --out docs/eval/cinematic-grading/human-grades [--labeler owner]
//
// Writes <out>/<clip_id>.json plus <out>/index.json. Only clips marked complete are written; an
// incomplete clip is listed in index.json as skipped and nothing is filled in for it. Same shape
// family as packages/eval/src/drama/label.ts (scores.<axis>.score), with the six cinematic axes.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AXES = [
  "narrative_arc", "dialogue_naturalness", "physical_expressiveness",
  "emotion_action_fit", "cinematography_staging", "entertainment",
];

/** Pure conversion, exported for tests. Throws on a malformed export. */
export function convert(exported, { labeler = "owner" } = {}) {
  if (!exported || exported.kind !== "perfectman-human-grades" || !Array.isArray(exported.grades)) {
    throw new Error("not a perfectman-human-grades export");
  }
  const labels = []; const skipped = [];
  for (const g of exported.grades) {
    if (!g.complete) { skipped.push({ clip_id: g.clip_id, why: "incomplete" }); continue; }
    const scores = {};
    for (const a of AXES) {
      const v = g.scores?.[a];
      if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error(`${g.clip_id}: axis ${a} must be an integer 1-5, got ${v}`);
      scores[a] = { score: v };
    }
    if (!["yes", "no", "unsure"].includes(g.climax_reached)) throw new Error(`${g.clip_id}: climax_reached missing`);
    if (g.climax_reached === "yes" && !Number.isFinite(g.climax_time_s)) throw new Error(`${g.clip_id}: climax time missing`);
    labels.push({
      clipId: g.clip_id,
      run: g.run_id,
      window_s: g.window_s ?? null,
      labeler,
      labeledAt: g.updated_at ?? exported.exported_at,
      scores,
      climax: { reached: g.climax_reached, time_s: g.climax_reached === "yes" ? g.climax_time_s : null },
      ...(g.note ? { notes: g.note } : {}),
    });
  }
  return { labels, skipped };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
  if (!args.in || !args.out) { console.error("usage: import-grades.mjs --in <export.json> --out <dir> [--labeler name]"); process.exit(2); }
  const { labels, skipped } = convert(JSON.parse(readFileSync(resolve(args.in), "utf8")), { labeler: args.labeler });
  const out = resolve(args.out); mkdirSync(out, { recursive: true });
  for (const l of labels) writeFileSync(join(out, `${l.clipId}.json`), JSON.stringify(l) + "\n");
  writeFileSync(join(out, "index.json"), JSON.stringify({ written: labels.map(l => l.clipId), skipped }, null, 2) + "\n");
  console.log(`wrote ${labels.length} labels to ${out}; skipped ${skipped.length} incomplete`);
}
