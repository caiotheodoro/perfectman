import { MIN_SAY_TURNS, analyze, computeScriptStats, noveltyStats } from "./metrics.js";
import type { ScriptStats } from "./metrics.js";
import { BEAT_METRICS, BUCKETS, SCENE_BUCKETS, SCENE_FROM_TURNS, beatMetrics, bucketOf, ladderOf, sceneBucketOf } from "./norms.js";
import type { BeatMetric, Bucket, BucketNorms, Ladder, LangNorms, SceneBucket, SceneNorms, ScriptMedium, ScriptNorms, TacticNorms } from "./norms.js";
import { scoreStats } from "./score.js";
import type { ScriptLang } from "./text.js";
import { isSay, parseBeatText } from "./turns.js";
import type { ScriptTurn } from "./turns.js";

const round = (v: number, digits = 4): number => Math.round(v * 10 ** digits) / 10 ** digits;

// ---- what the builder reads --------------------------------------------------------------------------------------------

/** A beat as the KB's `beats.jsonl` keeps it (the fields the norms read). */
export type CorpusBeat = {
  id: string;
  sourceId?: string;
  act?: string;
  scene?: string;
  index?: number;
  language: string;
  medium: string;
  text: string;
  speakers?: string[];
};

/** A tag row of `tags.jsonl` (the fields the tactic norms read). */
export type CorpusTag = { id: string; tactic_verb?: string; status_delta?: string };

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const langOf = (b: CorpusBeat): ScriptLang | undefined => (b.language === "pt" || b.language === "pt-BR" ? "pt" : b.language === "en" ? "en" : undefined);

type Prepared = { beat: CorpusBeat; lang: ScriptLang; medium: ScriptMedium; stats: ScriptStats };

function prepare(beats: readonly CorpusBeat[]): Prepared[] {
  const out: Prepared[] = [];
  for (const beat of beats) {
    const lang = langOf(beat);
    if (!lang) continue;
    const turns = parseBeatText(beat.text);
    const stats = computeScriptStats(turns, { language: lang, names: beat.speakers ?? [] });
    out.push({ beat, lang, medium: beat.medium === "CINEMA" ? "CINEMA" : "THEATRE", stats });
  }
  return out;
}

/**
 * The beats kept out of the norms and used only to check them: `perLanguage` beats of each language with at least 4 speech turns,
 * the ones whose id hashes lowest. The same call on the same corpus gives the same ids. A `salt` picks a different set (a second, independent check).
 */
export function heldOutIds(beats: readonly CorpusBeat[], perLanguage: number, salt = ""): Set<string> {
  const out = new Set<string>();
  for (const lang of ["pt", "en"] as const) {
    const ids = beats
      .filter((b) => langOf(b) === lang && parseBeatText(b.text).filter(isSay).length >= MIN_SAY_TURNS)
      .map((b) => b.id)
      .sort((a, b) => fnv1a(salt + a) - fnv1a(salt + b) || (a < b ? -1 : 1));
    for (const id of ids.slice(0, perLanguage)) out.add(id);
  }
  return out;
}

/** A scene of the corpus: its consecutive beats (by `index`) joined into one list of turns. */
export type CorpusScene = { key: string; beats: CorpusBeat[]; lang: ScriptLang; medium: ScriptMedium; turns: ScriptTurn[] };

/**
 * Scenes of a corpus: beats grouped by source, act and scene and read in `index` order, their turns joined. A scene is the unit a long run is
 * read against, and a beat's neighbours are what makes it one (the corpus has no gaps in a scene's indices).
 */
export function joinScenes(beats: readonly CorpusBeat[]): CorpusScene[] {
  const groups = new Map<string, CorpusBeat[]>();
  for (const b of beats) {
    if (!langOf(b)) continue;
    const key = `${b.sourceId ?? ""}|${b.act ?? ""}|${b.scene ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  const out: CorpusScene[] = [];
  for (const [key, list] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    list.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const first = list[0]!;
    out.push({ key, beats: list, lang: langOf(first)!, medium: first.medium === "CINEMA" ? "CINEMA" : "THEATRE", turns: list.flatMap((b) => parseBeatText(b.text)) });
  }
  return out;
}

type PreparedScene = { scene: CorpusScene; stats: ScriptStats };

/** Scenes of 13 or more speech turns that hold no held-out beat, with their stats. */
function prepareScenes(beats: readonly CorpusBeat[], held: ReadonlySet<string>): PreparedScene[] {
  const out: PreparedScene[] = [];
  for (const scene of joinScenes(beats)) {
    if (scene.beats.some((b) => held.has(b.id))) continue;
    const stats = computeScriptStats(scene.turns, { language: scene.lang, names: scene.beats.flatMap((b) => b.speakers ?? []) });
    if (stats.sayTurns >= SCENE_FROM_TURNS) out.push({ scene, stats });
  }
  return out;
}

function sceneNorms(group: readonly PreparedScene[]): SceneNorms {
  const buckets = {} as SceneNorms["buckets"];
  for (const bucket of SCENE_BUCKETS) {
    const inBucket = group.filter((p) => sceneBucketOf(p.stats.sayTurns) === bucket);
    const metrics = {} as Record<BeatMetric, Ladder>;
    for (const m of BEAT_METRICS) metrics[m] = ladderOf(inBucket.map((p) => beatMetrics(p.stats)[m]));
    buckets[bucket] = { beats: inBucket.length, metrics, lateReversal: inBucket.length === 0 ? 0 : round(inBucket.filter((p) => p.stats.progress.lateReversal).length / inBucket.length) };
  }
  const beatCount = group.reduce((a, p) => a + p.scene.beats.length, 0);
  const sayCount = group.reduce((a, p) => a + p.stats.sayTurns, 0);
  return {
    scenes: group.length,
    beatsPerScene: group.length === 0 ? 0 : round(beatCount / group.length, 2),
    turnsPerBeat: beatCount === 0 ? 0 : round(sayCount / beatCount, 2),
    sayTurns: ladderOf(group.map((p) => p.stats.sayTurns)),
    buckets,
    score: [],
  };
}

function tacticNorms(beats: readonly CorpusBeat[], tags: ReadonlyMap<string, CorpusTag>): TacticNorms | undefined {
  const tagged = beats.filter((b) => tags.has(b.id));
  if (tagged.length === 0) return undefined;
  const share = (counts: Map<string, number>, total: number): Record<string, number> =>
    Object.fromEntries([...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => [k, round(v / total)]));
  const status = new Map<string, number>();
  const tactic = new Map<string, number>();
  for (const b of tagged) {
    const t = tags.get(b.id)!;
    if (t.status_delta) status.set(t.status_delta, (status.get(t.status_delta) ?? 0) + 1);
    if (t.tactic_verb) tactic.set(t.tactic_verb, (tactic.get(t.tactic_verb) ?? 0) + 1);
  }
  const scenes = new Map<string, CorpusBeat[]>();
  for (const b of tagged) scenes.set(`${b.sourceId ?? ""}|${b.act ?? ""}|${b.scene ?? ""}`, [...(scenes.get(`${b.sourceId ?? ""}|${b.act ?? ""}|${b.scene ?? ""}`) ?? []), b]);
  const next = new Map<string, Map<string, number>>();
  let pairs = 0;
  let sameTactic = 0;
  let sameStatus = 0;
  const runs: number[] = [];
  for (const list of scenes.values()) {
    list.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    let run = 1;
    for (let i = 1; i < list.length; i++) {
      // Adjacent beats only: the tagged ones are a sample, a gap of three beats is not "next".
      if ((list[i]!.index ?? 0) - (list[i - 1]!.index ?? 0) > 2) {
        runs.push(run);
        run = 1;
        continue;
      }
      const a = tags.get(list[i - 1]!.id)!;
      const b = tags.get(list[i]!.id)!;
      pairs++;
      if (a.tactic_verb && a.tactic_verb === b.tactic_verb) sameTactic++;
      if (a.status_delta && b.status_delta) {
        if (a.status_delta === b.status_delta) {
          sameStatus++;
          run++;
        } else {
          runs.push(run);
          run = 1;
        }
        const row = next.get(a.status_delta) ?? new Map<string, number>();
        row.set(b.status_delta, (row.get(b.status_delta) ?? 0) + 1);
        next.set(a.status_delta, row);
      }
    }
    runs.push(run);
  }
  const statusNext: Record<string, Record<string, number>> = {};
  for (const [from, row] of [...next].sort((a, b) => (a[0] < b[0] ? -1 : 1))) statusNext[from] = share(row, [...row.values()].reduce((x, y) => x + y, 0));
  return {
    tagged: tagged.length,
    statusDelta: share(status, [...status.values()].reduce((x, y) => x + y, 0) || 1),
    statusNext,
    sameTacticNext: pairs === 0 ? 0 : round(sameTactic / pairs),
    sameStatusNext: pairs === 0 ? 0 : round(sameStatus / pairs),
    statusRunMean: runs.length === 0 ? 0 : round(runs.reduce((a, b) => a + b, 0) / runs.length),
    tacticTop: [...tactic].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 15).map(([k, v]) => [k, round(v / [...tactic.values()].reduce((x, y) => x + y, 0))]),
  };
}

export type BuildNormsOptions = {
  /** The `--built` stamp: the builder never reads the clock. */
  built?: string;
  /** Beats of each language kept out of the norms (see {@link heldOutIds}). */
  holdoutPerLanguage?: number;
  goodPct?: number;
  badPct?: number;
  /** Picks a different held-out set (default none, which is what the committed norms use). */
  holdoutSalt?: string;
};

/** Builds the norms from a corpus. Deterministic: the same beats and options give the same numbers. */
export function buildScriptNorms(beats: readonly CorpusBeat[], tags: readonly CorpusTag[] = [], opts: BuildNormsOptions = {}): ScriptNorms {
  const holdPer = opts.holdoutPerLanguage ?? 100;
  const goodPct = opts.goodPct ?? 97.5;
  const badPct = opts.badPct ?? 100;
  const held = heldOutIds(beats, holdPer, opts.holdoutSalt ?? "");
  const tagMap = new Map(tags.map((t) => [t.id, t]));
  const prepared = prepare(beats);
  const eligible = prepared.filter((p) => p.stats.sayTurns >= MIN_SAY_TURNS);
  const kept = eligible.filter((p) => !held.has(p.beat.id));
  const scenes = prepareScenes(beats, held);

  const norms: ScriptNorms = {
    format: "perfectman-script-norms",
    version: 1,
    ...(opts.built !== undefined ? { built: opts.built } : {}),
    params: { minSayTurns: MIN_SAY_TURNS, noveltyWindow: 6, motifWindowTurns: 7, motifWindowMs: 90_000, capWords: [25, 40], shortReplyWords: 5, goodPct, badPct, holdout: held.size, ...(opts.holdoutSalt ? { holdoutSalt: opts.holdoutSalt } : {}) },
    source: { beats: beats.length, eligible: eligible.length, heldOut: held.size, byLanguage: {} },
    languages: {},
  };

  for (const lang of ["pt", "en"] as const) {
    for (const medium of ["THEATRE", "CINEMA"] as const) {
      const group = kept.filter((p) => p.lang === lang && p.medium === medium);
      if (group.length === 0) continue;
      norms.source.byLanguage[`${lang}/${medium}`] = group.length;
      const allWords: number[] = [];
      const judged: number[] = [];
      const noveltyMeans: number[] = [];
      const runMeans: number[] = [];
      let cut = 0;
      let trail = 0;
      let turnCount = 0;
      for (const p of group) {
        const turns = parseBeatText(p.beat.text).filter(isSay);
        const say = turns.map(analyze);
        for (const a of say) allWords.push(a.words.length);
        const nv = noveltyStats(say);
        judged.push(...nv.judged);
        noveltyMeans.push(...nv.values);
        runMeans.push(p.stats.rhythm.runMean);
        cut += p.stats.rhythm.cutOff * say.length;
        trail += p.stats.rhythm.trailOff * say.length;
        turnCount += say.length;
      }
      const over = (cap: number): number => allWords.filter((w) => w > cap).length / allWords.length;
      const buckets = {} as Record<Bucket, BucketNorms>;
      for (const bucket of BUCKETS) {
        const inBucket = group.filter((p) => bucketOf(p.stats.sayTurns) === bucket);
        const metrics = {} as Record<BeatMetric, Ladder>;
        for (const m of BEAT_METRICS) metrics[m] = ladderOf(inBucket.map((p) => beatMetrics(p.stats)[m]));
        buckets[bucket] = { beats: inBucket.length, metrics };
      }
      const tactic = tacticNorms(
        beats.filter((b) => langOf(b) === lang && (b.medium === "CINEMA" ? "CINEMA" : "THEATRE") === medium && !held.has(b.id)),
        tagMap,
      );
      const sceneGroup = scenes.filter((p) => p.scene.lang === lang && p.scene.medium === medium);
      const lang_norms: LangNorms = {
        beats: group.length,
        turns: turnCount,
        turnsPerBeat: round(turnCount / group.length, 2),
        words: { ladder: ladderOf(allWords), mean: round(allWords.reduce((a, b) => a + b, 0) / allWords.length), over25: round(over(25)), over40: round(over(40)), short: round(allWords.filter((w) => w <= 5).length / allWords.length) },
        novelty: { mean: round(noveltyMeans.reduce((a, b) => a + b, 0) / Math.max(1, noveltyMeans.length)), judged: ladderOf(judged) },
        rhythm: { runMean: round(runMeans.reduce((a, b) => a + b, 0) / runMeans.length), cutOff: round(cut / turnCount), trailOff: round(trail / turnCount) },
        buckets,
        ...(sceneGroup.length > 0 ? { scene: sceneNorms(sceneGroup) } : {}),
        score: [],
        ...(tactic ? { tactic } : {}),
      };
      const langBlock = (norms.languages[lang] ??= {});
      langBlock[medium] = lang_norms;
    }
  }

  // Second pass: how the corpus beats score against these norms, so a score has a percentile.
  for (const lang of ["pt", "en"] as const) {
    for (const medium of ["THEATRE", "CINEMA"] as const) {
      const block = norms.languages[lang]?.[medium];
      if (!block) continue;
      const scores = kept.filter((p) => p.lang === lang && p.medium === medium).map((p) => scoreStats(p.stats, norms, medium, "beat").score);
      block.score = ladderOf(scores);
      if (block.scene) block.scene.score = ladderOf(scenes.filter((p) => p.scene.lang === lang && p.scene.medium === medium).map((p) => scoreStats(p.stats, norms, medium, "scene").score));
    }
  }
  return norms;
}


/** The committed `script-norms.json`: two-space JSON with each ladder on one line, a trailing newline, the same bytes for the same norms. */
export function formatNormsJson(norms: ScriptNorms): string {
  const text = JSON.stringify(norms, null, 2).replace(/\[\s*(-?[\d.e+-]+(?:,\s*-?[\d.e+-]+)*)\s*\]/gu, (_m, nums: string) => `[${nums.split(/,\s*/u).join(", ")}]`);
  return `${text}\n`;
}

/** `script-norms.generated.ts`: the same numbers as a typed constant, which is what the packages import (no file read at run time, none in a browser bundle). */
export function formatNormsTs(norms: ScriptNorms): string {
  return [
    "/** Generated by `export-norms` in @perfectman/kb from the real-play corpus; the same numbers as script-norms.json. Do not edit: a test pins the two equal. */",
    'import type { ScriptNorms } from "./norms.js";',
    "",
    `export const SCRIPT_NORMS: ScriptNorms = ${formatNormsJson(norms).trimEnd()};`,
    "",
  ].join("\n");
}
