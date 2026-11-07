/**
 * Calibration kit: judge vs the hand-labeled snippets (quality-rubric.md section 7).
 * Headline kappa is the mean of per-axis ordinal-weighted kappas, the definition
 * the existing gate (`calibrateJudge`) and the quoted 0.13 / -0.12 use, so the
 * numbers compare. The pooled kappa, exact agreement and a good/bad (>=4 vs <=2)
 * Cohen kappa are reported next to it. Tiers are per axis (section 7, step 3).
 */
import { weightedKappa } from "../judge/calibration.js";
import { CALIBRATION_SET, snippetTranscript, type CalibrationSnippet } from "./calibration-set.js";
import { aiAdmission, extractTokens } from "./leak-detectors.js";
import { HOTEL_AXES, type HotelAxis } from "./rubric.js";
import type { HotelJudgment, HotelScores } from "./hotel-judge.js";

export type Tier = "gates" | "rank_only" | "advisory";

export type AxisAgreement = { pairs: number; kappa: number; exact: number; within1: number; tier: Tier };

export type HotelCalibrationReport = {
  judge: string;
  snippets: number;
  /** Replies that never validated as JSON after the retry. */
  invalidJson: number;
  retried: number;
  /** Judge gave a number on an axis the snippet has no label for; not scored. */
  unscored: number;
  /** Judge answered null where a label exists; counted as a miss, not as agreement. */
  nullOnLabeled: number;
  pairs: number;
  kappa: number;
  kappaPooled: number;
  exact: number;
  within1: number;
  binary: { pairs: number; kappa: number };
  perAxis: Record<HotelAxis, AxisAgreement>;
  disagreements: string[];
  spentUsd?: number;
};

const round = (n: number): number => Math.round(n * 1000) / 1000;

export function tierOf(kappa: number, pairs: number): Tier {
  if (pairs < 2) return "advisory";
  return kappa >= 0.7 ? "gates" : kappa >= 0.5 ? "rank_only" : "advisory";
}

/** Unweighted Cohen kappa on two 0/1 sequences. */
export function binaryKappa(a: number[], b: number[]): number {
  const n = a.length;
  if (n === 0 || n !== b.length) return 0;
  let agree = 0;
  let a1 = 0;
  let b1 = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree++;
    a1 += a[i]!;
    b1 += b[i]!;
  }
  const po = agree / n;
  const pe = (a1 / n) * (b1 / n) + (1 - a1 / n) * (1 - b1 / n);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

export type JudgedSnippet = { id: string; scores: HotelScores; judgment?: HotelJudgment };

/** Pure scoring of judge output against the labels. */
export function scoreCalibration(
  judged: readonly JudgedSnippet[],
  set: readonly CalibrationSnippet[] = CALIBRATION_SET,
  judge = "unknown",
): HotelCalibrationReport {
  const byId = new Map(judged.map((j) => [j.id, j]));
  const perAxisPairs = {} as Record<HotelAxis, { j: number[]; h: number[] }>;
  for (const a of HOTEL_AXES) perAxisPairs[a] = { j: [], h: [] };
  const disagreements: string[] = [];
  let unscored = 0;
  let nullOnLabeled = 0;
  for (const snip of set) {
    const j = byId.get(snip.id);
    if (!j) continue;
    for (const axis of HOTEL_AXES) {
      const label = snip.labels[axis];
      const score = j.scores[axis];
      if (label === undefined) {
        if (score !== null) unscored++;
        continue;
      }
      if (score === null) {
        nullOnLabeled++;
        continue;
      }
      perAxisPairs[axis].j.push(score);
      perAxisPairs[axis].h.push(label);
      if (Math.abs(score - label) >= 2) disagreements.push(`${snip.id} ${axis}: judge ${score} vs label ${label}`);
    }
  }

  const perAxis = {} as Record<HotelAxis, AxisAgreement>;
  const allJ: number[] = [];
  const allH: number[] = [];
  const kappas: number[] = [];
  let exact = 0;
  let within1 = 0;
  for (const axis of HOTEL_AXES) {
    const { j, h } = perAxisPairs[axis];
    const k = j.length > 1 ? weightedKappa(j, h) : 0;
    const ex = j.filter((v, i) => v === h[i]).length;
    const w1 = j.filter((v, i) => Math.abs(v - h[i]!) <= 1).length;
    perAxis[axis] = { pairs: j.length, kappa: round(k), exact: round(j.length ? ex / j.length : 0), within1: round(j.length ? w1 / j.length : 0), tier: tierOf(k, j.length) };
    if (j.length > 1) kappas.push(k);
    allJ.push(...j);
    allH.push(...h);
    exact += ex;
    within1 += w1;
  }

  // Good (>=4) vs bad (<=2); a label of 3 on either side is ambiguous and left out.
  const bj: number[] = [];
  const bh: number[] = [];
  allJ.forEach((v, i) => {
    const l = allH[i]!;
    if (v === 3 || l === 3) return;
    bj.push(v >= 4 ? 1 : 0);
    bh.push(l >= 4 ? 1 : 0);
  });

  const invalidJson = judged.filter((j) => j.judgment && !j.judgment.jsonValid).length;
  const retried = judged.filter((j) => j.judgment && j.judgment.attempts > 1).length;
  return {
    judge,
    snippets: judged.length,
    invalidJson,
    retried,
    unscored,
    nullOnLabeled,
    pairs: allJ.length,
    kappa: round(kappas.length ? kappas.reduce((s, v) => s + v, 0) / kappas.length : 0),
    kappaPooled: round(allJ.length > 1 ? weightedKappa(allJ, allH) : 0),
    exact: round(allJ.length ? exact / allJ.length : 0),
    within1: round(allJ.length ? within1 / allJ.length : 0),
    binary: { pairs: bj.length, kappa: round(binaryKappa(bj, bh)) },
    perAxis,
    disagreements,
  };
}

export async function runHotelCalibration(
  judge: (transcript: string, snippet: CalibrationSnippet) => Promise<HotelJudgment>,
  opts: { set?: readonly CalibrationSnippet[]; concurrency?: number; judgeName?: string } = {},
): Promise<HotelCalibrationReport> {
  const set = opts.set ?? CALIBRATION_SET;
  const out: JudgedSnippet[] = new Array<JudgedSnippet>(set.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < set.length) {
      const i = next++;
      const snip = set[i]!;
      const judgment = await judge(snippetTranscript(snip), snip);
      out[i] = { id: snip.id, scores: judgment.scores, judgment };
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, opts.concurrency ?? 3), set.length) }, worker));
  return scoreCalibration(out, set, opts.judgeName);
}

export function formatCalibration(r: HotelCalibrationReport): string {
  const lines = [
    `hotel judge calibration: ${r.judge}`,
    `  ${r.snippets} snippets, ${r.pairs} scored pairs, invalid JSON ${r.invalidJson}, retried ${r.retried}, null on labeled ${r.nullOnLabeled}`,
    `  kappa (mean of per-axis, weighted) ${r.kappa}   pooled ${r.kappaPooled}   good/bad kappa ${r.binary.kappa} (n=${r.binary.pairs})`,
    `  exact ${r.exact}   within 1 ${r.within1}   target 0.7 to gate`,
  ];
  for (const a of HOTEL_AXES) {
    const x = r.perAxis[a];
    lines.push(`  ${a.padEnd(20)} kappa ${String(x.kappa).padStart(6)}  n=${String(x.pairs).padStart(2)}  exact ${x.exact}  within1 ${x.within1}  ${x.tier}`);
  }
  if (r.disagreements.length > 0) lines.push(`  disagreements >=2: ${r.disagreements.slice(0, 8).join("; ")}`);
  if (r.spentUsd !== undefined) lines.push(`  estimated spend $${r.spentUsd.toFixed(4)}`);
  return lines.join("\n");
}

// ---- offline baseline --------------------------------------------------------

const timeOf = (line: string): number => Number(/^\[t\+(\d+)s\]/.exec(line)?.[1] ?? 0);
const looksPt = (t: string): boolean => /\b(?:você|vc|não|nao|tá|ta|oi|que|pra|kkk|sim|tô|né|está|estou)\b/i.test(t);
const looksEn = (t: string): boolean => /\b(?:the|you|is|are|what|how|don't|yeah|hey|ok|sure|just|i)\b/i.test(t);

/**
 * Offline rule judge: regex proxies over the rendered text. A baseline for
 * "does the LLM judge beat counting words", not a quality measure
 * (quality-rubric.md section 7, step 4). Returns null where it has no proxy evidence.
 */
export function ruleHotelJudge(transcript: string): HotelScores {
  const lines = transcript.split("\n").filter((l) => l.startsWith("[t+"));
  const speech = lines.filter((l) => / (?:says|shouts|whispers)[ :[]/.test(l));
  const human = speech.filter((l) => l.includes("(human)"));
  const actor = speech.filter((l) => !l.includes("(human)"));
  const body = (l: string): string => l.slice(l.indexOf(": ") + 2);
  const scores = Object.fromEntries(HOTEL_AXES.map((a) => [a, null])) as HotelScores;

  if (actor.some((l) => aiAdmission(body(l)))) scores.human_self_belief = 1;
  else if (human.some((l) => /\b(?:bot|rob[ôo]|ai|ia|simula|real mesmo|real or what|you real)\b/i.test(body(l))) && actor.length > 0) scores.human_self_belief = 5;

  const echoed = actor.some((l) => extractTokens(l).length > 0 && human.some((h) => extractTokens(h).some((t) => l.includes(t.slice(0, 12)))));
  const boiler = actor.some((l) => /como posso|how can i (?:help|assist)|entendo!|as an ai/i.test(body(l)));
  const bodies = actor.map(body);
  const repeats = bodies.length >= 3 && new Set(bodies).size <= Math.floor(bodies.length / 2);
  if (actor.length > 0) scores.in_character = echoed || boiler ? 1 : repeats ? 2 : 4;

  const hl = human.map(body).join(" ");
  const al = actor.map(body).join(" ");
  if (hl && al) scores.language_adherence = looksPt(hl) && !looksPt(al) && looksEn(al) ? 1 : looksEn(hl) && !looksEn(al) && looksPt(al) ? 1 : 5;

  const teleports = lines.some((l) => /walks .* \[(\d+) tiles in 0\.\d+s\]/.test(l) && Number(/\[(\d+) tiles/.exec(l)?.[1]) > 2);
  const farTalk = actor.some((l) => / says to .*\[(?:\d+ tiles, public|different room, out_of_sight)/.test(l));
  const walked = lines.some((l) => /walks \(/.test(l));
  if (actor.length > 0 || lines.some((l) => /walks|sits|stands/.test(l))) scores.spatial_coherence = teleports || farTalk ? 1 : walked ? 4 : 3;

  if (human.length > 0 && actor.length > 0) {
    const dogpile = human.some((h) => new Set(actor.filter((a) => timeOf(a) >= timeOf(h) && timeOf(a) - timeOf(h) <= 3).map((a) => a.split(" ")[1])).size >= 2);
    const ignored = human.some((h) => !actor.some((a) => timeOf(a) >= timeOf(h) && timeOf(a) - timeOf(h) <= 20));
    scores.turn_taking = dogpile || ignored ? 1 : 4;
  }

  if (lines.length > 0) {
    const times = actor.map(timeOf);
    const burst = times.some((t) => times.filter((u) => u >= t && u - t <= 6).length >= 4);
    const times2 = lines.map(timeOf);
    const gap = times2.some((t, i) => i > 0 && t - times2[i - 1]! > 45);
    const dead = lines.filter((l) => /stays quiet/.test(l)).length >= 2 && actor.length <= 1;
    const calm = lines.some((l) => /stays quiet| does: /.test(l));
    scores.pacing_silence = burst || gap || dead ? 1 : calm ? 4 : 3;
  }
  return scores;
}
