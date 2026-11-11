/**
 * DIALOGUE: does it sound like a scene. The existing script-likeness score (length, novelty, loops, tics, echo, fillers, question debt) carries a third of
 * the group; the rest is what script-likeness cannot see because it reads text alone: interruption, silence, subtext, and whether a line answers the one before.
 *
 * Several of these are PROXIES (flagged in each reading's note): the engine has no overlapping audio, so "overlap" is read off cut-off lines and the staged
 * timeline; "subtext" is indirectness (a question met with a question, figures of speech, a line that does not say the motive behind it). None is calibrated
 * against human grades yet.
 */
import { contentKeys, isFillerText, joinedKeys, scoreTurns, similesIn, stemOf, STOP_WORDS, wordsOf } from "@perfectman/shared";
import type { ScriptTurn } from "@perfectman/shared";
import { isVisibleAct, type Line, type RunBundle } from "./bundle.js";
import { measureRun } from "./measure.js";
import type { CinemaNorms } from "./norms.js";
import { groupOf, read, readFail, readScore, readSkip, round1, round3, type GroupScore, type Reading } from "./types.js";

export function scriptTurnsFromBundle(bundle: RunBundle): ScriptTurn[] {
  const turns: ScriptTurn[] = [];
  for (const l of bundle.lines) turns.push({ speaker: l.speaker, text: l.text, kind: "say", atMs: Math.round(l.tS * 1000) });
  for (const a of bundle.acts) if (isVisibleAct(a)) turns.push({ speaker: a.actor, text: "", kind: "act", actKind: "verb", atMs: Math.round(a.tS * 1000) });
  return turns.sort((x, y) => (x.atMs ?? 0) - (y.atMs ?? 0));
}

const topicStems = (text: string): Set<string> =>
  new Set(
    contentKeys(wordsOf(text))
      .filter((k) => !STOP_WORDS.has(k))
      .map(stemOf),
  );
const asks = (text: string): boolean => /\?["”')\]]*\s*$/u.test(text.trim());
const wordsIn = (text: string): number => wordsOf(text).length;

/** A line ends cut off ("—") or the next one starts on a dash: somebody was interrupted. */
export const isCutOff = (text: string): boolean => /(?:—|–|--)["”']?\s*$/u.test(text.trim());
const startsOnDash = (text: string): boolean => /^\s*(?:—|–|--)/u.test(text);

export type Gap = { fromS: number; toS: number; gapS: number };

/** Silence between consecutive lines as the viewer sees them: the director's staged lines when the run has a track, else the events with a speech-time estimate. */
export function lineGaps(bundle: RunBundle): { gaps: Gap[]; overlaps: number; basis: "track" | "events" } {
  const staged = bundle.camera?.lines ?? [];
  const items =
    staged.length >= 2
      ? staged.map((l) => ({ start: l.tMs / 1000, end: (l.tMs + l.ms) / 1000 }))
      : bundle.lines.map((l) => ({ start: l.tS, end: l.tS + Math.max(1.2, wordsIn(l.text) / 2.8) }));
  const gaps: Gap[] = [];
  let overlaps = 0;
  for (let i = 1; i < items.length; i++) {
    const gapS = items[i]!.start - items[i - 1]!.end;
    if (gapS < -0.05) overlaps++;
    gaps.push({ fromS: items[i - 1]!.end, toS: items[i]!.start, gapS });
  }
  return { gaps, overlaps, basis: staged.length >= 2 ? "track" : "events" };
}

export const DEAD_AIR_S = 10;
export const PAUSE_MIN_S = 2;

export function scoreDialogue(bundle: RunBundle, norms: CinemaNorms, opts: { scriptTurns?: ScriptTurn[] } = {}): GroupScore {
  const B = norms.bands;
  const readings: Reading[] = [];
  const lines = bundle.lines;
  const detail: Record<string, unknown> = { lines: lines.length };

  // 1. script-likeness (existing benchmark)
  const turns = opts.scriptTurns ?? scriptTurnsFromBundle(bundle);
  if (lines.length === 0) {
    readings.push(readFail("scriptLikeness", 0.3, "nobody spoke"));
  } else {
    const sl = scoreTurns(turns, { norms: norms.scriptNorms, language: bundle.language, medium: "CINEMA", names: bundle.cast });
    detail["scriptLikeness"] = { score: sl.score, percentile: sl.percentile, sub: sl.sub, sayTurns: sl.sayTurns, lowN: sl.lowN, mediumFallback: sl.mediumFallback };
    readings.push(readScore("scriptLikeness", sl.score, sl.score, 0.3, `existing script-likeness benchmark, ${sl.sayTurns} speech turns${sl.lowN ? " (too few for a verdict)" : ""}${sl.mediumFallback ? ", read next to THEATRE norms (no cinema block yet)" : ""}`));
  }

  // 2. interruption (proxy)
  if (lines.length >= 2) {
    const { overlaps, basis } = lineGaps(bundle);
    let cut = 0;
    for (let i = 0; i < lines.length; i++) if (isCutOff(lines[i]!.text) || (i > 0 && startsOnDash(lines[i]!.text) && lines[i - 1]!.speaker !== lines[i]!.speaker)) cut++;
    const share = (cut + overlaps) / lines.length;
    detail["interruptions"] = { cutOff: cut, overlaps, basis };
    readings.push(read("interruptionShare", share, 0.1, B.interruptionShare, `PROXY: ${cut} cut-off lines and ${overlaps} staged overlaps out of ${lines.length} lines (the engine speaks one line at a time)`));
  } else readings.push(readFail("interruptionShare", 0.1, "fewer than 2 lines", B.interruptionShare));

  // 3. silence: dead air and pauses with business in them
  if (lines.length >= 2) {
    const { gaps, basis } = lineGaps(bundle);
    const total = Math.max(1, bundle.durationS);
    const dead = gaps.filter((g) => g.gapS > DEAD_AIR_S).reduce((a, g) => a + (g.gapS - DEAD_AIR_S), 0);
    readings.push(read("deadAirShare", dead / total, 0.05, B.deadAirShare, `${round1(dead)} s of silence beyond ${DEAD_AIR_S} s between lines (${basis} timeline), of ${round1(total)} s`));
    // a pause beat: 2 to 10 s with something to look at in it (an act, a non-neutral face, a walk), not just waiting
    const business = [
      ...bundle.acts.map((a) => a.tS),
      ...bundle.bodyCmds.filter((c) => c.kind === "walk" || c.kind === "sit" || (c.kind === "expression" && c.detail !== "neutral") || (c.kind === "action" && c.detail !== "stop" && c.detail !== "stand")).map((c) => c.tS),
    ];
    const pauses = gaps.filter((g) => g.gapS >= PAUSE_MIN_S && g.gapS <= DEAD_AIR_S && business.some((t) => t >= g.fromS - 0.5 && t <= g.toS + 0.5)).length;
    const perMin = pauses / Math.max(1 / 6, total / 60);
    detail["pauses"] = { count: pauses, gaps: gaps.length, basis };
    readings.push(read("pauseBeatsPerMin", perMin, 0.05, B.pauseBeatsPerMin, `${pauses} silences of ${PAUSE_MIN_S}-${DEAD_AIR_S} s with business in them (an act, a face, a walk) in ${round1(total / 60)} min`));
  } else {
    readings.push(readFail("deadAirShare", 0.05, "fewer than 2 lines", B.deadAirShare));
    readings.push(readFail("pauseBeatsPerMin", 0.05, "fewer than 2 lines", B.pauseBeatsPerMin));
  }

  // 3b. rhythm, measured the way the corpus's subtitle files were (clock times, the reading-rate model for how long a line takes to say)
  const f = measureRun(bundle).features;
  const why = lines.length < 3 ? "fewer than 3 spoken lines" : "nothing to measure";
  if (f) {
    detail["rhythm"] = { turnsPerMin: round1(f.turnsPerMin), silenceShare: f.silenceShare === null ? null : round3(f.silenceShare), shortShare: round3(f.shortShare), spanS: round1(f.durSec) };
    readings.push(read("turnsPerMin", f.turnsPerMin, 0.08, B.turnsPerMin, `${f.turns} spoken turns in ${round1(f.durSec)} s between the first line and the last`));
    readings.push(
      f.silenceShare === null
        ? readSkip("silenceShare", 0.1, B.silenceShare, "no span to measure silence on")
        : read("silenceShare", f.silenceShare, 0.1, B.silenceShare, `nobody talking for ${round3(f.silenceShare)} of the span (a line is assumed to take 0.45 s + words / 2.7 s to say); subtitle scenes are cut at 12 s of silence, so a longer dead stretch is not in the norm`),
    );
    readings.push(read("shortReplyShare", f.shortShare, 0.07, B.shortReplyShare, `${Math.round(f.shortShare * f.turns)} of ${f.turns} lines are 5 words or fewer`));
  } else {
    readings.push(readSkip("turnsPerMin", 0.08, B.turnsPerMin, why));
    readings.push(readSkip("silenceShare", 0.1, B.silenceShare, why));
    readings.push(readSkip("shortReplyShare", 0.07, B.shortReplyShare, why));
  }

  // 4. subtext (weak proxy)
  const sub = subtext(lines);
  detail["subtext"] = sub.parts;
  readings.push(sub.value === null ? readFail("subtext", 0.1, "no lines to read", B.subtext) : read("subtext", sub.value, 0.1, B.subtext, `WEAK PROXY: mean of ${Object.keys(sub.parts).length} indirectness signal(s): ${Object.entries(sub.parts).map(([k, v]) => `${k} ${round3(v)}`).join(", ")}`));

  // 5. reply adherence
  const ra = replyAdherence(lines);
  detail["reply"] = ra;
  readings.push(ra.adherence === null ? readFail("replyAdherence", 0.15, "no exchanges between different speakers", B.replyAdherence) : read("replyAdherence", ra.adherence, 0.15, B.replyAdherence, `${ra.adherent} of ${ra.pairs} answers share a topic word with, or are an answer to, the line before`));
  if (ra.stale !== null) readings.push(read("staleReplyShare", ra.stale, 0.0, B.staleReplyShare, `${ra.staleCount} of ${ra.replyTargets} replies answer a line more than 3 lines back (reported, not weighted yet)`));

  return groupOf("dialogue", readings, detail);
}

export function subtext(lines: readonly Line[]): { value: number | null; parts: Record<string, number> } {
  if (lines.length === 0) return { value: null, parts: {} };
  const parts: Record<string, number> = {};
  // deflection: a question met by a question or a line that shares nothing with it
  let qa = 0;
  let deflect = 0;
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1]!;
    const cur = lines[i]!;
    if (prev.speaker === cur.speaker || !asks(prev.text) || isFillerText(cur.text)) continue;
    qa++;
    const shared = [...topicStems(cur.text)].some((k) => topicStems(prev.text).has(k));
    if (asks(cur.text) || (!shared && wordsIn(cur.text) >= 4)) deflect++;
  }
  if (qa > 0) parts["deflection"] = deflect / qa;
  // figures of speech, trailing off, cutting off
  const figurative = lines.filter((l) => similesIn(joinedKeys(wordsOf(l.text))).length > 0 || /(?:\.\.\.|…)["”']?\s*$/u.test(l.text.trim()) || isCutOff(l.text)).length;
  parts["figurative"] = figurative / lines.length;
  // the line does not say the motive behind it
  const withMotive = lines.filter((l) => l.motive !== undefined);
  if (withMotive.length >= 3) {
    const div = withMotive.map((l) => {
      const a = topicStems(l.motive!);
      const b = topicStems(l.text);
      if (a.size === 0 || b.size === 0) return 1;
      let both = 0;
      for (const k of a) if (b.has(k)) both++;
      return 1 - both / (a.size + b.size - both);
    });
    const mean = div.reduce((x, v) => x + v, 0) / div.length;
    parts["motiveGap"] = Math.max(0, Math.min(1, (mean - 0.5) / 0.5));
  }
  const vals = Object.values(parts);
  return { value: vals.reduce((a, v) => a + v, 0) / vals.length, parts };
}

export function replyAdherence(lines: readonly Line[]): { adherence: number | null; pairs: number; adherent: number; stale: number | null; staleCount: number; replyTargets: number } {
  let pairs = 0;
  let adherent = 0;
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1]!;
    const cur = lines[i]!;
    if (prev.speaker === cur.speaker || isFillerText(cur.text)) continue;
    pairs++;
    const a = topicStems(prev.text);
    const shared = [...topicStems(cur.text)].some((k) => a.has(k));
    if (shared || (asks(prev.text) && wordsIn(cur.text) >= 3)) adherent++;
  }
  const index = new Map<string, number>();
  lines.forEach((l, i) => {
    if (l.eventId) index.set(l.eventId, i);
  });
  let replyTargets = 0;
  let staleCount = 0;
  lines.forEach((l, i) => {
    if (!l.replyToEventId) return;
    const at = index.get(l.replyToEventId);
    if (at === undefined) return;
    replyTargets++;
    if (i - at > 3) staleCount++;
  });
  return { adherence: pairs === 0 ? null : adherent / pairs, pairs, adherent, stale: replyTargets === 0 ? null : staleCount / replyTargets, staleCount, replyTargets };
}
