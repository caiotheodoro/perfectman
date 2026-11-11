import { isAccusation, isCommitment, isReveal, joinedKeys, wordsOf } from "../script-likeness/text.js";
import { affectActHits, flat, hardActHits, mildHits, pauseHits, softActHits, strongHits } from "./lexicon.js";
import type { CineEvent, CineScene, SceneFeatures, SourceInfo } from "./scene-types.js";

/** Reading-rate model for scenes that have no cue times; checked against the subtitle scenes in the norms' `calibration`. */
export const EST = { speechWps: 2.7, turnPad: 0.45, dirWps: 3.5, dirPad: 1.2 } as const;
export const CURVE_BINS = 10;
export const LEN_BINS = [1, 2, 3, 4, 5, 7, 10, 15, 25, 40] as const; // upper edges; the last bin is 41+
export const REVERSAL_SWING = 0.12;
export const MIN_ARC_EVENTS = 8;
export const ARC_MIN_PEAK = 0.15;
export const ARC_MIN_RISE = 0.08;

const wc = (text: string): number => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}
const median = (xs: readonly number[]): number => percentile([...xs].sort((a, b) => a - b), 0.5);

export const estSpeechSec = (words: number): number => EST.turnPad + words / EST.speechWps;
export const estDirSec = (words: number): number => EST.dirPad + words / EST.dirWps;

/** Estimated seconds of a whole scene from its text alone. */
export function estimateSceneSec(events: readonly CineEvent[]): number {
  let s = 0;
  for (const e of events) s += e.kind === "speech" ? estSpeechSec(wc(e.text)) : estDirSec(wc(e.text));
  return s;
}

/** Conflict intensity of one spoken turn in [0, 1]: hostile words, shouting, cut-off lines. A proxy, not a judgement. */
export function turnIntensity(text: string, lang: SourceInfo["lang"]): number {
  const f = flat(text);
  const strong = strongHits(f, lang);
  const mild = mildHits(f, lang);
  const excl = (text.match(/!/g) ?? []).length;
  const caps = text.split(/\s+/).filter((w) => w.replace(/[^\p{L}]/gu, "").length >= 3);
  const shout = caps.length === 0 ? 0 : caps.filter((w) => w === w.toUpperCase() && /\p{Lu}/u.test(w)).length / caps.length;
  const cut = /(?:--|[-–—])\s*["')\]]?\s*$/u.test(text.trim()) ? 1 : 0;
  const v = 0.3 * (Math.min(strong, 2) / 2) + 0.1 * (Math.min(mild, 2) / 2) + 0.2 * (Math.min(excl, 3) / 3) + 0.12 * shout * (excl > 0 ? 1 : 0.25) + 0.08 * cut;
  return Math.min(0.7, clamp01(v / 0.5));
}

/** Intensity of an action line: a hard physical act is the strongest thing a direction can carry. */
export function directionIntensity(text: string, lang: SourceInfo["lang"]): { v: number; hard: number; soft: number; pause: boolean } {
  const f = flat(text);
  const violent = hardActHits(f, lang);
  const affect = affectActHits(f, lang);
  const hard = violent + affect; // both are physical beats for the act count; only violence is conflict
  const soft = softActHits(f, lang);
  const strong = strongHits(f, lang);
  const pause = pauseHits(f, lang) > 0;
  const v = violent > 0 ? Math.min(1, 0.85 + 0.07 * Math.min(violent - 1, 2) + 0.05 * Math.min(strong, 2)) : affect > 0 ? 0.4 : Math.min(0.3, 0.05 + 0.08 * Math.min(strong, 2));
  return { v, hard, soft, pause };
}

/** Triangular smoothing over neighbouring events. */
export function smooth(xs: readonly number[], radius = 2): number[] {
  return xs.map((_, i) => {
    let num = 0;
    let den = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(xs.length - 1, i + radius); j++) {
      const w = radius + 1 - Math.abs(i - j);
      num += w * xs[j]!;
      den += w;
    }
    return num / den;
  });
}

/** Direction changes of a series whose swing is at least `swing` (zig-zag). The count is segments minus one: a rise then a fall is one reversal. */
export function countReversals(series: readonly number[], swing = REVERSAL_SWING): number {
  if (series.length < 3) return 0;
  let lo = series[0]!, hi = series[0]!;
  let dir = 0;
  let ext = 0;
  let segments = 0;
  for (const x of series) {
    if (dir === 0) {
      lo = Math.min(lo, x); hi = Math.max(hi, x);
      if (x - lo >= swing) { dir = 1; ext = x; segments = 1; }
      else if (hi - x >= swing) { dir = -1; ext = x; segments = 1; }
    } else if (dir === 1) {
      if (x > ext) ext = x;
      else if (ext - x >= swing) { dir = -1; ext = x; segments += 1; }
    } else if (x < ext) ext = x;
    else if (x - ext >= swing) { dir = 1; ext = x; segments += 1; }
  }
  return Math.max(0, segments - 1);
}

function lenBin(w: number): number {
  for (let i = 0; i < LEN_BINS.length; i++) if (w <= LEN_BINS[i]!) return i;
  return LEN_BINS.length;
}

const TRAIL_CUT = /(?:--|[-–—])\s*["')\]]?\s*$/u;
const TRAIL_OFF = /(?:\.{2,}|…)\s*["')\]]?\s*$/u;
const SILENT = /^[\s.…\-–—*]*$/u;

export type MeasureOptions = {
  /** Seconds to credit the scene when it has no cue times (runtime share or estimate). */
  durSec: number;
};

/** One scene in, its features out. Returns null when the scene has too few spoken turns to say anything. */
export function measureScene(scene: CineScene, info: SourceInfo, opts: MeasureOptions, minTurns = 3): SceneFeatures | null {
  const ev = scene.events;
  const lang = info.lang;
  const speeches = ev.filter((e): e is Extract<CineEvent, { kind: "speech" }> => e.kind === "speech");
  if (speeches.length < minTurns) return null;
  const hasDirections = info.timeSource !== "subtitle";

  // --- per-event time axis -------------------------------------------------------------------------------------
  const timed = info.timeSource === "subtitle" || info.timeSource === "clock";
  const t0s: number[] = [];
  const t1s: number[] = [];
  if (timed) {
    const base = ev.find((e) => e.t0 !== undefined)?.t0 ?? 0;
    for (const e of ev) {
      if (e.t0 === undefined) { const prev = t1s.length ? t1s[t1s.length - 1]! : 0; t0s.push(prev); t1s.push(prev); continue; }
      // a clock-timed event with no end (a run's chat line or act) lasts as long as the reading-rate model says
      const end = e.kind === "speech" ? e.t1 ?? e.t0 + estSpeechSec(wc(e.text)) : e.t0 + (info.timeSource === "clock" ? estDirSec(wc(e.text)) : 0);
      t0s.push(e.t0 - base); t1s.push(end - base);
    }
  } else {
    const secs = ev.map((e) => (e.kind === "speech" ? estSpeechSec(wc(e.text)) : estDirSec(wc(e.text))));
    const total = secs.reduce((a, b) => a + b, 0) || 1;
    const k = opts.durSec / total;
    let t = 0;
    for (const s of secs) { t0s.push(t); t += s * k; t1s.push(t); }
  }
  const durSec = timed ? Math.max(...t1s, 1) : opts.durSec;
  const mid = ev.map((_, i) => ((t0s[i]! + t1s[i]!) / 2) / durSec);

  // --- turn statistics ---------------------------------------------------------------------------------------------
  const lens = speeches.map((s) => wc(s.text));
  const sorted = [...lens].sort((a, b) => a - b);
  const n = speeches.length;
  const lenHist = new Array<number>(LEN_BINS.length + 1).fill(0);
  for (const w of lens) lenHist[lenBin(Math.max(1, w))]! += 1;
  let interrupt = 0, ellipsis = 0, silent = 0;
  for (const s of speeches) {
    const t = s.text.trim();
    if (SILENT.test(t)) silent += 1;
    else if (TRAIL_CUT.test(t)) interrupt += 1;
    else if (TRAIL_OFF.test(t)) ellipsis += 1;
  }

  // --- directions and acts -----------------------------------------------------------------------------------------
  let dirCount = 0, dirWords = 0, hardActs = 0, softActs = 0, pauseDirs = 0;
  const intensity: number[] = [];
  const gapTurns: number[] = [];
  let sinceDir = 0, seenDir = false;
  const dirMeta = new Map<number, ReturnType<typeof directionIntensity>>();
  ev.forEach((e, i) => {
    if (e.kind === "direction") {
      const d = directionIntensity(e.text, lang);
      dirMeta.set(i, d);
      intensity.push(d.v);
      if (!e.parenthetical) { dirCount += 1; hardActs += d.hard > 0 ? 1 : 0; softActs += d.soft > 0 && d.hard === 0 ? 1 : 0; dirWords += wc(e.text); }
      if (d.pause) pauseDirs += 1;
      if (seenDir) gapTurns.push(sinceDir);
      seenDir = true; sinceDir = 0;
    } else {
      intensity.push(turnIntensity(e.text, lang));
      sinceDir += 1;
    }
  });
  const speechWords = lens.reduce((a, b) => a + b, 0);

  // --- speech acts -----------------------------------------------------------------------------------------------
  let reveals = 0, accusations = 0, commitments = 0;
  const eventAt: boolean[] = [];
  ev.forEach((e, i) => {
    if (e.kind !== "speech") { eventAt.push(false); return; }
    const j = joinedKeys(wordsOf(e.text));
    const r = isReveal(j), a = isAccusation(j), c = isCommitment(j);
    reveals += r ? 1 : 0; accusations += a ? 1 : 0; commitments += c ? 1 : 0;
    const near = [ev[i - 1], ev[i + 1]].some((x, k) => x && x.kind === "direction" && (dirMeta.get(i + (k === 0 ? -1 : 1))?.hard ?? 0) > 0);
    eventAt.push(r || a || c || near);
  });
  let quiet = 0;
  {
    let run = 0;
    ev.forEach((e, i) => {
      if (e.kind !== "speech") return;
      if (eventAt[i]) run = 0; else { run += 1; if (run > quiet) quiet = run; }
    });
  }

  // --- arc ---------------------------------------------------------------------------------------------------------
  const sm = smooth(intensity, 2); // curve and reversals
  const sa = smooth(intensity, 1); // peak, inciting beat, aftermath: a single hard act must not be averaged away
  const enough = ev.length >= MIN_ARC_EVENTS;
  const head = Math.max(2, Math.round(ev.length * 0.2));
  const baseline = sa.slice(0, head).reduce((a, b) => a + b, 0) / head;
  let peak = 0, peakAt = 0;
  sa.forEach((v) => { if (v > peak) peak = v; });
  // a plateau peaks at its middle point
  { const near: number[] = []; sa.forEach((v, i) => { if (v >= peak - 0.02) near.push(i); }); peakAt = near[Math.floor((near.length - 1) / 2)] ?? 0; }
  const rise = peak - baseline;
  const curve: number[] = [];
  {
    let last = sm[0] ?? 0;
    for (let b = 0; b < CURVE_BINS; b++) {
      const vals: number[] = [];
      sm.forEach((v, i) => { if (mid[i]! >= b / CURVE_BINS && (mid[i]! < (b + 1) / CURVE_BINS || (b === CURVE_BINS - 1 && mid[i]! <= 1))) vals.push(v); });
      last = vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : last;
      curve.push(last);
    }
  }
  const arcOk = enough && peak >= ARC_MIN_PEAK && rise >= ARC_MIN_RISE;
  let tInciting: number | null = null, tClimax: number | null = null, aftermath: number | null = null;
  if (arcOk) {
    tClimax = mid[peakAt]!;
    const thr = baseline + 0.4 * rise;
    const iInc = sa.findIndex((v, i) => i <= peakAt && v >= thr);
    tInciting = mid[iInc < 0 ? peakAt : iInc]!;
    const hi = baseline + 0.7 * rise;
    let lastHigh = peakAt;
    sa.forEach((v, i) => { if (v >= hi) lastHigh = i; });
    aftermath = clamp01(1 - mid[lastHigh]!);
  }
  const reversals = enough ? countReversals(sm) : 0;

  // --- role flip (who asks, who answers) ---------------------------------------------------------------------------
  let roleFlip: boolean | null = null;
  const names = new Map<string, number>();
  speeches.forEach((s) => { if (s.speaker) names.set(s.speaker, (names.get(s.speaker) ?? 0) + 1); });
  if (names.size >= 2 && n >= 12) {
    const top = [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]);
    const third = Math.floor(n / 3);
    const qBy = (from: number, to: number): [number, number] => {
      const q: [number, number] = [0, 0];
      speeches.slice(from, to).forEach((s) => { const k = top.indexOf(s.speaker ?? ""); if (k >= 0 && s.text.includes("?")) q[k]! += 1; });
      return q;
    };
    const a = qBy(0, third), b = qBy(n - third, n);
    if (a[0] + a[1] >= 2 && b[0] + b[1] >= 2 && Math.abs(a[0] - a[1]) >= 1 && Math.abs(b[0] - b[1]) >= 1) roleFlip = a[0] > a[1] !== b[0] > b[1];
  }

  // --- timed features ----------------------------------------------------------------------------------------------
  let rapidShare: number | null = null, overlapShare: number | null = null, silenceShare: number | null = null, gaps2: number | null = null, medGap: number | null = null, longestGap: number | null = null, wps: number | null = null;
  if (timed) {
    const sp = speeches.filter((s) => s.t0 !== undefined).map((s) => ({ ...s, t1: s.t1 ?? s.t0! + estSpeechSec(wc(s.text)) })).sort((a, b) => a.t0! - b.t0!);
    let overlaps = 0, rapid = 0, talk = 0, cover = -Infinity;
    const gaps: number[] = [];
    sp.forEach((s, i) => {
      if (i > 0) {
        if (s.t0! < sp[i - 1]!.t1! - 0.05) overlaps += 1;
        if (s.t0! - sp[i - 1]!.t1! < 0.25) rapid += 1;
        const g = s.t0! - Math.max(cover, sp[i - 1]!.t1!);
        if (g > 0) gaps.push(g);
      }
      const from = Math.max(s.t0!, cover);
      if (s.t1! > from) talk += s.t1! - from;
      cover = Math.max(cover, s.t1!);
    });
    const span = sp.length ? sp[sp.length - 1]!.t1! - sp[0]!.t0! : 0;
    if (span > 0 && sp.length > 1) {
      overlapShare = overlaps / (sp.length - 1);
      rapidShare = rapid / (sp.length - 1);
      silenceShare = clamp01(1 - talk / span);
      gaps2 = gaps.filter((g) => g > 2).length / (span / 60);
      medGap = gaps.length ? median(gaps) : 0;
      longestGap = gaps.length ? Math.max(...gaps) / span : 0;
      wps = speechWords / Math.max(1, talk);
    }
  }
  const minutes = durSec / 60;
  const f = (x: number): number => Math.round(x * 1e4) / 1e4;
  return {
    src: scene.sourceId, lang, medium: info.medium, genre: info.genre, era: info.era, form: info.form, native: info.native ?? false, timeSource: info.timeSource,
    turns: n, directions: dirCount, hasDirections, speechWords, dirWords, durSec: f(durSec),
    wordsP50: percentile(sorted, 0.5), wordsP90: percentile(sorted, 0.9),
    shortShare: lens.filter((w) => w <= 5).length / n, microShare: lens.filter((w) => w <= 2).length / n, longShare: lens.filter((w) => w > 25).length / n, lenHist,
    interruptShare: interrupt / n, ellipsisShare: ellipsis / n, silentTurnShare: silent / n, pauseMarkersPer100: ((pauseDirs + silent) / n) * 100,
    overlapShare, rapidShare, silenceShare, gapsOver2sPerMin: gaps2, medianGapSec: medGap, longestGapFrac: longestGap, wordsPerSec: wps,
    turnsPerMin: n / Math.max(minutes, 1 / 60),
    dirPerTurn: hasDirections ? dirCount / n : null, dirPerMin: hasDirections ? dirCount / Math.max(minutes, 1 / 60) : null,
    actsPerMin: hasDirections ? (hardActs + softActs) / Math.max(minutes, 1 / 60) : null,
    hardActs: hasDirections ? hardActs : null, softActs: hasDirections ? softActs : null,
    dialogueShare: hasDirections ? speechWords / Math.max(1, speechWords + dirWords) : null,
    directionGapP50: hasDirections && gapTurns.length ? median(gapTurns) : null,
    curve: curve.map(f), peak: f(peak), baseline: f(baseline), peakRise: f(rise), tInciting: tInciting === null ? null : f(tInciting), tClimax: tClimax === null ? null : f(tClimax),
    aftermathShare: aftermath === null ? null : f(aftermath), reversals, roleFlip, reveals, accusations, commitments,
    eventsPer10: ((reveals + accusations + commitments + hardActs + reversals) / n) * 10, longestQuietFrac: quiet / n,
  };
}
