import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  SCRIPT_NORMS,
  heldOutIds,
  lowNovelty,
  motifRepeat,
  nameKeysOf,
  noveltyFloor,
  parseBeatText,
  scoreMetrics,
  scoreTurns,
  isSay,
  lengthOf,
  lengthTargetFor,
  mergeTurns,
  turnsFromBodyFrames,
  turnsFromEvents,
} from "@perfectman/shared";
import type { CorpusBeat, EventLike, ScriptLang, ScriptNorms, ScriptScore, ScriptTurn } from "@perfectman/shared";
import { loadHotelRun } from "../hotel/run-artifact.js";
import { SUMMARY_FIXTURES, TURN_FIXTURES } from "./fixtures.js";

export { SUMMARY_FIXTURES, TURN_FIXTURES } from "./fixtures.js";

/** What a score means, by size: real beats score 80 and over (92% of held-out beats on the committed norms), the production runs under 60. */
export const SCRIPT_LIKE_AT = 80;
export const NOT_SCRIPT_LIKE_BELOW = 60;
export type Verdict = "script-like" | "borderline" | "not script-like";
export const verdictOf = (score: number): Verdict => (score >= SCRIPT_LIKE_AT ? "script-like" : score >= NOT_SCRIPT_LIKE_BELOW ? "borderline" : "not script-like");

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function readJsonLines(file: string): Record<string, unknown>[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .flatMap((l) => {
      try {
        const v: unknown = JSON.parse(l);
        return isObj(v) ? [v] : [];
      } catch {
        return [];
      }
    });
}

export type LoadedTurns = { turns: ScriptTurn[]; names: string[]; source: string };

/**
 * Turns from what a run leaves behind: a hotel run directory (`events.jsonl`, plus the frame log for walks and sits), an `events.jsonl` /
 * eval simulation event log, or a JSON file of turns (`[{speaker, text, atMs?, kind?}]` or `{turns: [...]}`).
 */
export function loadTurns(input: string): LoadedTurns {
  if (!existsSync(input)) throw new Error(`no such file or directory: ${input}`);
  if (statSync(input).isDirectory()) {
    const run = loadHotelRun(input);
    const turns = mergeTurns(turnsFromEvents(run.events as unknown as EventLike[]), turnsFromBodyFrames(run.frames));
    return { turns, names: run.cast.map((m) => m.name), source: `hotel run ${input}` };
  }
  if (input.endsWith(".jsonl")) return { turns: turnsFromEvents(readJsonLines(input) as unknown as EventLike[]), names: [], source: `event log ${input}` };
  const raw: unknown = JSON.parse(readFileSync(input, "utf8"));
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw["turns"]) ? (raw["turns"] as unknown[]) : undefined;
  if (!list) throw new Error(`${input}: expected an array of turns or {"turns": [...]}`);
  const turns: ScriptTurn[] = [];
  for (const t of list) {
    if (!isObj(t) || typeof t["speaker"] !== "string" || typeof t["text"] !== "string") continue;
    turns.push({ speaker: t["speaker"], text: t["text"], ...(typeof t["atMs"] === "number" ? { atMs: t["atMs"] } : {}), ...(t["kind"] === "act" ? { kind: "act" as const } : {}) });
  }
  return { turns, names: [], source: `turns ${input}` };
}

export type ScriptReport = { id: string; source: string; verdict: Verdict; score: ScriptScore };

/** Scores one transcript against the committed norms (or the ones given). */
export function scoreTranscript(id: string, loaded: LoadedTurns, opts: { language?: ScriptLang; norms?: ScriptNorms } = {}): ScriptReport {
  const score = scoreTurns(loaded.turns, { norms: opts.norms ?? SCRIPT_NORMS, ...(opts.language ? { language: opts.language } : {}), names: loaded.names });
  return { id, source: loaded.source, verdict: verdictOf(score.score), score };
}

/** The production-style fixtures, scored. */
export function scoreFixtures(norms: ScriptNorms = SCRIPT_NORMS): Array<{ id: string; kind: "transcript" | "summary"; score: number; verdict: Verdict; sub: Record<string, number>; note: string }> {
  const rows: Array<{ id: string; kind: "transcript" | "summary"; score: number; verdict: Verdict; sub: Record<string, number>; note: string }> = [];
  for (const f of TURN_FIXTURES) {
    const r = scoreTurns(f.turns, { norms, language: f.language });
    rows.push({ id: f.id, kind: "transcript", score: r.score, verdict: verdictOf(r.score), sub: r.sub as Record<string, number>, note: r.lowN ? `${r.sayTurns} speech turns: low confidence` : `${r.sayTurns} speech turns` });
  }
  for (const f of SUMMARY_FIXTURES) {
    const r = scoreMetrics(f.metrics, { language: f.language, sayTurns: f.sayTurns, norms });
    if (!r) continue;
    const sub = Object.fromEntries(Object.entries(r.sub).map(([k, v]) => [k, v?.score ?? 0]));
    rows.push({ id: f.id, kind: "summary", score: r.score, verdict: verdictOf(r.score), sub, note: `${f.sayTurns} turns, aggregates only (length and novelty)` });
  }
  return rows;
}

// ---- real beats --------------------------------------------------------------------------------------------------------------

/** A beat of `beats.jsonl` (the corpus is local and gitignored: never read from the repo). */
export function readBeats(file: string): CorpusBeat[] {
  return readJsonLines(file) as unknown as CorpusBeat[];
}

export type CorpusValidation = {
  heldOut: number;
  byLanguage: Record<string, { beats: number; atLeast80: number; share: number; median: number; p10: number; min: number }>;
  total: { beats: number; atLeast80: number; share: number };
};

const q = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;

/**
 * Scores the held-out real beats (the ones `export-norms` kept out of the norms) and reports how many reach 80. The committed norms were
 * built without them; the set is chosen by a hash of the beat id, so the same corpus gives the same beats.
 */
export function validateOnCorpus(beats: readonly CorpusBeat[], norms: ScriptNorms = SCRIPT_NORMS): CorpusValidation {
  const perLanguage = Math.round(norms.params.holdout / 2);
  const held = heldOutIds(beats, perLanguage);
  const byLanguage: CorpusValidation["byLanguage"] = {};
  let all = 0;
  let pass = 0;
  for (const lang of ["pt", "en"] as const) {
    const scores = beats
      .filter((b) => held.has(b.id) && (b.language === lang || (lang === "pt" && b.language === "pt-BR")))
      .map((b) => scoreTurns(parseBeatText(b.text), { norms, language: lang, names: b.speakers ?? [] }).score)
      .sort((a, b) => a - b);
    if (scores.length === 0) continue;
    const ok = scores.filter((s) => s >= SCRIPT_LIKE_AT).length;
    byLanguage[lang] = { beats: scores.length, atLeast80: ok, share: Math.round((ok / scores.length) * 1000) / 1000, median: q(scores, 0.5), p10: q(scores, 0.1), min: scores[0] ?? 0 };
    all += scores.length;
    pass += ok;
  }
  return { heldOut: held.size, byLanguage, total: { beats: all, atLeast80: pass, share: all === 0 ? 0 : Math.round((pass / all) * 1000) / 1000 } };
}

export type GuardRates = {
  beats: number;
  turns: number;
  /** Turns the novelty floor flags, the motif check flags, and either. */
  novelty: number;
  motif: number;
  either: number;
  /** Turns over the short-turn cap: by design, the cap is below what the plays do. */
  overCap: number;
  /** Beats with at least one flagged turn. */
  beatsFlagged: number;
  floor: number;
};

/**
 * "Would this flag real dialogue?": runs the novelty floor and the motif check over each speech turn of real beats, the room being the turns before it.
 * `sample` takes the held-out beats first, then more by hash order, up to `count`.
 */
export function guardRatesOnCorpus(beats: readonly CorpusBeat[], lang: ScriptLang, opts: { count?: number; norms?: ScriptNorms; floorPct?: number } = {}): GuardRates {
  const norms = opts.norms ?? SCRIPT_NORMS;
  const floor = noveltyFloor(norms, lang, opts.floorPct ?? 10);
  const held = heldOutIds(beats, Math.round(norms.params.holdout / 2));
  const inLang = beats.filter((b) => (b.language === lang || (lang === "pt" && b.language === "pt-BR")) && parseBeatText(b.text).filter(isSay).length >= 4);
  const ordered = [...inLang.filter((b) => held.has(b.id)), ...inLang.filter((b) => !held.has(b.id))].slice(0, opts.count ?? inLang.length);
  const cap = lengthTargetFor("short", lang).cap;
  const r: GuardRates = { beats: ordered.length, turns: 0, novelty: 0, motif: 0, either: 0, overCap: 0, beatsFlagged: 0, floor };
  for (const b of ordered) {
    const say = parseBeatText(b.text).filter(isSay);
    const names = nameKeysOf(b.speakers ?? []);
    let flagged = false;
    for (let i = 0; i < say.length; i++) {
      const room = say.slice(0, i).map((t) => ({ speaker: t.speaker, text: t.text }));
      const text = say[i]!.text;
      r.turns++;
      const n = lowNovelty(text, room, floor) !== undefined;
      const m = motifRepeat(text, room, names) !== undefined;
      if (n) r.novelty++;
      if (m) r.motif++;
      if (n || m) {
        r.either++;
        flagged = true;
      }
      if (lengthOf(text) > cap) r.overCap++;
    }
    if (flagged) r.beatsFlagged++;
  }
  return r;
}

export function dirHas(dir: string, name: string): boolean {
  return existsSync(join(dir, name));
}
