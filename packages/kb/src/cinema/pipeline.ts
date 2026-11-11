import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { loadCorpus, scenesOf } from "../ingest/index.js";
import { estimateSceneSec, measureScene } from "./features.js";
import { genreBucket, imdbKey, loadImdb, type ImdbRow } from "./imdb.js";
import { PLAY_GENRE, SHOW_GENRE, showOf } from "./meta.js";
import { parseMovieSum } from "./parsers/moviesum.js";
import { parseLayoutScreenplay } from "./parsers/layout.js";
import { parseSummScreen } from "./parsers/summscreen.js";
import { cuesToScenes, parseOpusXml, subtitleQuality } from "./parsers/subtitles.js";
import { playToScenes } from "./plays.js";
import type { CineGenre, CineScene, SceneFeatures, SourceInfo, SourceStats } from "./types.js";

export type ProvenanceRow = {
  id: string;
  group: string;
  lang: string;
  medium: string;
  form: string;
  genre: string;
  title?: string;
  imdb?: string;
  scenes: number;
  note?: string;
};

export type PipelineStats = {
  sources: number;
  scenes: number;
  skipped: Record<string, number>;
  /** Share-out of film running time over screenplay text weight (ratio runtime seconds / estimated seconds), per film. */
  runtimeRatio: number[];
  /** Subtitle scenes: estimated seconds / real seconds, per scene (how far the reading-rate model is off). */
  estVsReal: number[];
  byGroup: Record<string, { sources: number; scenes: number }>;
};

export type PipelineConfig = {
  /** packages/kb/corpus */
  corpus: string;
  /** packages/kb/corpus/cinema */
  cinema: string;
  groups?: string[];
  limit?: Record<string, number>;
  log?: (s: string) => void;
  /** Called with every measured scene (text in memory only), for the hand-check sampler. */
  onScene?: (scene: CineScene, info: SourceInfo, f: SceneFeatures) => void;
};

const GROUPS = ["plays", "moviesum", "summscreen", "tms", "opus-ptbr-native", "opus-ptbr", "opus-en", "extra"] as const;

type Emit = (f: SceneFeatures) => void;
export type EmitSource = (s: SourceStats) => void;

const med = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)]! + (s.length % 2 ? 0 : (s[s.length / 2]! - s[s.length / 2 - 1]!) / 2) : NaN; };
function sourceStats(fs: SceneFeatures[], info: SourceInfo, extra: Partial<SourceStats>): SourceStats {
  const sec = fs.reduce((a, f) => a + f.durSec, 0);
  const min = Math.max(sec / 60, 1e-6);
  const turns = fs.reduce((a, f) => a + f.turns, 0);
  const sw = fs.reduce((a, f) => a + f.speechWords, 0), dw = fs.reduce((a, f) => a + f.dirWords, 0);
  const has = fs[0]!.hasDirections;
  const r = (x: number): number => Math.round(x * 1e4) / 1e4;
  return {
    src: info.id, lang: info.lang, medium: info.medium, genre: info.genre, era: info.era, form: info.form, native: info.native ?? false, scenes: fs.length, turns, minutes: r(min), turnsPerMin: r(turns / min), sceneMinP50: r(med(fs.map((f) => f.durSec)) / 60),
    scenesPer10Min: r((fs.length / min) * 10), dialogueShare: has ? r(sw / Math.max(1, sw + dw)) : null,
    hardActsPer10Min: has ? r((fs.reduce((a, f) => a + (f.hardActs ?? 0), 0) / min) * 10) : null, dirPerMin: has ? r(fs.reduce((a, f) => a + f.directions, 0) / min) : null,
    talkShare: null, gaps2PerMin: null, gaps5PerMin: null, gaps12PerMin: null, ...extra,
  };
}

function measureAll(scenes: CineScene[], info: SourceInfo, emit: Emit, stats: PipelineStats, totalSec?: number, onScene?: PipelineConfig["onScene"]): SceneFeatures[] {
  let sum = 0;
  const est = scenes.map((s) => estimateSceneSec(s.events));
  if (totalSec !== undefined) sum = est.reduce((a, b) => a + b, 0);
  const got: SceneFeatures[] = [];
  scenes.forEach((s, i) => {
    const durSec = totalSec !== undefined && sum > 0 ? (totalSec * est[i]!) / sum : s.durationSec ?? est[i]!;
    const f = measureScene(s, info, { durSec });
    if (!f) return;
    if (info.timeSource === "subtitle" && s.durationSec) stats.estVsReal.push(est[i]! / s.durationSec);
    emit(f);
    onScene?.(s, info, f);
    got.push(f);
  });
  return got;
}

/** Run every source group, calling `emit` for each scene's features. Text is read, measured and dropped. */
export async function runPipeline(cfg: PipelineConfig, emit: Emit, emitSource: EmitSource = () => {}): Promise<{ stats: PipelineStats; provenance: ProvenanceRow[] }> {
  const log = cfg.log ?? (() => {});
  const want = new Set(cfg.groups ?? GROUPS);
  const stats: PipelineStats = { sources: 0, scenes: 0, skipped: {}, runtimeRatio: [], estVsReal: [], byGroup: {} };
  const prov: ProvenanceRow[] = [];
  const skip = (why: string): void => { stats.skipped[why] = (stats.skipped[why] ?? 0) + 1; };
  const done = (group: string, row: Omit<ProvenanceRow, "group">, fs: SceneFeatures[], info: SourceInfo, extra: Partial<SourceStats> = {}): void => {
    const n = fs.length;
    if (n === 0) { skip(`${group}: no scenes`); return; }
    stats.sources += 1; stats.scenes += n;
    const g = (stats.byGroup[group] ??= { sources: 0, scenes: 0 });
    g.sources += 1; g.scenes += n;
    prov.push({ group, ...row, scenes: n });
    emitSource(sourceStats(fs, info, extra));
  };
  const lim = (g: string): number => cfg.limit?.[g] ?? Infinity;

  // ---- IMDb rows for the subtitle and screenplay groups -------------------------------------------------------------
  const imdbFile = path.join(cfg.cinema, "imdb", "title.basics.tsv.gz");
  const ids = new Set<string>();
  const subFiles: Record<string, string[]> = { "opus-ptbr-native": [], "opus-ptbr": [], "opus-en": [] };
  const nativeFile = path.join(cfg.cinema, "imdb", "br_native_ids.txt");
  const nativeIds = new Set<string>(existsSync(nativeFile) ? readFileSync(nativeFile, "utf8").split(/\s+/).filter(Boolean) : []);
  for (const g of ["opus-ptbr-native", "opus-ptbr", "opus-en"]) {
    const dir = path.join(cfg.cinema, g);
    if (want.has(g) && existsSync(dir)) {
      subFiles[g] = readdirSync(dir).filter((f) => f.endsWith(".xml")).sort();
      for (const f of subFiles[g]!) ids.add(imdbKey(f.split("__")[2]!));
    }
  }
  const msFiles = ["train", "val", "test"].map((s) => path.join(cfg.cinema, "moviesum", `${s}.jsonl`)).filter(existsSync);
  const imdb: Map<string, ImdbRow> = want.has("moviesum") || ids.size ? await (async () => {
    if (!existsSync(imdbFile)) return new Map<string, ImdbRow>();
    if (want.has("moviesum")) {
      for (const f of msFiles) for (const line of readFileSync(f, "utf8").split("\n")) { const m = /"imdb_id":\s*"(tt\d+)"/.exec(line.slice(0, 400)); if (m) ids.add(m[1]!); }
    }
    log(`imdb: loading ${ids.size} ids`);
    return loadImdb(imdbFile, ids);
  })() : new Map();

  // ---- stage texts ---------------------------------------------------------------------------------------------------
  if (want.has("plays")) {
    const { sources } = loadCorpus(cfg.corpus);
    let k = 0;
    for (const s of sources) {
      if (++k > lim("plays")) break;
      const stem = s.meta.file.replace(/\.[^.]+$/, "");
      const info: SourceInfo = { id: s.id, title: s.meta.title, lang: s.meta.language === "pt" ? "pt" : "en", medium: "stage", genre: PLAY_GENRE[stem] ?? "other", era: "classic", form: "play", timeSource: "estimated" };
      const scenes = playToScenes(scenesOf(s), s.id);
      const fs = measureAll(scenes, info, emit, stats, undefined, cfg.onScene);
      done("plays", { id: s.id, lang: info.lang, medium: "stage", form: "play", genre: info.genre, title: s.meta.title, scenes: 0 }, fs, info);
    }
    log(`plays: ${stats.byGroup["plays"]?.sources ?? 0} sources`);
  }

  // ---- screenplays (MovieSum) -----------------------------------------------------------------------------------------
  if (want.has("moviesum")) {
    let k = 0;
    outer: for (const f of msFiles) {
      const rl = createInterface({ input: createReadStream(f), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        if (++k > lim("moviesum")) { rl.close(); break outer; }
        const rec = JSON.parse(line) as { movie_name: string; imdb_id: string; script: string };
        const row = imdb.get(rec.imdb_id);
        const year = row?.year ?? Number(/_(\d{4})$/.exec(rec.movie_name)?.[1] ?? NaN);
        const { scenes, dropped, garbled } = parseMovieSum(rec.script, `moviesum/${rec.imdb_id}`);
        if (garbled) stats.skipped["moviesum: garbled scenes (scene numbers as cues)"] = (stats.skipped["moviesum: garbled scenes (scene numbers as cues)"] ?? 0) + garbled;
        if (dropped) stats.skipped["moviesum: scenes over 300 turns"] = (stats.skipped["moviesum: scenes over 300 turns"] ?? 0) + dropped;
        const runtime = row?.runtimeMin ?? null;
        const info: SourceInfo = {
          id: `moviesum/${rec.imdb_id}`, title: rec.movie_name, lang: "en", medium: "film", genre: row ? genreBucket(row.genres) : "other", era: year >= 1930 ? "modern" : "classic", form: "screenplay",
          timeSource: runtime && runtime >= 60 && runtime <= 240 ? "runtime" : "estimated", ...(runtime ? { runtimeMin: runtime } : {}), imdbId: rec.imdb_id,
        };
        const totalSec = info.timeSource === "runtime" ? runtime! * 60 : undefined;
        if (totalSec !== undefined) { const est = scenes.reduce((a, s) => a + estimateSceneSec(s.events), 0); if (est > 0) stats.runtimeRatio.push(totalSec / est); }
        const fs = measureAll(scenes, info, emit, stats, totalSec, cfg.onScene);
        done("moviesum", { id: info.id, lang: "en", medium: "film", form: "screenplay", genre: info.genre, imdb: rec.imdb_id, title: rec.movie_name, scenes: 0 }, fs, info);
        if (k % 200 === 0) log(`moviesum: ${k}`);
      }
    }
  }

  // ---- TV transcripts -------------------------------------------------------------------------------------------------
  if (want.has("summscreen")) {
    let k = 0;
    for (const split of ["fd_train", "fd_dev", "fd_test"]) {
      const file = path.join(cfg.cinema, "summscreen", `${split}.json`);
      if (!existsSync(file)) continue;
      const eps = JSON.parse(readFileSync(file, "utf8")) as Array<{ "File Name": string; Transcript: string[] }>;
      for (const ep of eps) {
        if (++k > lim("summscreen")) break;
        const name = ep["File Name"];
        const show = showOf(name);
        const info: SourceInfo = { id: `summscreen/${name.replace(/\.json$/, "")}`, title: show, lang: "en", medium: "series", genre: SHOW_GENRE[show] ?? "other", era: show === "Doctor_Who_1963" ? "classic" : "modern", form: "transcript", timeSource: "estimated" };
        const fs = measureAll(parseSummScreen(ep.Transcript, info.id), info, emit, stats, undefined, cfg.onScene);
        done("summscreen", { id: info.id, lang: "en", medium: "series", form: "transcript", genre: info.genre, title: show, scenes: 0 }, fs, info);
      }
      log(`summscreen: ${split} done (${k})`);
    }
  }

  // ---- soap-opera transcripts (TVMegaSite part of SummScreen): scene breaks are marked in the source -------------------------
  if (want.has("tms")) {
    let k = 0;
    for (const [split, every] of [["tms_dev", 1], ["tms_test", 1], ["tms_train", 6]] as const) {
      const file = path.join(cfg.cinema, "summscreen", `${split}.jsonl`);
      if (!existsSync(file)) continue;
      const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
      let row = 0;
      for await (const line of rl) {
        if (!line.trim() || row++ % every !== 0) continue;
        if (++k > lim("tms")) break;
        const ep = JSON.parse(line) as { "File Name": string; Transcript: string[] };
        const name = ep["File Name"].replace(/\.json$/, "");
        const show = name.split("-")[0]!;
        const info: SourceInfo = { id: `tms/${name}`, title: show, lang: "en", medium: "series", genre: "melodrama", era: "modern", form: "transcript", timeSource: "estimated" };
        const fs = measureAll(parseSummScreen(ep.Transcript, info.id), info, emit, stats, undefined, cfg.onScene);
        done("tms", { id: info.id, lang: "en", medium: "series", form: "transcript", genre: "melodrama", title: show, scenes: 0 }, fs, info);
      }
      log(`tms: ${split} done (${k})`);
    }
  }

  // ---- extra screenplays (pdftotext -layout text of public scripts) ----------------------------------------------------
  if (want.has("extra")) {
    const dir = path.join(cfg.cinema, "br-scripts");
    const man = path.join(dir, "manifest.json");
    if (existsSync(man)) {
      const entries = JSON.parse(readFileSync(man, "utf8")) as Array<{ file: string; title: string; lang: "pt" | "en"; medium: "film" | "series"; genre: CineGenre; license_line?: string; source_url?: string }>;
      for (const e of entries) {
        if (!e.license_line || !e.source_url) { skip("extra: no licence line"); continue; }
        const info: SourceInfo = { id: `extra/${e.file.replace(/\.[^.]+$/, "")}`, title: e.title, lang: e.lang, medium: e.medium, genre: e.genre, era: "modern", form: "screenplay", timeSource: "estimated" };
        const fs = measureAll(parseLayoutScreenplay(readFileSync(path.join(dir, e.file), "utf8"), info.id), info, emit, stats, undefined, cfg.onScene);
        done("extra", { id: info.id, lang: e.lang, medium: e.medium, form: "screenplay", genre: e.genre, title: e.title, scenes: 0 }, fs, info);
      }
    }
  }

  // ---- subtitles ---------------------------------------------------------------------------------------------------------
  const seenByLang = { pt: new Set<string>(), en: new Set<string>() };
  for (const g of ["opus-ptbr-native", "opus-ptbr", "opus-en"] as const) {
    if (!want.has(g)) continue;
    const lang = g === "opus-en" ? "en" : "pt";
    const seen = seenByLang[lang];
    let k = 0;
    for (const f of subFiles[g]!) {
      if (k >= lim(g)) break;
      const [, yearS, imdbN] = f.replace(/\.xml$/, "").split("__");
      const key = imdbKey(imdbN!);
      const row = imdb.get(key);
      if (!row) { skip(`${g}: not in IMDb basics`); continue; }
      if (seen.has(key)) { skip(`${g}: second file for a title`); continue; }
      const film = ["movie", "tvMovie", "video"].includes(row.type);
      const series = ["tvEpisode", "tvSeries", "tvMiniSeries"].includes(row.type);
      if (!film && !series) { skip(`${g}: type ${row.type}`); continue; }
      const cues = parseOpusXml(readFileSync(path.join(cfg.cinema, g, f), "utf8"));
      const q = subtitleQuality(cues);
      if (!q.ok) { skip(`${g}: ${q.reason}`); continue; }
      if (row.runtimeMin && (q.spanSec / 60 < row.runtimeMin * 0.4 || q.spanSec / 60 > row.runtimeMin * 1.15)) { skip(`${g}: span does not match runtime`); continue; }
      seen.add(key);
      const year = row.year ?? Number(yearS);
      const info: SourceInfo = { id: `${g}/${imdbN}/${f.split("__")[3]!.replace(".xml", "")}`, title: key, lang, medium: film ? "film" : "series", genre: genreBucket(row.genres), era: year >= 1930 ? "modern" : "classic", form: "subtitle", timeSource: "subtitle", ...(row.runtimeMin ? { runtimeMin: row.runtimeMin } : {}), imdbId: key, ...(lang === "pt" ? { native: nativeIds.has(String(Number(imdbN))) } : {}) };
      const fs = measureAll(cuesToScenes(cues, info.id), info, emit, stats, undefined, cfg.onScene);
      k += 1;
      done(g, { id: info.id, lang, medium: info.medium, form: "subtitle", genre: info.genre, imdb: key, scenes: 0, note: `year ${year}${info.native ? ", Brazilian original" : ""}` }, fs, info, cueGapStats(cues, q.spanSec));
      if (k % 200 === 0) log(`${g}: ${k}`);
    }
  }
  return { stats, provenance: prov };
}

export type { CineGenre };

/** Talk share and long-silence rates over every cue pair of a subtitle file, ignoring the scene cut. */
export function cueGapStats(cues: ReadonlyArray<{ t0: number; t1: number }>, spanSec: number): Partial<SourceStats> {
  let talk = 0, cover = -Infinity, g2 = 0, g5 = 0, g12 = 0;
  cues.forEach((c, i) => {
    if (i > 0) { const g = c.t0 - Math.max(cover, cues[i - 1]!.t1); if (g > 2) g2 += 1; if (g > 5) g5 += 1; if (g > 12) g12 += 1; }
    const from = Math.max(c.t0, cover);
    if (c.t1 > from) talk += c.t1 - from;
    cover = Math.max(cover, c.t1);
  });
  const min = spanSec / 60;
  const r = (x: number): number => Math.round(x * 1e4) / 1e4;
  return { talkShare: r(Math.min(1, talk / spanSec)), gaps2PerMin: r(g2 / min), gaps5PerMin: r(g5 / min), gaps12PerMin: r(g12 / min) };
}
