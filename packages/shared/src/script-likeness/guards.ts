import { NOVELTY_MIN_CONTENT, NOVELTY_WINDOW, analyze, motifKeys, noveltyAgainst, answers } from "./metrics.js";
import type { Analyzed } from "./metrics.js";
import { ladderValue, normsFor } from "./norms.js";
import type { ScriptNorms } from "./norms.js";
import { fold, letterCount, nameKeys, stripDirections, wordCount } from "./text.js";
import type { ScriptLang } from "./text.js";

/**
 * The checks a live actor's candidate line goes through (hotel runs): how long it is, whether it says anything the room has not just heard,
 * whether it brings back a phrase or simile the room is already using, and whether it dodges a question put to its speaker. Pure; the
 * actor loop (`ActionIntentStep`) decides what to do with a verdict.
 */

// ---- length -------------------------------------------------------------------------------------------------------------------

export type MessageLength = "rapid_fire" | "short" | "medium" | "long";

export type LengthTarget = {
  /** The range a normal turn aims at, in words. */
  aim: [number, number];
  /** A turn over this many words is retried, then cut. */
  cap: number;
  /** Sentences a normal turn has at most. */
  sentences: number;
};

/**
 * Words per turn by what the persona's `presence.messageLength` says. `short` is the hotel default. Portuguese `short` is the brief's 6 to 12
 * words with a cap of 25 (turn-level percentiles 45, 70 and 87 of the pt plays); English plays run longer (median 10, p75 21) so its short turn
 * aims 8 to 16 with a cap of 32 (the same percentiles of the en plays: 7, 14, 29, rounded up a little for chat that is read aloud).
 */
export function lengthTargetFor(messageLength: MessageLength | undefined, lang: ScriptLang): LengthTarget {
  const kind = messageLength ?? "short";
  switch (kind) {
    case "rapid_fire":
      return { aim: [2, 6], cap: 12, sentences: 1 };
    case "short":
      return lang === "pt" ? { aim: [6, 12], cap: 25, sentences: 2 } : { aim: [8, 16], cap: 32, sentences: 2 };
    case "medium":
      return lang === "pt" ? { aim: [10, 20], cap: 40, sentences: 3 } : { aim: [12, 24], cap: 48, sentences: 3 };
    case "long":
      return { aim: [15, 35], cap: 60, sentences: 4 };
  }
}

/** Words of a line the way the length cap counts them (directions and laughter do not count). */
export const lengthOf = (text: string): number => wordCount(text);

const SENTENCE_END = /(?<=[.!?…])\s+/u;

const sentenceList = (text: string): string[] =>
  stripDirections(text)
    .trim()
    .split(SENTENCE_END)
    .map((s) => s.trim())
    .filter((s) => s !== "");

const endsAsQuestion = (s: string): boolean => /\?["”')\]]*$/u.test(s);

/**
 * Cuts a line to a cap without ever ending mid-sentence: whole sentences while they fit and while there are no more than `maxSentences` of
 * them, a trailing second question dropped. When the first sentence alone is over the cap it is cut at the last clause break (comma,
 * semicolon, colon, dash) that leaves at least 3 words and ends with a full stop; a sentence with no clause break is cut at the cap with
 * an ellipsis, which is how a person trails off. Returns the text unchanged when it is already inside the cap and the sentence limit.
 */
export function trimToCap(text: string, cap: number, maxSentences = 2): string {
  const sentences = sentenceList(text);
  if (sentences.length === 0) return text.trim();
  const kept: string[] = [];
  let words = 0;
  for (const s of sentences) {
    const n = wordCount(s);
    if (kept.length >= maxSentences || words + n > cap) break;
    // A second question after a first one is the loop the room hears twice: drop it.
    if (kept.length > 0 && endsAsQuestion(s) && endsAsQuestion(kept[kept.length - 1]!)) break;
    kept.push(s);
    words += n;
  }
  if (kept.length > 0) return kept.join(" ");
  // The first sentence is over the cap by itself.
  const first = sentences[0]!;
  const parts = first.split(/(?<=[,;:—–])\s+/u);
  let acc = "";
  for (const part of parts) {
    const next = acc === "" ? part : `${acc} ${part}`;
    if (wordCount(next) > cap) break;
    acc = next;
  }
  if (wordCount(acc) >= 3) return `${acc.replace(/[\s,;:—–]+$/u, "")}.`;
  const tokens = first.split(/\s+/u);
  return `${tokens.slice(0, cap).join(" ").replace(/[\s,;:—–.!?]+$/u, "")}…`;
}

/** A model line from a persona's style examples, cut to the target so a prompt never shows an example longer than the answer it asks for. */
export function trimExample(text: string, target: LengthTarget): string {
  const t = text.replace(/\s+/gu, " ").trim();
  return wordCount(t) <= target.aim[1] ? t : trimToCap(t, target.aim[1], target.sentences);
}

// ---- novelty and motif ------------------------------------------------------------------------------------------------

/** A line of the room as the guards read it. */
export type RoomTurn = { speaker: string; text: string };

/**
 * The novelty a candidate must reach: the 10th percentile of the plays' own turn novelty (turns of 7 or more words of 4+ letters, against the
 * 6 turns before). Below it, a turn gives the room back what it just said. `pct` moves the percentile; the default is 10.
 */
export function noveltyFloor(norms: ScriptNorms, lang: ScriptLang, pct = 10): number {
  const found = normsFor(norms, lang);
  return found ? ladderValue(found.block.novelty.judged, pct) : 0;
}

export type NoveltyVerdict = { novelty: number; floor: number };

/** The candidate's novelty against the last 6 room turns when it is below the floor; undefined when it is fine or too short to judge. */
export function lowNovelty(candidate: string, room: readonly RoomTurn[], floor: number): NoveltyVerdict | undefined {
  if (room.length < 3) return undefined;
  const a = analyze({ speaker: "", text: candidate });
  const prior = room.slice(-NOVELTY_WINDOW).map((t) => new Set(analyze(t).content));
  const novelty = noveltyAgainst(a.content, prior, NOVELTY_MIN_CONTENT);
  return novelty !== undefined && novelty < floor ? { novelty, floor } : undefined;
}

export type MotifVerdict = { key: string; family: "phrase" | "frame"; /** The phrase or frame as the candidate wrote it, for a note to name. */ said: string };

/** Turns of the last 6 that must already hold a motif before the candidate counts as bringing it back (2 of 6 plus this one is 3). */
export const MOTIF_PRIOR_TURNS = 2;

/**
 * The candidate re-uses a phrase or a simile frame that 2 of the room's last 6 turns already carry, whoever said them. Topic words are not
 * motifs here: a scene about an envelope says "envelope" often, and real scenes do too (the plays hold such a word in three of ten beats);
 * a three-word phrase or a simile frame in three turns is in about 2 of 100.
 */
export function motifRepeat(candidate: string, room: readonly RoomTurn[], names: ReadonlySet<string>): MotifVerdict | undefined {
  if (room.length < MOTIF_PRIOR_TURNS) return undefined;
  const cand = analyze({ speaker: "", text: candidate });
  const keys = [...motifKeys(cand, names)].filter(([, family]) => family !== "word");
  if (keys.length === 0) return undefined;
  const prior = room.slice(-NOVELTY_WINDOW).map((t) => motifKeys(analyze(t), names));
  // Longest key first, so the note names "pato de perto" and not the shorter phrase inside it.
  keys.sort((a, b) => b[0].length - a[0].length);
  for (const [key, family] of keys) {
    if (prior.filter((m) => m.has(key)).length >= MOTIF_PRIOR_TURNS) return { key, family: family as "phrase" | "frame", said: key.slice(2) };
  }
  return undefined;
}

/** Name keys of the people in a room, for the motif check to leave out (a name said in three turns is address, not a motif). */
export const roomNames = (speakers: Iterable<string>): Set<string> => nameKeys(speakers);

// ---- questions owed ---------------------------------------------------------------------------------------------------

/** What the room said, oldest first, with who the line was aimed at when the log says so. */
export type OwedLine = RoomTurn & {
  /** Folded names or ids this line was aimed at, from the event's addressee list. */
  aimedAt?: readonly string[];
  /** The line is the actor's own. */
  own?: boolean;
};

export type OwedQuestion = { text: string; asker: string; /** Room turns after it. */ age: number };

/**
 * The newest direct question put to `me` that nobody has seen answered: a line of someone else that asks (`?`) and either names me
 * (a vocative: one of `myNames`, folded) or was aimed at me, with `minAge` or more turns after it and none of them mine. `askers` are the
 * room's other speakers; `myTurn` tells which lines are mine.
 */
export function owedQuestion(room: readonly OwedLine[], isMine: (turn: OwedLine) => boolean, myNames: ReadonlySet<string>, myAimId: string | undefined, minAge: number): OwedQuestion | undefined {
  for (let i = room.length - 1; i >= 0; i--) {
    const line = room[i]!;
    if (isMine(line)) return undefined;
    const a = analyze(line);
    if (!a.asks) continue;
    const named = a.words.some((w) => myNames.has(w.key));
    const aimed = myAimId !== undefined && (line.aimedAt ?? []).some((id) => fold(id) === fold(myAimId));
    if (!named && !aimed) continue;
    const age = room.length - 1 - i;
    return age >= minAge ? { text: line.text, asker: line.speaker, age } : undefined;
  }
  return undefined;
}

/** True when the candidate answers before it asks: some non-question sentence, and its first sentence is not a question. */
export function answersFirst(candidate: string): boolean {
  const a: Analyzed = analyze({ speaker: "", text: candidate });
  if (a.sentences.length === 0) return false;
  if (a.sentences[0]!.question) return false;
  return answers(a);
}

/** The candidate without its questions (empty when it was only questions): what is left of a line that asked while it owed an answer. */
export function withoutQuestions(candidate: string): string {
  return sentenceList(candidate)
    .filter((s) => !endsAsQuestion(s))
    .join(" ");
}

/** Letters a name key needs to be matched as a vocative. */
export const MIN_NAME_LETTERS = 3;
export const nameKeysOf = (names: Iterable<string>): Set<string> => new Set([...nameKeys(names)].filter((k) => letterCount(k) >= MIN_NAME_LETTERS));
