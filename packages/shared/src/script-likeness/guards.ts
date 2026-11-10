import { NOVELTY_MIN_CONTENT, NOVELTY_WINDOW, analyze, motifKeys, noveltyAgainst } from "./metrics.js";
import type { Analyzed } from "./metrics.js";
import { ladderValue, normsFor } from "./norms.js";
import type { ScriptNorms } from "./norms.js";
import {
  ATTRIBUTION_VERBS,
  CLAIM_SUBJECTS,
  NARRATION_VERBS_EN,
  NARRATION_VERBS_PT,
  SPEECH_CUES,
  STOP_WORDS,
  fold,
  letterCount,
  majorMoveOf,
  nameKeys,
  splitAfter,
  stripDirections,
  wordCount,
  wordsOf,
} from "./text.js";
import type { MoveKind, ScriptLang } from "./text.js";

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
 * Words per turn by what the persona's `presence.messageLength` says. `short` is the hotel default, and the default of a persona file and of
 * a builder scene that does not say. Portuguese `short` aims 5 to 12 words with a hard cap of 22: the plays' median is 7 and p75 15, and a
 * production run with a cap of 40 (`medium`, the old compiler default) had a median of 19 words and 26% of its lines over 25. English plays
 * run longer (median 10, p75 21), so its short turn aims 6 to 14 with a cap of 28.
 */
export function lengthTargetFor(messageLength: MessageLength | undefined, lang: ScriptLang): LengthTarget {
  const kind = messageLength ?? "short";
  switch (kind) {
    case "rapid_fire":
      return { aim: [2, 6], cap: 12, sentences: 1 };
    case "short":
      return lang === "pt" ? { aim: [5, 12], cap: 22, sentences: 2 } : { aim: [6, 14], cap: 28, sentences: 2 };
    case "medium":
      return lang === "pt" ? { aim: [10, 20], cap: 40, sentences: 3 } : { aim: [12, 24], cap: 48, sentences: 3 };
    case "long":
      return { aim: [15, 35], cap: 60, sentences: 4 };
  }
}

/** Words of a line the way the length cap counts them (directions and laughter do not count). */
export const lengthOf = (text: string): number => wordCount(text);

const sentenceList = (text: string): string[] => splitAfter(stripDirections(text).trim(), ".!?…");

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
  const parts = splitAfter(first, ",;:—–");
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

/** The actor's own lines the novelty check reads, besides the turn right before. */
export const NOVELTY_OWN_LINES = 3;
/** Room words the check leaves out as the scene's own topic: this many of the most frequent (each in at least 2 lines). */
export const NOVELTY_TOPIC_WORDS = 5;

/**
 * Words the scene keeps talking about, which a candidate may share without repeating anybody: proper nouns (a capitalised word inside a sentence,
 * and the names of the people in the room) and the 5 content words most of the room's lines carry (ties by spelling, so the same room gives the same set).
 */
export function sharedTopicWords(room: readonly RoomTurn[], names: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>(names);
  for (const k of nameKeys(room.map((t) => t.speaker))) out.add(k);
  const lines: Set<string>[] = [];
  for (const t of room) {
    const a = analyze(t);
    for (const w of a.words) if (!w.start && /^\p{Lu}\p{Ll}/u.test(w.raw)) out.add(w.key);
    lines.push(new Set(a.content));
  }
  const count = new Map<string, number>();
  for (const l of lines) for (const k of l) count.set(k, (count.get(k) ?? 0) + 1);
  [...count]
    .filter(([, n]) => n >= 2)
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    .slice(0, NOVELTY_TOPIC_WORDS)
    .forEach(([k]) => out.add(k));
  return out;
}

/**
 * The candidate's novelty when it is below the floor; undefined when it is fine or too short to judge. A line is judged against the actor's own
 * last 3 lines and the turn right before it (whoever said it), not the whole room: three people circling one object share words without any of them
 * repeating himself, and judging against all 6 turns flagged about half of a real run's turns. The scene's topic words (proper nouns, the 5 most
 * frequent room words) never count as seen, and only a line of 7 or more words of 4+ letters is judged. `own` marks the actor's lines in `room`;
 * `opts.self` names the actor when the lines carry no mark.
 */
export function lowNovelty(candidate: string, room: readonly OwedLine[], floor: number, opts: { names?: ReadonlySet<string>; self?: string } = {}): NoveltyVerdict | undefined {
  if (room.length < 3) return undefined;
  const a = analyze({ speaker: "", text: candidate });
  if (a.content.length < NOVELTY_MIN_CONTENT) return undefined;
  const self = opts.self === undefined ? undefined : fold(opts.self);
  const own = room.filter((t) => t.own === true || (self !== undefined && fold(t.speaker) === self)).slice(-NOVELTY_OWN_LINES);
  const before = room[room.length - 1]!;
  const judged = own.includes(before) ? own : [...own, before];
  const topic = sharedTopicWords(room, opts.names);
  const prior = judged.map((t) => new Set(analyze(t).content.filter((k) => !topic.has(k))));
  const raw = noveltyAgainst(a.content, prior, NOVELTY_MIN_CONTENT);
  // The floor is a rounded ladder value (4 places): the candidate is rounded the same way, so a turn exactly on the 10th percentile (5 of 7 words new) is not under it.
  const novelty = raw === undefined ? undefined : Math.round(raw * 10_000) / 10_000;
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
  /** The line is a guest's, not a cast member's: the prompt already shows it quoted and escaped, so a note never repeats its words. */
  untrusted?: boolean;
};

export type OwedQuestion = { text: string; asker: string; /** Room turns after it. */ age: number };

// ---- what counts as an answer (the guard's rule: a filler does not clear a debt) ------------------------------------------------------

/** Folded words that react without answering: the old fallback texts ("Ah.", "Hm.", "Ué.", "Sei.", "Tá.") and their kin. */
export const FILLER_WORDS: ReadonlySet<string> = new Set(
  "ah hm hmm hmmm ue sei ta ok okay aham uhum ne pois bom bem entao oi eita nossa puxa vish ixi huh right well oh uh um".split(" "),
);

/** Folded words that answer by themselves: yes, no, maybe, never, nobody, nothing, and where or when. */
export const ANSWER_WORDS: ReadonlySet<string> = new Set(
  ("sim nao claro nunca jamais talvez ninguem nada tudo ontem hoje amanha agora aqui ali la fui foi " +
    "yes no never maybe nobody nothing sure yesterday today tomorrow now here there").split(" "),
);

/**
 * A reply that answers a question: not only fillers, and either 4 or more words, or a direct yes/no/where/when word or a number, or 2 words with a
 * real one (5+ letters) in them ("Na gaveta."). "Tá." and "Hm, sei." are reactions; the benchmark's own debt metric still takes any 3-word reply as an answer.
 */
export function isRealAnswer(text: string): boolean {
  const keys = wordsOf(text).map((w) => w.key);
  if (keys.length === 0 || keys.every((k) => FILLER_WORDS.has(k))) return false;
  if (keys.length >= 4) return true;
  if (keys.some((k) => ANSWER_WORDS.has(k) || /\d/u.test(k))) return true;
  return keys.length >= 2 && keys.some((k) => letterCount(k) >= 5 && !FILLER_WORDS.has(k));
}

/**
 * The newest direct question put to `me` that nobody has seen answered: a line of someone else that asks (`?`) and either names me
 * (a vocative: one of `myNames`, folded) or was aimed at me, with `minAge` or more turns after it and none of them mine that answers it
 * (a line of mine that is only a filler does not). `askers` are the room's other speakers; `myTurn` tells which lines are mine.
 */
export function owedQuestion(room: readonly OwedLine[], isMine: (turn: OwedLine) => boolean, myNames: ReadonlySet<string>, myAimId: string | undefined, minAge: number): OwedQuestion | undefined {
  for (let i = room.length - 1; i >= 0; i--) {
    const line = room[i]!;
    if (isMine(line)) {
      if (isRealAnswer(line.text)) return undefined;
      continue;
    }
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

/** True when the candidate answers before it asks: its first sentence is not a question, and what it says without its questions is a real answer. */
export function answersFirst(candidate: string): boolean {
  const sentences = sentenceList(candidate);
  if (sentences.length === 0 || endsAsQuestion(sentences[0]!)) return false;
  return isRealAnswer(sentences.filter((x) => !endsAsQuestion(x)).join(" "));
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

// ---- sentences that keep quoted speech whole ------------------------------------------------------------------------------------

const OPEN_QUOTES = "“«";
const CLOSE_QUOTES = "”»";

/** Splits a line after `.`, `!`, `?` and `…` that are followed by white space, never inside a quotation (straight, curly or guillemet). */
export function sentencesOf(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let straight = false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    cur += ch;
    if (ch === '"') straight = !straight;
    else if (OPEN_QUOTES.includes(ch)) depth++;
    else if (CLOSE_QUOTES.includes(ch)) depth = Math.max(0, depth - 1);
    const next = text[i + 1];
    // A sentence ends at an ender followed by white space, or by an ender and the quote or bracket that closes the sentence.
    if ((next === undefined || /\s/u.test(next)) && !straight && depth === 0 && ".!?…".includes(cur.replace(/["”»')\]]+$/u, "").slice(-1))) {
      out.push(cur.trim());
      cur = "";
      while (i + 1 < text.length && /\s/u.test(text[i + 1]!)) i++;
    }
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out.filter((x) => x !== "");
}

// ---- narration in speech ------------------------------------------------------------------------------------------------------------

const QUOTE_CHARS = /["“”«»]/u;
/** Words that may sit before the verb of a narrated sentence ("e olho pra ela", "then I look away"). */
const NARRATION_LEADS: ReadonlySet<string> = new Set("e entao ai then and now".split(" "));
/** A narrated gesture is short: a sentence longer than this is speech. */
export const NARRATION_MAX_WORDS = 14;

/** True when a sentence is stage business said in the first person: it opens with a body verb ("Olho pra ela, sorriso atravessado."), has no quotation, no question and no promise or condition. */
export function isNarration(sentence: string): boolean {
  if (QUOTE_CHARS.test(sentence) || /\?["”')\]]*$/u.test(sentence.trim())) return false;
  const keys = wordsOf(sentence).map((w) => w.key);
  if (keys.length === 0 || keys.length > NARRATION_MAX_WORDS) return false;
  let at = 0;
  if (NARRATION_LEADS.has(keys[0]!) && keys.length > 1) at = 1;
  const first = keys[at]!;
  const opens =
    (first === "me" && NARRATION_VERBS_PT.has(keys[at + 1] ?? "")) ||
    NARRATION_VERBS_PT.has(first) ||
    (first === "i" && NARRATION_VERBS_EN.has(keys[at + 1] ?? ""));
  return opens && !keys.some((k) => SPEECH_CUES.has(k));
}

/**
 * Takes the narrated sentences out of a spoken line: the actor's actions belong in the body channel (`body.gesture`, `body.expression`), and a
 * line that says "Olho pra ela, sorriso atravessado." out loud makes the room hear stage directions. Only whole sentences that open with a
 * first-person present body verb and carry no quotation, question or promise are removed; a quoted span is never split. `text` is empty when nothing but narration was left.
 */
export function stripNarration(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const kept: string[] = [];
  for (const sentence of sentencesOf(text.trim())) {
    if (isNarration(sentence)) removed.push(sentence);
    else kept.push(sentence);
  }
  return { text: kept.join(" "), removed };
}

// ---- quotations and claims that nobody made -----------------------------------------------------------------------------------------

/** The room lines a quotation or a reported claim is checked against: the newest ten. */
export const QUOTE_ROOM_LINES = 10;
/** A quotation needs this many words to be checked: "não" or "vem cá" quoted is a word, not a claim about what was said. */
export const QUOTE_MIN_WORDS = 3;
/** Share of a quotation's trigrams that one room line must hold for the quotation to count as said. */
export const QUOTE_TRIGRAM_SHARE = 0.8;
/** A reported claim ("ela disse que ...") is checked on its content words: at least 3 of them, 60% found in what that speaker said. */
export const CLAIM_MIN_CONTENT = 3;
export const CLAIM_SHARE = 0.6;

export type QuoteIssue = {
  /** The sentence that carries it (what a strike removes). */
  sentence: string;
  /** The words quoted, the word the person was called, or the claim. */
  claim: string;
  kind: "quote" | "called" | "said";
};

const trigramsOf = (keys: readonly string[]): Set<string> => {
  const out = new Set<string>();
  for (let i = 0; i + 3 <= keys.length; i++) out.add(`${keys[i]} ${keys[i + 1]} ${keys[i + 2]}`);
  return out;
};

const runIn = (needle: readonly string[], hay: readonly string[]): boolean => {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

/** Two folded words are one word for this check: equal, or equal but for a final letter ("burro", "burra") or a plural s. */
const sameWord = (a: string, b: string): boolean => {
  if (a === b) return true;
  const x = a.length > 4 && a.endsWith("s") ? a.slice(0, -1) : a;
  const y = b.length > 4 && b.endsWith("s") ? b.slice(0, -1) : b;
  return x === y || (x.length >= 5 && y.length >= 5 && x.slice(0, -1) === y.slice(0, -1));
};

const SUBJECT_SKIP: ReadonlySet<string> = new Set("te me lhe nos vos a o um uma ja entao tambem".split(" "));
/** Third-person singular pronouns: a claim about "ela" or "ele" is about someone in the room only when exactly one other person spoke in view. Plural pronouns are never checked. */
const THIRD_PERSON: ReadonlySet<string> = new Set("ela ele she he".split(" "));
const THIRD_PERSON_PLURAL: ReadonlySet<string> = new Set("eles elas they".split(" "));
const CALL_SKIP: ReadonlySet<string> = new Set("te me lhe nos voce vc ele ela eles elas a o um uma de you him her us me an".split(" "));
const CALL_VERBS: ReadonlySet<string> = new Set(["chamou", "called"]);
const LEADING_THAT: ReadonlySet<string> = new Set(["que", "that", "se"]);

/**
 * Quotations and reported claims in a candidate that the last 10 room lines do not support. Checked: a quoted span of 3 or more words (straight,
 * curly or guillemet quotes) in a sentence that says who said it; "X te chamou de Y" with X a speaker in view (or você: anyone else; or ela or ele, when exactly
 * one other person spoke in view, and never eles or elas), where Y must be a word X said; and "X disse que ..." (the "que" is required) with at least 3 content words, 60% of them in the lines of X (or of anyone else for a pronoun). A quoted
 * span passes when its words run unbroken in one line or 80% of its trigrams are in one; the comparison is folded (case, accents, punctuation, stage directions).
 * What cannot be checked passes: a speaker with no line in view, a quotation or claim with no person to attribute it to (a letter, a saying, someone who is not in the room,
 * "ela" or "ele" when 2 or more other people spoke in view), a claim of fewer than 3 content words.
 */
export function falseQuotes(candidate: string, room: readonly OwedLine[]): QuoteIssue[] {
  const lines = room.slice(-QUOTE_ROOM_LINES).map((l) => ({ line: l, keys: wordsOf(l.text).map((w) => w.key), speaker: nameKeys([l.speaker]) }));
  if (lines.length === 0) return [];
  const otherSpeakers = new Set(lines.filter((l) => !l.line.own).map((l) => fold(l.line.speaker))).size;
  const issues: QuoteIssue[] = [];
  const said = (span: string): boolean => {
    const keys = wordsOf(span).map((w) => w.key);
    if (keys.length === 0) return true;
    const grams = trigramsOf(keys);
    return lines.some((l) => runIn(keys, l.keys) || (grams.size > 0 && [...grams].filter((g) => trigramsOf(l.keys).has(g)).length / grams.size >= QUOTE_TRIGRAM_SHARE));
  };
  for (const sentence of sentencesOf(candidate)) {
    const words = wordsOf(sentence);
    const keys = words.map((w) => w.key);
    if (!keys.some((k) => ATTRIBUTION_VERBS.has(k))) continue;
    // Who each verb of saying is about: the word before it (past a clitic), a speaker in view, "você" (anyone else), or "ela" and "ele" when exactly one other
    // person spoke in view. Anything else (a letter, someone who is not here, a plural pronoun, a speaker with no line in view) is not a claim about this room.
    const attributed: Array<{ v: number; pool: Array<(typeof lines)[number]> }> = [];
    for (let v = 0; v < keys.length; v++) {
      if (!ATTRIBUTION_VERBS.has(keys[v]!)) continue;
      let s = v - 1;
      while (s >= 0 && SUBJECT_SKIP.has(keys[s]!)) s--;
      const subject = keys[s];
      if (subject === undefined || THIRD_PERSON_PLURAL.has(subject) || (THIRD_PERSON.has(subject) && otherSpeakers !== 1)) continue;
      const pool = CLAIM_SUBJECTS.has(subject) ? lines.filter((l) => !l.line.own) : lines.filter((l) => !l.line.own && l.speaker.has(subject));
      if (pool.length > 0) attributed.push({ v, pool });
    }
    if (attributed.length === 0) continue;
    const before = issues.length;
    for (const m of sentence.matchAll(/"([^"]+)"|“([^”]+)”|«([^»]+)»/gu)) {
      const span = m[1] ?? m[2] ?? m[3] ?? "";
      if (wordsOf(span).length >= QUOTE_MIN_WORDS && !said(span)) issues.push({ sentence, claim: span.trim(), kind: "quote" });
    }
    const quoted = QUOTE_CHARS.test(sentence);
    for (const { v, pool } of attributed) {
      const verb = keys[v]!;
      const poolKeys = pool.flatMap((l) => l.keys);
      if (CALL_VERBS.has(verb)) {
        const items: string[] = [];
        let conj = false;
        for (let j = v + 1; j < keys.length && items.length < 3; j++) {
          const k = keys[j]!;
          if (k === "e" || k === "ou" || k === "and" || k === "or") {
            conj = items.length > 0;
            continue;
          }
          if (CALL_SKIP.has(k)) continue;
          if (items.length > 0 && !conj) break;
          items.push(k);
          conj = false;
        }
        for (const y of items) if (letterCount(y) >= 3 && !poolKeys.some((k) => sameWord(k, y))) issues.push({ sentence, claim: words.find((w) => w.key === y)?.raw ?? y, kind: "called" });
      } else if (!quoted && LEADING_THAT.has(keys[v + 1] ?? "")) {
        // Reported speech needs its "que": "falou de futebol" and "fala como quem escolheu" report nothing.
        let c = v + 1;
        while (c < keys.length && LEADING_THAT.has(keys[c]!)) c++;
        const content = words.slice(c).filter((w) => letterCount(w.key) >= 4 && !STOP_WORDS.has(w.key));
        if (content.length < CLAIM_MIN_CONTENT) continue;
        const found = content.filter((w) => poolKeys.some((k) => sameWord(k, w.key))).length;
        if (found / content.length < CLAIM_SHARE) issues.push({ sentence, claim: words.slice(c).map((w) => w.raw).join(" "), kind: "said" });
      }
    }
    // One issue per sentence is enough to strike or to name.
    if (issues.length > before + 1) issues.splice(before + 1);
  }
  return issues;
}

/** The candidate without the sentences that carry an unsupported quotation or claim (empty when nothing else was said). */
export function withoutFalseQuotes(candidate: string, issues: readonly QuoteIssue[]): string {
  const drop = new Set(issues.map((i) => i.sentence));
  return sentencesOf(candidate)
    .filter((x) => !drop.has(x))
    .join(" ");
}

// ---- a move that was just made at this actor ----------------------------------------------------------------------------------------

export type OwedMove = { kind: MoveKind; speaker: string; text: string; /** The line names this actor or was aimed at it; false when it named nobody and was said to the room. */ named: boolean };

/**
 * The move the room's last line made, when it is a reveal, an accusation, a threat or an offer made by someone else and it is this actor's to answer: what
 * this actor must react to before anything else. A line that names someone or is aimed at someone (an addressee or reply target in the log, or a name of a
 * person in the room: `roomNames`, folded) is for that person only; a line that names nobody is for everyone who hears it. Only the turn right before counts
 * (an older one was answered by whoever spoke since, or by silence), a guest's line is left to the prompt's own handling, and a line that makes no such move
 * gives undefined.
 */
export function moveBefore(room: readonly OwedLine[], myNames: ReadonlySet<string>, myAimId: string | undefined, roomNames: ReadonlySet<string> = new Set()): OwedMove | undefined {
  const last = room[room.length - 1];
  if (!last || last.own === true || last.untrusted === true) return undefined;
  const a = analyze(last);
  const kind = majorMoveOf(a.joined);
  if (kind === undefined) return undefined;
  const aimed = last.aimedAt ?? [];
  const named = a.words.some((w) => myNames.has(w.key)) || (myAimId !== undefined && aimed.some((id) => fold(id) === fold(myAimId)));
  if (!named) {
    const speaker = nameKeys([last.speaker]);
    const namesOther = a.words.some((w) => roomNames.has(w.key) && !myNames.has(w.key) && !speaker.has(w.key));
    if (aimed.length > 0 || namesOther) return undefined;
  }
  return { kind, speaker: last.speaker, text: last.text, named };
}
