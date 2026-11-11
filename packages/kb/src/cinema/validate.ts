import { readFileSync } from "node:fs";
import type { Beat, TagRecord } from "../types.js";
import { directionIntensity, turnIntensity } from "./features.js";
import type { CineLang } from "./types.js";

const readJsonl = <T>(file: string): T[] => readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

/** Area under the ROC curve: the chance a random positive scores above a random negative (ties count half). */
export function auc(pos: readonly number[], neg: readonly number[]): number {
  if (pos.length === 0 || neg.length === 0) return NaN;
  const all = [...pos.map((v) => ({ v, p: 1 })), ...neg.map((v) => ({ v, p: 0 }))].sort((a, b) => a.v - b.v);
  let rank = 1, sumPos = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j < all.length && all[j]!.v === all[i]!.v) j++;
    const avg = (rank + (rank + (j - i) - 1)) / 2;
    for (let k = i; k < j; k++) if (all[k]!.p) sumPos += avg;
    rank += j - i; i = j;
  }
  return (sumPos - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}

const VIOLENT = new Set(["KILLING", "VIOLENT_STRIKE", "VIOLENT_PUSH"]);
const PHYSICAL = new Set(["KILLING", "VIOLENT_STRIKE", "VIOLENT_PUSH", "KISSING", "HUGGING", "FAINTING", "PHYSICAL_RETREAT"]);
const HOT = new Set(["anger", "contempt", "fear", "jealousy"]);

export type BeatValidation = {
  beats: number;
  /** AUC of the beat's strongest turn intensity for hot emotion vs the rest. */
  aucMaxTurnIntensityVsHotEmotion: { auc: number; pos: number; neg: number; lang: Record<string, number> };
  /** AUC of the beat's highest direction-or-turn intensity for violent action vs dialogue only. */
  aucMaxIntensityVsViolentAction: { auc: number; pos: number; neg: number };
  /** Hard-act lexicon on directions against the tagger's physical action label. */
  hardActLexicon: { precision: number; recall: number; tp: number; fp: number; fn: number };
};

/** Check the intensity proxy and the act lexicon against the existing hand-tagged (model-tagged, spot-checked) beats. */
export function validateOnTaggedBeats(beatsFile: string, tagsFile: string): BeatValidation {
  const tags = new Map(readJsonl<TagRecord>(tagsFile).map((t) => [t.id, t]));
  const beats = readJsonl<Beat>(beatsFile).filter((b) => tags.has(b.id));
  const hotPos: number[] = [], hotNeg: number[] = [], vPos: number[] = [], vNeg: number[] = [];
  const byLang: Record<string, { p: number[]; n: number[] }> = {};
  let tp = 0, fp = 0, fn = 0;
  for (const b of beats) {
    const t = tags.get(b.id)!;
    const lang: CineLang = b.language === "pt" ? "pt" : "en";
    const speech = b.text.split("\n").filter((l) => /^[A-Z][A-Za-z .'\-]{0,30}:\s/.test(l)).map((l) => l.replace(/^[^:]+:\s*/, ""));
    const maxTurn = Math.max(0, ...speech.map((s) => turnIntensity(s, lang)));
    const dirs = b.directions.map((d) => directionIntensity(d, lang));
    const maxAny = Math.max(maxTurn, ...dirs.map((d) => d.v));
    const hot = HOT.has(t.emotion);
    (hot ? hotPos : hotNeg).push(maxTurn);
    ((byLang[b.language] ??= { p: [], n: [] })[hot ? "p" : "n"]).push(maxTurn);
    if (VIOLENT.has(t.action_type)) vPos.push(maxAny); else if (t.action_type === "DIALOGUE_ONLY") vNeg.push(maxAny);
    const detected = dirs.some((d) => d.hard > 0);
    const phys = PHYSICAL.has(t.action_type);
    if (detected && phys) tp++; else if (detected && !phys) fp++; else if (!detected && phys) fn++;
  }
  const lang: Record<string, number> = {};
  for (const [k, v] of Object.entries(byLang)) lang[k] = Math.round(auc(v.p, v.n) * 1e3) / 1e3;
  const r = (x: number): number => Math.round(x * 1e3) / 1e3;
  return {
    beats: beats.length,
    aucMaxTurnIntensityVsHotEmotion: { auc: r(auc(hotPos, hotNeg)), pos: hotPos.length, neg: hotNeg.length, lang },
    aucMaxIntensityVsViolentAction: { auc: r(auc(vPos, vNeg)), pos: vPos.length, neg: vNeg.length },
    hardActLexicon: { precision: r(tp / Math.max(1, tp + fp)), recall: r(tp / Math.max(1, tp + fn)), tp, fp, fn },
  };
}
