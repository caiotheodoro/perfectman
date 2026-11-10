import { buildScriptNorms, formatNormsJson, formatNormsTs } from "@perfectman/shared";
import type { CorpusBeat, CorpusTag } from "@perfectman/shared";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * `export-norms`: the script-likeness norms (percentile ladders of turn length, novelty, motif, progress and question debt; tactic and
 * status-delta transitions of the tagged beats) from the local corpus index. Writes `script-norms.json` and the typed
 * `script-norms.generated.ts` beside it. Numbers only: no line of any play reaches either file. The clock is never read: `--built` stamps it.
 */

const readJsonl = <T>(file: string): T[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as T);

export type ExportNormsOptions = {
  beatsFile: string;
  /** Optional: without tags the tactic block is left out. */
  tagsFile?: string;
  /** Directory the two files go to. */
  outDir: string;
  built?: string;
  /** Beats of each language kept out of the norms for the benchmark's check (default 100). */
  holdoutPerLanguage?: number;
};

export function exportNorms(opts: ExportNormsOptions): { json: string; files: string[]; beats: number; eligible: number; heldOut: number; byLanguage: Record<string, number> } {
  const beats = readJsonl<CorpusBeat>(opts.beatsFile);
  const tags = opts.tagsFile ? readJsonl<CorpusTag>(opts.tagsFile) : [];
  const norms = buildScriptNorms(beats, tags, { ...(opts.built !== undefined ? { built: opts.built } : {}), ...(opts.holdoutPerLanguage !== undefined ? { holdoutPerLanguage: opts.holdoutPerLanguage } : {}) });
  const json = formatNormsJson(norms);
  mkdirSync(opts.outDir, { recursive: true });
  const files = [path.join(opts.outDir, "script-norms.json"), path.join(opts.outDir, "script-norms.generated.ts")];
  writeFileSync(files[0]!, json);
  writeFileSync(files[1]!, formatNormsTs(norms));
  return { json, files, beats: norms.source.beats, eligible: norms.source.eligible, heldOut: norms.source.heldOut, byLanguage: norms.source.byLanguage };
}
