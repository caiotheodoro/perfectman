import type { HumanTrace, TraceEvent } from "./trace.js";
import { Timeline, bearing, chebyshev, dirDiffDeg } from "./trace.js";

/** Tuning of the metrics themselves (not of the behaviour): windows and thresholds, all priors. */
export const MEASURE = {
  /** Gaze: the speaker should face the addressee by this long after the line lands; the listener by `listenerMs`. */
  speakerGazeMs: 1500,
  listenerGazeMs: 2500,
  gazeToleranceDeg: 45,
  /** A break: the speaker faces 90 degrees or more off the addressee at some sample in this window, and is back within `returnMs`. */
  breakWindowMs: 3000,
  returnMs: 5000,
  /** A reply is matched to a line if it follows within this long. */
  replyWithinMs: 25_000,
  /** A line stays "on screen" for its reading time: this many ms per word, at least `holdMinMs`. */
  holdPerWordMs: 400,
  holdMinMs: 1500,
  /** Backchannel: a non-verbal signal from a listener in this window after a line of at least `backchannelMinWords`. */
  backchannelFromMs: 300,
  backchannelToMs: 3500,
  backchannelMinWords: 5,
  /** A gesture belongs to a line if it starts in [-before, +after] around it. */
  gestureBeforeMs: 500,
  gestureAfterMs: 4000,
  /** Stacked: two avatars on one tile for at least this long (sampled every `sampleMs`). */
  stackMinMs: 1000,
  sampleMs: 250,
  /** Idle: nobody has spoken to or as the actor for this long. */
  engagedMs: 12_000,
  /** Frozen: a window of this length in which an avatar changes nothing the viewer can see. */
  frozenWindowMs: 10_000,
  /** A pacing reversal: a walk that ends within one tile of where the previous walk began, within this long of it. */
  reversalMs: 15_000,
  /** Distance bands, Chebyshev tiles (embodiment.md 2). */
  intimateMax: 1,
  personalMax: 2,
  socialMax: 6,
  /** The hotel's clear-hearing radius with a margin. */
  earshotMax: 5,
} as const;

export type Quantiles = { n: number; p25: number | null; p50: number | null; p75: number | null; mean: number | null };

export type HumanlikeMetrics = {
  run: string;
  source: "run" | "sim";
  arm?: string;
  durationS: number;
  cast: number;
  lines: number;
  addressedLines: number;
  distance: {
    n: number;
    hist: Record<string, number>;
    bandShare: { intimate: number; personal: number; social: number; public: number } | null;
    inEarshotShare: number | null;
    conversationalShare: number | null;
    median: number | null;
    p90: number | null;
    sameTile: number;
  };
  stacking: { events: number; ms: number; perActorHour: number };
  gaze: { n: number; speakerRate: number | null; listenerRate: number | null; mutualRate: number | null; breakReturnRate: number | null };
  latency: { startTyping: Quantiles; lineToLine: Quantiles; overlapStarts: number };
  overlap: { n: number; rate: number | null };
  interruption: { n: number; rate: number | null };
  typing: { lines: number; medianMs: number | null; medianMsPer100Chars: number | null; lengthCorrelation: number | null; togglesPerLine: number | null };
  gesture: { perLine: number | null; perActorMin: number; byKind: Record<string, number> };
  backchannel: { n: number; rate: number | null };
  idle: { motionPerActorMin: number; frozenShare: number | null; reversalsPerActorHour: number };
  walks: { total: number; perActorMin: number };
  expression: { changesPerActorMin: number };
};

const round = (n: number, d = 3): number => Math.round(n * 10 ** d) / 10 ** d;

export function quantiles(values: readonly number[]): Quantiles {
  if (values.length === 0) return { n: 0, p25: null, p50: null, p75: null, mean: null };
  const v = [...values].sort((a, b) => a - b);
  const q = (p: number): number => {
    const i = (v.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return v[lo]! + (v[hi]! - v[lo]!) * (i - lo);
  };
  return { n: v.length, p25: round(q(0.25), 1), p50: round(q(0.5), 1), p75: round(q(0.75), 1), mean: round(v.reduce((s, x) => s + x, 0) / v.length, 1) };
}

function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 4) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? null : round(sxy / Math.sqrt(sxx * syy));
}

const words = (text: string): number => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const rate = (num: number, den: number): number | null => (den === 0 ? null : round(num / den));

type Chat = Extract<TraceEvent, { kind: "chat" }>;

/** Every metric of the plan's item 7, from one trace. */
export function computeHumanlike(trace: HumanTrace): HumanlikeMetrics {
  const M = MEASURE;
  const tl = new Timeline(trace.events);
  const cast = trace.actors.filter((a) => !a.human).map((a) => a.ref);
  const isCast = new Set(cast);
  const start = trace.sceneStartMs;
  const end = start + trace.durationMs;
  const minutes = Math.max(trace.durationMs / 60_000, 1 / 60);
  const actorMinutes = Math.max(cast.length, 1) * minutes;
  const chats = trace.events.filter((e): e is Chat => e.kind === "chat" && e.mode !== "thought" && e.t >= start - 1);
  const lines = chats.filter((c) => words(c.text) > 0);
  const addressed = lines.filter((c) => c.to !== undefined && c.to !== c.ref);

  // ---- distance at the moment a line is said ----
  const dists: number[] = [];
  let sameTile = 0;
  const hist: Record<string, number> = {};
  for (const l of addressed) {
    const a = tl.at(l.ref, l.t);
    const b = tl.at(l.to!, l.t);
    if (!a || !b) continue;
    const d = chebyshev(a.tile, b.tile);
    dists.push(d);
    if (d === 0) sameTile++;
    const k = d >= 12 ? "12+" : String(d);
    hist[k] = (hist[k] ?? 0) + 1;
  }
  const dq = quantiles(dists);
  const dN = dists.length;
  const share = (pred: (d: number) => boolean): number | null => rate(dists.filter(pred).length, dN);
  const p90 = dN === 0 ? null : [...dists].sort((a, b) => a - b)[Math.min(dN - 1, Math.floor(dN * 0.9))]!;

  // ---- stacking: two avatars on one tile for a second or more ----
  let stackEvents = 0;
  let stackMs = 0;
  {
    const run = new Map<string, number>();
    const stackedAt = (t: number): Set<string> => {
      const seen = new Map<string, string>();
      const hit = new Set<string>();
      for (const ref of tl.refs()) {
        const p = tl.at(ref, t);
        if (!p || p.state === "gone") continue;
        const k = `${p.tile[0]},${p.tile[1]}`;
        const other = seen.get(k);
        if (other !== undefined) hit.add([other, ref].sort().join("|"));
        else seen.set(k, ref);
      }
      return hit;
    };
    for (let t = start; t <= end; t += M.sampleMs) {
      const now = stackedAt(t);
      for (const pair of now) run.set(pair, (run.get(pair) ?? 0) + M.sampleMs);
      for (const [pair, ms] of [...run]) {
        if (now.has(pair)) continue;
        if (ms >= M.stackMinMs) {
          stackEvents++;
          stackMs += ms;
        }
        run.delete(pair);
      }
    }
    for (const ms of run.values()) {
      if (ms >= M.stackMinMs) {
        stackEvents++;
        stackMs += ms;
      }
    }
  }

  // ---- gaze ----
  let gazeN = 0;
  let speakerOk = 0;
  let listenerOk = 0;
  let mutualOk = 0;
  let breaks = 0;
  for (const l of addressed) {
    const sp = tl.at(l.ref, l.t + M.speakerGazeMs);
    const ls = tl.at(l.to!, l.t + M.listenerGazeMs);
    const sp0 = tl.at(l.ref, l.t);
    const ls0 = tl.at(l.to!, l.t);
    if (!sp || !ls || !sp0 || !ls0) continue;
    if (chebyshev(sp0.tile, ls0.tile) > 12) continue;
    gazeN++;
    const sFace = dirDiffDeg(sp.dir, bearing(sp.tile, tl.at(l.to!, l.t + M.speakerGazeMs)?.tile ?? ls0.tile)) <= M.gazeToleranceDeg;
    const lFace = dirDiffDeg(ls.dir, bearing(ls.tile, tl.at(l.ref, l.t + M.listenerGazeMs)?.tile ?? sp0.tile)) <= M.gazeToleranceDeg;
    if (sFace) speakerOk++;
    if (lFace) listenerOk++;
    if (sFace && lFace) mutualOk++;
    // A break and a return: the speaker looks 90 degrees or more away inside the window, and is facing again by the end of the return window.
    const track = tl.between(l.ref, l.t, l.t + M.breakWindowMs);
    const away = track.some((p) => dirDiffDeg(p.dir, bearing(p.tile, ls0.tile)) >= 90);
    const back = tl.at(l.ref, l.t + M.returnMs);
    if (away && back && dirDiffDeg(back.dir, bearing(back.tile, ls0.tile)) <= M.gazeToleranceDeg) breaks++;
  }

  // ---- reaction latency: from a line to the reply's first key press ----
  const latStart: number[] = [];
  const latLine: number[] = [];
  let overlapStarts = 0;
  const typingOn = trace.events.filter((e): e is Extract<TraceEvent, { kind: "typing" }> => e.kind === "typing" && e.on);
  for (const l of addressed) {
    if (!isCast.has(l.to!)) continue;
    const reply = lines.find((r) => r.ref === l.to && r.t > l.t && r.t - l.t <= M.replyWithinMs);
    if (!reply) continue;
    latLine.push(reply.t - l.t);
    const on = [...typingOn].reverse().find((e) => e.ref === reply.ref && e.t <= reply.t && e.t >= l.t - 8000);
    if (on) {
      if (on.t >= l.t) latStart.push(on.t - l.t);
      else overlapStarts++;
    }
  }

  // ---- overlap and interruption ----
  let overlaps = 0;
  let interrupted = 0;
  const hold = (c: Chat): number => Math.max(M.holdMinMs, words(c.text) * M.holdPerWordMs);
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    if (prev && prev.ref !== l.ref && l.t < prev.t + hold(prev)) overlaps++;
    if (/[—–]\s*$|\w-\s*$/.test(l.text.trim())) interrupted++;
  });

  // ---- typing: bubble time against the length of the line ----
  const typeMs: number[] = [];
  const typeChars: number[] = [];
  let toggles = 0;
  for (const l of lines) {
    if (!isCast.has(l.ref)) continue;
    const evs = trace.events.filter((e): e is Extract<TraceEvent, { kind: "typing" }> => e.kind === "typing" && e.ref === l.ref && e.t <= l.t && e.t >= l.t - 30_000);
    // The run of typing events since this actor's previous line.
    const prevLine = [...lines].reverse().find((p) => p.ref === l.ref && p.t < l.t);
    const since = evs.filter((e) => !prevLine || e.t > prevLine.t);
    const firstOn = since.find((e) => e.on);
    if (!firstOn) continue;
    typeMs.push(l.t - firstOn.t);
    typeChars.push(l.text.length);
    toggles += since.filter((e) => !e.on).length;
  }
  const typeQ = quantiles(typeMs);
  const per100 = typeMs.length === 0 ? null : quantiles(typeMs.map((ms, i) => (ms / Math.max(typeChars[i]!, 1)) * 100)).p50;

  // ---- gestures per line, backchannel ----
  const gestures = trace.events.filter((e): e is Extract<TraceEvent, { kind: "gesture" }> => e.kind === "gesture");
  const byKind: Record<string, number> = {};
  for (const g of gestures) byKind[g.a] = (byKind[g.a] ?? 0) + 1;
  const castLines = lines.filter((l) => isCast.has(l.ref));
  const withGesture = castLines.filter((l) => gestures.some((g) => g.ref === l.ref && g.t >= l.t - M.gestureBeforeMs && g.t <= l.t + M.gestureAfterMs)).length;
  const faces = trace.events.filter((e): e is Extract<TraceEvent, { kind: "expression" }> => e.kind === "expression");

  let bcN = 0;
  let bcOk = 0;
  for (const l of lines) {
    if (words(l.text) < M.backchannelMinWords) continue;
    const listeners = l.to !== undefined && isCast.has(l.to) ? [l.to] : [];
    if (listeners.length === 0) continue;
    bcN++;
    const ok = listeners.some((ref) => {
      const lo = l.t + M.backchannelFromMs;
      const hi = l.t + M.backchannelToMs;
      if (faces.some((f) => f.ref === ref && f.t >= lo && f.t <= hi)) return true;
      if (gestures.some((g) => g.ref === ref && g.t >= lo && g.t <= hi)) return true;
      // A head turn away and back: the listener looks 45 degrees or more off the speaker and faces them again within 2.5 s.
      const track = tl.between(ref, lo, hi);
      const sp = tl.at(l.ref, l.t);
      if (!sp) return false;
      for (const p of track) {
        if (dirDiffDeg(p.dir, bearing(p.tile, sp.tile)) >= 45 && p.state !== "walk") {
          const back = tl.at(ref, p.t + 2500);
          if (back && dirDiffDeg(back.dir, bearing(back.tile, sp.tile)) <= M.gazeToleranceDeg) return true;
        }
      }
      return false;
    });
    if (ok) bcOk++;
  }

  // ---- walks, idle motion, frozen windows, pacing reversals ----
  let walkStarts = 0;
  let idleEvents = 0;
  let idleMs = 0;
  let frozenWindows = 0;
  let windows = 0;
  let reversals = 0;
  for (const ref of cast) {
    const track = trace.events.filter((e): e is Extract<TraceEvent, { kind: "pos" }> => e.kind === "pos" && e.ref === ref);
    let prevState = "stand";
    let prev: (typeof track)[number] | undefined;
    let legStart: { tile: readonly [number, number]; t: number } | undefined;
    const legs: Array<{ from: readonly [number, number]; to: readonly [number, number]; t0: number; t1: number }> = [];
    const motion: number[] = [];
    for (const p of track) {
      if (p.state === "walk" && prevState !== "walk") {
        if (p.t >= start) walkStarts++;
        legStart = { tile: prev?.tile ?? p.tile, t: p.t };
        if (p.t >= start) motion.push(p.t);
      }
      if (p.state !== "walk" && prevState === "walk" && legStart) {
        legs.push({ from: legStart.tile, to: p.tile, t0: legStart.t, t1: p.t });
        legStart = undefined;
      }
      if (prev && p.t >= start) {
        if ((prev.state === "sit") !== (p.state === "sit") && p.state !== "walk" && prev.state !== "walk") motion.push(p.t);
        else if (p.state !== "walk" && prev.state !== "walk" && dirDiffDeg(prev.dir, p.dir) >= 45) motion.push(p.t);
      }
      prevState = p.state;
      prev = p;
    }
    for (const e of trace.events) {
      if ((e.kind === "expression" || e.kind === "gesture") && e.ref === ref && e.t >= start) motion.push(e.t);
    }
    motion.sort((a, b) => a - b);
    const talkTimes = lines.filter((l) => l.ref === ref || l.to === ref).map((l) => l.t);
    const engaged = (t: number): boolean => talkTimes.some((x) => x <= t && t - x <= M.engagedMs);
    for (const t of motion) if (!engaged(t)) idleEvents++;
    for (let t = start; t < end; t += 1000) if (!engaged(t)) idleMs += 1000;
    for (let t = start; t + M.frozenWindowMs <= end; t += M.frozenWindowMs) {
      windows++;
      if (!motion.some((m) => m >= t && m < t + M.frozenWindowMs)) frozenWindows++;
    }
    for (let i = 1; i < legs.length; i++) {
      const a = legs[i - 1]!;
      const b = legs[i]!;
      if (b.t0 - a.t1 <= M.reversalMs && chebyshev(b.to, a.from) <= 1 && chebyshev(a.from, a.to) >= 1) reversals++;
    }
  }
  const idleMinutes = Math.max(idleMs / 60_000, 1 / 60);

  return {
    run: trace.run,
    source: trace.source,
    ...(trace.arm ? { arm: trace.arm } : {}),
    durationS: round(trace.durationMs / 1000, 1),
    cast: cast.length,
    lines: lines.length,
    addressedLines: addressed.length,
    distance: {
      n: dN,
      hist,
      bandShare:
        dN === 0
          ? null
          : {
              intimate: share((d) => d <= M.intimateMax)!,
              personal: share((d) => d > M.intimateMax && d <= M.personalMax)!,
              social: share((d) => d > M.personalMax && d <= M.socialMax)!,
              public: share((d) => d > M.socialMax)!,
            },
      inEarshotShare: share((d) => d <= M.earshotMax),
      conversationalShare: share((d) => d >= 1 && d <= 4),
      median: dq.p50,
      p90,
      sameTile,
    },
    stacking: { events: stackEvents, ms: stackMs, perActorHour: round((stackEvents / actorMinutes) * 60, 2) },
    gaze: { n: gazeN, speakerRate: rate(speakerOk, gazeN), listenerRate: rate(listenerOk, gazeN), mutualRate: rate(mutualOk, gazeN), breakReturnRate: rate(breaks, gazeN) },
    latency: { startTyping: quantiles(latStart), lineToLine: quantiles(latLine), overlapStarts },
    overlap: { n: overlaps, rate: rate(overlaps, Math.max(lines.length - 1, 0)) },
    interruption: { n: interrupted, rate: rate(interrupted, lines.length) },
    typing: { lines: typeMs.length, medianMs: typeQ.p50, medianMsPer100Chars: per100, lengthCorrelation: pearson(typeChars, typeMs), togglesPerLine: rate(toggles, typeMs.length) },
    gesture: { perLine: rate(withGesture, castLines.length), perActorMin: round(gestures.filter((g) => g.t >= start).length / actorMinutes, 2), byKind },
    backchannel: { n: bcN, rate: rate(bcOk, bcN) },
    idle: { motionPerActorMin: round(idleEvents / idleMinutes, 2), frozenShare: rate(frozenWindows, windows), reversalsPerActorHour: round((reversals / actorMinutes) * 60, 2) },
    walks: { total: walkStarts, perActorMin: round(walkStarts / actorMinutes, 2) },
    expression: { changesPerActorMin: round(faces.filter((f) => f.t >= start).length / actorMinutes, 2) },
  };
}
