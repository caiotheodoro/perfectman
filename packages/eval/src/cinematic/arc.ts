/**
 * ARC: does the scene go somewhere. Reads the acts (frames.jsonl) and the dialogue's verbal moves (events.jsonl) as one list of dramatic beats
 * with a weight each, then asks: when did the first real disturbance land, how many times did the scene turn, did it climb to a peak, did the peak
 * land in the time budget, is there an aftermath, and did the stakes move.
 *
 * Weights of a beat: an act by its place on the drama ladder (glare 1, insult 2, shove 3, slap 4, punch 5, kill/die 6; the soft verbs less), a line
 * by the move it makes (threat 3, accusation 2.5, reveal 2, proposal 1). An act that did not play out (aborted, declined, timeout) is not a beat.
 *
 * HARD INVARIANT (plan: "physical climax by 4:00"): a physical-contact act (shove, slap, punch, kill, die, faint, restrain, hug, kiss) at or before
 * {@link CLIMAX_DEADLINE_S}. The climax is the earliest physical act within 80% of the run's strongest physical act. Reported as pass/fail in
 * `invariants`, and the overall score is capped when it fails (see score.ts).
 */
import { joinedKeys, movesOf, wordsOf } from "@perfectman/shared";
import { AGGRESSIVE_ACT_VERBS, PHYSICAL_ACT_VERBS, isVisibleAct, type RunBundle } from "./bundle.js";
import { CLIMAX_DEADLINE_S, type CinemaNorms } from "./norms.js";
import { groupOf, read, readFail, round1, round3, type GroupScore } from "./types.js";

export const ACT_WEIGHT: Readonly<Record<string, number>> = {
  glare: 1,
  insult: 2,
  shove: 3,
  slap: 4,
  punch: 5,
  kill: 6,
  die: 6,
  faint: 4,
  restrain: 3,
  hug: 2,
  kiss: 2,
  cry: 2,
  storm_off: 3,
  tableau: 2,
  turn_back: 1,
  tend_fallen: 2,
  recoil: 0.5,
  freeze_gasp: 0.5,
};
export const MOVE_WEIGHT = { threat: 3, accusation: 2.5, reveal: 2, proposal: 1 } as const;

/** A beat is "real" (an inciting incident, a turn) from this weight: an insult or a verbal accusation, not a glare or a reaction. */
export const INCITING_WEIGHT = 2;
export const BUCKET_S = 10;

export type Beat = { tS: number; w: number; kind: "act" | "line"; label: string; physical: boolean; actor?: string; target?: string };

export function beatsOf(bundle: RunBundle): Beat[] {
  const beats: Beat[] = [];
  for (const a of bundle.acts) {
    if (!isVisibleAct(a)) continue;
    const w = ACT_WEIGHT[a.verb] ?? 1;
    beats.push({ tS: a.tS, w, kind: "act", label: a.verb, physical: PHYSICAL_ACT_VERBS.has(a.verb), actor: a.actor, ...(a.target ? { target: a.target } : {}) });
  }
  for (const l of bundle.lines) {
    const moves = movesOf(joinedKeys(wordsOf(l.text)));
    if (moves.length === 0) continue;
    const w = Math.max(...moves.map((m) => MOVE_WEIGHT[m]));
    beats.push({ tS: l.tS, w, kind: "line", label: moves[0]!, physical: false, actor: l.speaker });
  }
  return beats.sort((a, b) => a.tS - b.tS);
}

/** Tension per bucket of {@link BUCKET_S} seconds, smoothed by a centred mean of 3. */
export function tensionSeries(beats: readonly Beat[], endS: number): number[] {
  const n = Math.max(1, Math.ceil(endS / BUCKET_S));
  const raw = new Array<number>(n).fill(0);
  for (const b of beats) raw[Math.min(n - 1, Math.max(0, Math.floor(b.tS / BUCKET_S)))]! += b.w;
  return raw.map((_, i) => {
    const win = raw.slice(Math.max(0, i - 1), Math.min(n, i + 2));
    return win.reduce((a, v) => a + v, 0) / win.length;
  });
}

/** Share of (earlier, later) bucket pairs up to the peak where the later is higher (ties half). 0 when the peak comes before there is anything to climb. */
export function escalationShape(series: readonly number[]): number {
  const max = Math.max(0, ...series);
  if (max === 0) return 0;
  const peak = series.indexOf(max);
  if (peak < 2) return 0;
  let conc = 0;
  let pairs = 0;
  for (let i = 0; i <= peak; i++) {
    for (let j = i + 1; j <= peak; j++) {
      pairs++;
      conc += series[j]! > series[i]! ? 1 : series[j]! === series[i]! ? 0.5 : 0;
    }
  }
  return pairs === 0 ? 0 : conc / pairs;
}

/** Valley-to-rise turns of the series: a swing down then up by at least `minSwing` (the larger of 1.5 and 30% of the peak). */
export function risingTurns(series: readonly number[]): number {
  const peakValue = Math.max(0, ...series);
  if (peakValue === 0) return 0;
  const swing = Math.max(1.5, 0.3 * peakValue);
  let turns = 0;
  let dir = 0; // 1 climbing, -1 falling, 0 not decided yet
  let pivot = series[0]!;
  let min = pivot;
  let max = pivot;
  for (let i = 1; i < series.length; i++) {
    const v = series[i]!;
    if (dir === 0) {
      min = Math.min(min, v);
      max = Math.max(max, v);
      if (v - min >= swing) {
        dir = 1;
        pivot = v;
      } else if (max - v >= swing) {
        dir = -1;
        pivot = v;
      }
    } else if (dir === 1) {
      if (v > pivot) pivot = v;
      else if (pivot - v >= swing) {
        dir = -1;
        pivot = v;
      }
    } else if (v < pivot) pivot = v;
    else if (v - pivot >= swing) {
      turns++;
      dir = 1;
      pivot = v;
    }
  }
  return turns;
}

/** Consecutive hostile acts where the target of the one before hits back: who holds the initiative changed. */
export function initiativeSwaps(bundle: RunBundle): number {
  const hostile = bundle.acts.filter((a) => isVisibleAct(a) && AGGRESSIVE_ACT_VERBS.has(a.verb) && a.target !== undefined);
  let swaps = 0;
  for (let i = 1; i < hostile.length; i++) {
    const prev = hostile[i - 1]!;
    const cur = hostile[i]!;
    if (cur.actor === prev.target && cur.target === prev.actor) swaps++;
  }
  return swaps;
}

export type Climax = { atS: number; verb: string; weight: number; actor: string; target?: string };

/** The earliest physical act within 80% of the strongest physical act of the run. */
export function findClimax(bundle: RunBundle): Climax | undefined {
  const physical = bundle.acts.filter((a) => isVisibleAct(a) && PHYSICAL_ACT_VERBS.has(a.verb));
  if (physical.length === 0) return undefined;
  const top = Math.max(...physical.map((a) => ACT_WEIGHT[a.verb] ?? 1));
  const first = physical.find((a) => (ACT_WEIGHT[a.verb] ?? 1) >= 0.8 * top)!;
  return { atS: first.tS, verb: first.verb, weight: ACT_WEIGHT[first.verb] ?? 1, actor: first.actor, ...(first.target ? { target: first.target } : {}) };
}

const jaccardDistance = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 0;
  let both = 0;
  for (const k of a) if (b.has(k)) both++;
  return 1 - both / (a.size + b.size - both);
};

export function scoreArc(bundle: RunBundle, norms: CinemaNorms): GroupScore {
  const B = norms.bands;
  const beats = beatsOf(bundle);
  const lastActivity = Math.max(0, ...beats.map((b) => b.tS), ...bundle.lines.map((l) => l.tS));
  const endS = Math.max(bundle.durationS, lastActivity);
  const inciting = beats.find((b) => b.w >= INCITING_WEIGHT);
  const climax = findClimax(bundle);
  const series = tensionSeries(beats, endS);
  const peakW = beats.length === 0 ? 0 : Math.max(...beats.map((b) => b.w));
  const peakBeat = beats.find((b) => b.w === peakW);
  const swaps = initiativeSwaps(bundle);
  const turns = risingTurns(series);
  const per4 = Math.max(bundle.durationS, 120) / 240;
  const reversals = (swaps + turns) / per4;
  const shape = escalationShape(series);

  const readings = [];
  readings.push(
    inciting
      ? read("timeToIncitingS", inciting.tS, 0.15, B.timeToIncitingS, `first real disturbance (${inciting.kind === "act" ? "act" : "line"} ${inciting.label}) at ${round1(inciting.tS)} s`)
      : readFail("timeToIncitingS", 0.15, "nothing in the run was a real disturbance (no insult, accusation, threat, reveal or physical act)", B.timeToIncitingS),
  );
  readings.push(read("reversals", reversals, 0.15, B.reversals, `${swaps} initiative swap(s) + ${turns} rise(s) after a lull, per 4 minutes of run`));
  readings.push(read("escalationShape", shape, 0.15, B.escalationShape, "share of (earlier, later) 10 s buckets up to the peak where tension did not fall; 0 when the peak comes at once or there is no peak"));
  readings.push(read("peakIntensity", peakW, 0.1, B.peakIntensity, `strongest beat is weight ${peakW}${peakBeat ? ` (${peakBeat.label})` : ""}; shove 3, slap 4, punch 5, kill 6`));
  readings.push(
    climax
      ? read("timeToClimaxS", climax.atS, 0.25, B.timeToClimaxS, `physical climax (${climax.verb}) at ${round1(climax.atS)} s; the invariant is ${CLIMAX_DEADLINE_S} s`)
      : readFail("timeToClimaxS", 0.25, "no physical act reached the screen", B.timeToClimaxS),
  );

  const peakAt = climax?.atS ?? peakBeat?.tS;
  let aftermathShare: number | null = null;
  let aftermathLines = 0;
  if (peakAt !== undefined && lastActivity > 0) {
    aftermathShare = Math.max(0, lastActivity - peakAt) / lastActivity;
    aftermathLines = bundle.lines.filter((l) => l.tS > peakAt + 2).length;
  }
  readings.push(
    aftermathShare === null || aftermathLines < 2
      ? readFail("aftermathShare", 0.1, aftermathShare === null ? "no peak, so no aftermath" : `the scene ends within 2 lines of the peak (${aftermathLines} after it)`, B.aftermathShare)
      : read("aftermathShare", aftermathShare, 0.1, B.aftermathShare, `${round1(lastActivity - peakAt!)} s and ${aftermathLines} lines after the peak at ${round1(peakAt!)} s`),
  );

  // stakes: (a) how far the strongest beat rose above the opening level, (b) memory intensity first third -> last third, (c) change of emotional tone
  const parts: number[] = [];
  const opening = Math.max(0, ...beats.filter((b) => b.tS <= 0.2 * endS).map((b) => b.w));
  parts.push(Math.max(0, Math.min(1, (peakW - opening) / 4)));
  const third = endS / 3;
  const early = bundle.memories.filter((m) => m.tS <= third);
  const late = bundle.memories.filter((m) => m.tS > 2 * third);
  let intensityDelta: number | undefined;
  if (early.length >= 2 && late.length >= 2) {
    const mean = (xs: number[]): number => xs.reduce((a, v) => a + v, 0) / xs.length;
    intensityDelta = mean(late.map((m) => m.intensity)) - mean(early.map((m) => m.intensity));
    parts.push(Math.max(0, Math.min(1, intensityDelta / 0.3)));
    parts.push(jaccardDistance(new Set(early.map((m) => m.tone).filter(Boolean)), new Set(late.map((m) => m.tone).filter(Boolean))));
  }
  const stakes = parts.reduce((a, v) => a + v, 0) / parts.length;
  readings.push(read("stakesChange", stakes, 0.1, B.stakesChange, `mean of ${parts.length} signal(s): rise of the peak over the opening${intensityDelta !== undefined ? `, memory intensity ${intensityDelta >= 0 ? "+" : ""}${round3(intensityDelta)} first to last third, tone shift` : " (too few memories for the other two)"}`));

  return groupOf("arc", readings, {
    beats: beats.length,
    incitingAtS: inciting ? round1(inciting.tS) : null,
    incitingKind: inciting?.label ?? null,
    climax: climax ?? null,
    peakAtS: peakAt === undefined ? null : round1(peakAt),
    initiativeSwaps: swaps,
    risingTurns: turns,
    lastActivityS: round1(lastActivity),
  });
}

export type ClimaxInvariant = { pass: boolean; deadlineS: number; atS: number | null; verb: string | null; reason: string };

/** The plan's one hard invariant: a physical climax by 4:00. */
export function climaxInvariant(bundle: RunBundle, deadlineS: number = CLIMAX_DEADLINE_S): ClimaxInvariant {
  const climax = findClimax(bundle);
  if (!climax) return { pass: false, deadlineS, atS: null, verb: null, reason: "no physical act (shove, slap, punch, kill, die, faint, restrain, hug, kiss) reached the screen" };
  const pass = climax.atS <= deadlineS;
  return { pass, deadlineS, atS: round1(climax.atS), verb: climax.verb, reason: pass ? `${climax.verb} at ${round1(climax.atS)} s` : `${climax.verb} came at ${round1(climax.atS)} s, after ${deadlineS} s` };
}
