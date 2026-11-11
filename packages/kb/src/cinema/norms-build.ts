import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatCinemaNormsJson, formatCinemaNormsTs, type CinemaNorms } from "@perfectman/shared";
import { buildNorms } from "./aggregate.js";
import { percentile } from "./features.js";
import type { SceneFeatures, SourceStats } from "./types.js";

const readJsonl = <T>(file: string): T[] => readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

const pct = (xs: number[], p: number): number => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? Math.round(percentile(s, p) * 1e4) / 1e4 : NaN; };

export type BuildCinemaOptions = { featuresFile: string; sourcesFile: string; statsFile: string; outDir: string; built?: string; reliability?: Record<string, unknown>; extraNotes?: string[] };

/** features.jsonl + sources.jsonl + stats.json (all numbers) -> cinema-norms.json and cinema-norms.generated.ts. */
export function exportCinemaNorms(o: BuildCinemaOptions): { files: string[]; norms: CinemaNorms } {
  const rows = readJsonl<SceneFeatures>(o.featuresFile);
  const srcs = readJsonl<SourceStats>(o.sourcesFile);
  const stats = JSON.parse(readFileSync(o.statsFile, "utf8")) as { byGroup: CinemaNorms["source"]["byGroup"]; runtimeRatio: number[]; estVsReal: number[]; skipped: Record<string, number> };
  const calibration: Record<string, number> = {
    "estVsReal.p25": pct(stats.estVsReal, 0.25), "estVsReal.p50": pct(stats.estVsReal, 0.5), "estVsReal.p75": pct(stats.estVsReal, 0.75), "estVsReal.n": stats.estVsReal.length,
    "runtimeRatio.p25": pct(stats.runtimeRatio, 0.25), "runtimeRatio.p50": pct(stats.runtimeRatio, 0.5), "runtimeRatio.p75": pct(stats.runtimeRatio, 0.75), "runtimeRatio.n": stats.runtimeRatio.length,
  };
  const norms = buildNorms(rows, srcs, { ...(o.built ? { built: o.built } : {}), byGroup: stats.byGroup, calibration, ...(o.reliability ? { reliability: o.reliability } : {}) });
  // Subtitle cues are shorter than a screenplay's turns (a cue holds at most two lines). English has both forms for the same medium,
  // so the gap between them is the cue-format effect; subtracting it from the Portuguese subtitle figure estimates the pt-BR turn shape.
  const p50 = (key: string, m: string): number | undefined => norms.buckets[key]?.ladders[m]?.p50;
  for (const m of ["shortShare", "microShare", "wordsP50", "wordsP90", "longShare"]) {
    for (const [medium, other] of [["film", "screenplay"], ["series", "transcript"]] as const) {
      const sub = p50(`en/${medium}/subtitle`, m), ref = p50(`en/${medium}/${other}`, m), pt = p50(`pt/${medium}/subtitle`, m);
      if (sub === undefined || ref === undefined) continue;
      calibration[`subtitleCueBias.en.${medium}.${m}`] = Math.round((sub - ref) * 1e4) / 1e4;
      if (pt !== undefined) calibration[`ptAdjusted.${medium}.${m}`] = Math.round((pt - (sub - ref)) * 1e4) / 1e4;
    }
  }
  norms.notes = [
    "estVsReal: reading-rate estimate of a subtitle scene's seconds divided by its real seconds (1.0 would be exact; subtitle scenes hold speech only, so below 1 is expected where silence is long).",
    "runtimeRatio: a film's running time divided by the reading-rate estimate of its screenplay (above 1: films run longer than text weight alone says, i.e. action, music and silence).",
    "Skipped at the source level: " + JSON.stringify(stats.skipped),
    "How to use it for pt-BR: rhythm (silenceShare, gapsOver2sPerMin, rapidShare, turnsPerMin, ellipsisShare) from pt/film/subtitle and pt/series/subtitle, which have real cue times; turn length from the same buckets only through calibration.ptAdjusted.*, because a subtitle cue is shorter than a spoken turn.",
    "Structure and action (dirPerMin, hardActs, reversals, eventsPer10, tInciting, tClimax, aftermathShare, curves) have no pt-BR source with action lines at scale: use en/film/screenplay and the en/series/transcript children as the prior, pt/stage/play as a pt cross-check, and say so in any score that leans on them.",
    "tInciting, tClimax and aftermathShare: read strongArc.ladders (peak 0.3+ and rise 0.15+). The hand-check found climax placement plausible in 16 of 18 such scenes and in about 60% of all scenes with an arc.",
    "Melodrama (soap and telenovela style) exists only as en/series/transcript/melodrama (soap-opera transcripts). No pt-BR telenovela text was publicly reachable. Family drama is the drama children.",
    "en/series/transcript pools fan transcripts with and without action lines (soap transcripts have none); read direction rates from its comedy, drama and thriller children, which are action-line transcripts.",
    ...(o.extraNotes ?? []),
  ];
  mkdirSync(o.outDir, { recursive: true });
  const files = [path.join(o.outDir, "cinema-norms.json"), path.join(o.outDir, "cinema-norms.generated.ts")];
  writeFileSync(files[0]!, formatCinemaNormsJson(norms));
  writeFileSync(files[1]!, formatCinemaNormsTs(norms));
  return { files, norms };
}
