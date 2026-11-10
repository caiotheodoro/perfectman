import {
  DETERMINERS,
  STOP_WORDS,
  contentKeys,
  detectLang,
  fold,
  isAccusation,
  isCommitment,
  isNumberKey,
  isReveal,
  joinedKeys,
  letterCount,
  nameKeys,
  similesIn,
  stemOf,
  stripDirections,
  wordsOf,
} from "./text.js";
import type { ScriptLang, Word } from "./text.js";
import { isSay } from "./turns.js";
import type { ScriptTurn } from "./turns.js";

/**
 * The script-likeness metrics: what a stretch of dialogue looks like next to real plays, measured, not judged.
 *
 *  - length: words per turn, the share of turns over 25 and 40 words, the share of short replies (5 words or fewer);
 *  - novelty: the share of a turn's words of 4+ letters not seen in the 6 turns before it;
 *  - motif: a phrase, a simile frame or a topic word that recurs in 3 or more turns inside a window (90 s, or 7 turns without times), whoever says it;
 *  - progress: the turns that bring something new (a name, a number, an object) and the ones that move the scene (a promise, an accusation,
 *    a reveal, an act, a reversal of who asks and who answers);
 *  - debt: questions nobody answered within 3 turns.
 *
 * Everything is deterministic and reads only the turns it is given.
 */

export const NOVELTY_WINDOW = 6;
export const MOTIF_WINDOW_TURNS = 7;
export const MOTIF_WINDOW_MS = 90_000;
export const MOTIF_MIN_TURNS = 3;
export const ANSWER_WINDOW = 3;
export const OVER_CAPS = [25, 40] as const;
export const SHORT_REPLY_WORDS = 5;
/** Say turns a stretch needs before its statistics mean anything; fewer is scored but flagged. */
export const MIN_SAY_TURNS = 4;
/** A turn needs this many words of 4+ letters before its novelty is judged (a "Sim, claro." has nothing to be new about). */
export const NOVELTY_MIN_CONTENT = 5;

/** Nearest-rank quantile of a list (q in 0..1). */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))] ?? 0;
}

const mean = (v: readonly number[]): number => (v.length === 0 ? 0 : v.reduce((a, b) => a + b, 0) / v.length);

// ---- per-turn analysis ---------------------------------------------------------------------------------------------

type Sentence = { text: string; question: boolean; words: number };

export type Analyzed = {
  turn: ScriptTurn;
  words: Word[];
  content: string[];
  joined: string;
  sentences: Sentence[];
  asks: boolean;
};

function sentencesOf(text: string): Sentence[] {
  const t = stripDirections(text).trim();
  if (t === "") return [];
  return t
    .split(/(?<=[.!?…])\s+/u)
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((s) => ({ text: s, question: /\?["”')\]]*$/u.test(s), words: wordsOf(s).length }));
}

export function analyze(turn: ScriptTurn): Analyzed {
  const words = wordsOf(turn.text);
  const sentences = sentencesOf(turn.text);
  return { turn, words, content: contentKeys(words), joined: joinedKeys(words), sentences, asks: sentences.some((s) => s.question) };
}

// ---- length and rhythm -------------------------------------------------------------------------------------------------

export type LengthStats = { n: number; mean: number; median: number; p75: number; p90: number; over25: number; over40: number; short: number };

export function lengthStats(counts: readonly number[]): LengthStats {
  const n = counts.length;
  const share = (pred: (c: number) => boolean): number => (n === 0 ? 0 : counts.filter(pred).length / n);
  return {
    n,
    mean: mean(counts),
    median: quantile(counts, 0.5),
    p75: quantile(counts, 0.75),
    p90: quantile(counts, 0.9),
    over25: share((c) => c > OVER_CAPS[0]),
    over40: share((c) => c > OVER_CAPS[1]),
    short: share((c) => c <= SHORT_REPLY_WORDS),
  };
}

export type RhythmStats = { runMean: number; cutOff: number; trailOff: number };

/** Turns per speaker run (a speaker talking again with nobody between), and the shares of turns that end cut off ("—") or trailing ("..."). */
export function rhythmStats(say: readonly Analyzed[]): RhythmStats {
  if (say.length === 0) return { runMean: 0, cutOff: 0, trailOff: 0 };
  const runs: number[] = [];
  let run = 0;
  let prev = "";
  for (const a of say) {
    const who = a.turn.speaker.toLowerCase();
    if (who === prev) run++;
    else {
      if (run > 0) runs.push(run);
      run = 1;
      prev = who;
    }
  }
  runs.push(run);
  let cut = 0;
  let trail = 0;
  for (const a of say) {
    const t = stripDirections(a.turn.text).trim();
    if (/(?:—|–|--)["”']?$/u.test(t) || /^(?:—|–|--)/u.test(t)) cut++;
    else if (/(?:\.\.\.|…)["”']?$/u.test(t)) trail++;
  }
  return { runMean: mean(runs), cutOff: cut / say.length, trailOff: trail / say.length };
}

// ---- novelty ----------------------------------------------------------------------------------------------------------------

/** Share of the candidate's 4+ letter words that none of the `previous` turns' sets hold. Undefined when it has too few words to judge. */
export function noveltyAgainst(content: readonly string[], previous: ReadonlyArray<ReadonlySet<string>>, minContent = NOVELTY_MIN_CONTENT): number | undefined {
  if (content.length < minContent) return undefined;
  const seen = new Set<string>();
  for (const p of previous.slice(-NOVELTY_WINDOW)) for (const k of p) seen.add(k);
  return content.filter((k) => !seen.has(k)).length / content.length;
}

export type NoveltyStats = {
  /** Mean over turns with at least one 4+ letter word, after the first turn (the owner's definition). */
  mean: number;
  /** Every such turn's novelty, in order. */
  values: number[];
  /** Novelty of turns with at least {@link NOVELTY_MIN_CONTENT} words of 4+ letters, for the guard's floor. */
  judged: number[];
};

export function noveltyStats(say: readonly Analyzed[]): NoveltyStats {
  const values: number[] = [];
  const judged: number[] = [];
  const sets: Array<Set<string>> = [];
  say.forEach((a, i) => {
    if (i > 0 && a.content.length > 0) {
      const v = noveltyAgainst(a.content, sets, 1);
      if (v !== undefined) values.push(v);
      const j = noveltyAgainst(a.content, sets);
      if (j !== undefined) judged.push(j);
    }
    sets.push(new Set(a.content));
  });
  return { mean: mean(values), values, judged };
}

// ---- motifs --------------------------------------------------------------------------------------------------------------------

export type MotifFamily = "phrase" | "frame" | "word";
export type MotifHit = { key: string; family: MotifFamily; turns: number[]; speakers: string[]; cross: boolean };

const isTopicWord = (w: Word, names: ReadonlySet<string>): boolean => letterCount(w.key) >= 3 && !STOP_WORDS.has(w.key) && !names.has(w.key) && !isNumberKey(w.key);

/** Motif keys of one turn: phrase grams (2 or 3 words, two of them topic words), simile frames, and topic-word stems. */
export function motifKeys(a: Analyzed, names: ReadonlySet<string>): Map<string, MotifFamily> {
  const out = new Map<string, MotifFamily>();
  const w = a.words;
  for (const word of w) {
    if (letterCount(word.key) >= 5 && !STOP_WORDS.has(word.key) && !names.has(word.key) && !isNumberKey(word.key) && !(!word.start && /^\p{Lu}\p{Ll}/u.test(word.raw))) out.set(`w:${stemOf(word.key)}`, "word");
  }
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i + n <= w.length; i++) {
      const g = w.slice(i, i + n);
      if (g.slice(1).some((x) => x.start)) continue;
      const topic = g.filter((x) => isTopicWord(x, names)).length;
      const ok = n === 2 ? topic === 2 : topic >= 2 && isTopicWord(g[0]!, names) && isTopicWord(g[n - 1]!, names);
      if (ok) out.set(`p:${g.map((x) => x.key).join(" ")}`, "phrase");
    }
  }
  for (const frame of similesIn(a.joined)) out.set(`f:${frame}`, "frame");
  return out;
}

/**
 * Motifs: a key that three turns share inside a window of 90 s (when the turns carry times) or 7 turns, whoever says it. A key that a longer
 * key of the same turns already covers (the phrase "pato de perto" over "pato perto") is reported once.
 */
export function findMotifs(say: readonly Analyzed[], names: ReadonlySet<string>): MotifHit[] {
  const keys = say.map((a) => motifKeys(a, names));
  const byKey = new Map<string, number[]>();
  keys.forEach((m, i) => {
    for (const k of m.keys()) byKey.set(k, [...(byKey.get(k) ?? []), i]);
  });
  const timed = say.every((a) => typeof a.turn.atMs === "number");
  const hits: MotifHit[] = [];
  for (const [key, idx] of byKey) {
    if (idx.length < MOTIF_MIN_TURNS) continue;
    const inHit = new Set<number>();
    for (let j = 0; j + MOTIF_MIN_TURNS <= idx.length; j++) {
      const first = idx[j]!;
      const last = idx[j + MOTIF_MIN_TURNS - 1]!;
      const within = timed ? say[last]!.turn.atMs! - say[first]!.turn.atMs! <= MOTIF_WINDOW_MS : last - first < MOTIF_WINDOW_TURNS;
      if (within) for (let k = j; k < j + MOTIF_MIN_TURNS; k++) inHit.add(idx[k]!);
    }
    if (inHit.size === 0) continue;
    const turns = [...inHit].sort((a, b) => a - b);
    const speakers = [...new Set(turns.map((t) => say[t]!.turn.speaker.toLowerCase()))];
    hits.push({ key, family: keys[turns[0]!]!.get(key)!, turns, speakers, cross: speakers.length > 1 });
  }
  return hits.filter((h) => !hits.some((o) => o !== h && o.family === h.family && o.key.length > h.key.length && o.key.includes(h.key.slice(2)) && h.turns.every((t) => o.turns.includes(t))));
}

const share = (hits: readonly MotifHit[], families: readonly MotifFamily[], total: number): number => {
  const turns = new Set<number>();
  for (const h of hits) if (families.includes(h.family)) for (const t of h.turns) turns.add(t);
  return total === 0 ? 0 : turns.size / total;
};

/** Share of turns that repeat a run of 4 words (two of them topic words) of one of the 6 turns before. */
export function echoShare(say: readonly Analyzed[], names: ReadonlySet<string>): number {
  if (say.length < 2) return 0;
  const grams = say.map((a) => {
    const g = new Set<string>();
    for (let i = 0; i + 4 <= a.words.length; i++) {
      const run = a.words.slice(i, i + 4);
      if (run.slice(1).some((x) => x.start)) continue;
      if (run.filter((x) => isTopicWord(x, names)).length >= 2) g.add(run.map((x) => x.key).join(" "));
    }
    return g;
  });
  let echoed = 0;
  for (let i = 1; i < say.length; i++) {
    const prior = grams.slice(Math.max(0, i - NOVELTY_WINDOW), i);
    if ([...grams[i]!].some((g) => prior.some((p) => p.has(g)))) echoed++;
  }
  return echoed / say.length;
}

// ---- progress and debt -----------------------------------------------------------------------------------------------------

export type ProgressKind = "entity" | "number" | "object" | "commitment" | "accusation" | "reveal" | "act" | "reversal" | "answer";
export type ProgressEvent = { kind: ProgressKind; /** Index among all the turns pushed. */ turn: number; atMs?: number };
/** Events that move the scene; the others only add a fact to it. */
export const MAJOR_KINDS: ReadonlySet<ProgressKind> = new Set(["commitment", "accusation", "reveal", "act", "reversal"]);

export type OpenQuestion = { turn: number; sayIndex: number; asker: string; addressee?: string; answered: boolean; age: number };

/** Whether a turn is an answer to a question put to its speaker: a statement, or a very short reply that is not itself a question. */
export function answers(a: Analyzed): boolean {
  if (a.sentences.length === 0) return false;
  if (!a.asks && a.words.length <= 3) return true;
  return a.sentences.some((s) => !s.question && s.words >= 2) || (!a.asks && a.words.length > 0);
}

/**
 * Incremental progress and question-debt tracking, one turn at a time: the batch metrics and the live scene spine read the same thing.
 * Names of the people in the scene are given up front when known (so a speaker's own name is never "new"), and learned from each speaker.
 */
export class ProgressTracker {
  readonly events: ProgressEvent[] = [];
  readonly questions: OpenQuestion[] = [];
  private readonly names = new Set<string>();
  private readonly owner = new Map<string, string>();
  private readonly seenStems = new Set<string>();
  private readonly seenEntities = new Set<string>();
  private readonly seenNumbers = new Set<string>();
  private turnIndex = 0;
  private sayIndex = 0;
  private lastAsker = "";
  private answerer = "";
  private reversals = 0;

  constructor(opts: { names?: Iterable<string> } = {}) {
    for (const n of opts.names ?? []) this.learn(n);
  }

  private learn(speaker: string): void {
    for (const k of nameKeys([speaker])) {
      this.names.add(k);
      if (!this.owner.has(k)) this.owner.set(k, speaker.toLowerCase());
    }
  }

  get say(): number {
    return this.sayIndex;
  }
  get reversalCount(): number {
    return this.reversals;
  }
  get nameSet(): ReadonlySet<string> {
    return this.names;
  }

  /** Feeds one turn; returns what it brought. */
  push(turn: ScriptTurn): ProgressEvent[] {
    const index = this.turnIndex++;
    const at = typeof turn.atMs === "number" ? { atMs: turn.atMs } : {};
    const out: ProgressEvent[] = [];
    const add = (kind: ProgressKind): void => {
      const e: ProgressEvent = { kind, turn: index, ...at };
      out.push(e);
      this.events.push(e);
    };
    if (!isSay(turn)) {
      add("act");
      return out;
    }
    if (turn.speaker !== "") this.learn(turn.speaker);
    const a = analyze(turn);
    const who = turn.speaker.toLowerCase();
    const sayIndex = this.sayIndex++;

    // New information: a name, a number, an object introduced by a determiner that nobody has named yet.
    const newEntity = a.words.some((w, i) => {
      if (w.start || i === 0 || !/^\p{Lu}\p{Ll}/u.test(w.raw) || this.names.has(w.key) || STOP_WORDS.has(w.key)) return false;
      return !this.seenEntities.has(w.key);
    });
    const newNumber = a.words.some((w) => isNumberKey(w.key) && !this.seenNumbers.has(w.key));
    const newObject = a.words.some((w, i) => {
      const prev = a.words[i - 1];
      return prev !== undefined && DETERMINERS.has(prev.key) && letterCount(w.key) >= 4 && !STOP_WORDS.has(w.key) && !this.names.has(w.key) && !this.seenStems.has(stemOf(w.key));
    });
    if (newEntity) add("entity");
    if (newNumber) add("number");
    if (newObject) add("object");
    if (isCommitment(a.joined)) add("commitment");
    if (isAccusation(a.joined)) add("accusation");
    if (isReveal(a.joined)) add("reveal");

    // Questions put to this speaker, answered or not.
    let answered = false;
    for (const q of this.questions) {
      if (q.answered || q.asker === who) continue;
      const mine = q.addressee === undefined || q.addressee === who;
      if (mine && answers(a)) {
        q.answered = true;
        answered = true;
      }
    }
    if (answered) add("answer");
    for (const q of this.questions) if (!q.answered && q.asker !== who) q.age++;

    // Who asks and who answers swaps: the one who just answered now asks the one who asked.
    if (a.asks) {
      if (this.answerer === who && this.lastAsker !== "" && this.lastAsker !== who) {
        this.reversals++;
        add("reversal");
      }
      this.lastAsker = who;
      this.answerer = "";
      const named = a.words.map((w) => w.key).find((k) => this.owner.has(k) && this.owner.get(k) !== who);
      const addressee = named === undefined ? undefined : this.owner.get(named);
      this.questions.push({ turn: index, sayIndex, asker: who, ...(addressee !== undefined ? { addressee } : {}), answered: false, age: 0 });
    } else if (this.lastAsker !== "" && this.lastAsker !== who && answers(a)) {
      this.answerer = who;
    }

    for (const w of a.words) {
      if (letterCount(w.key) >= 4) this.seenStems.add(stemOf(w.key));
      if (!w.start && /^\p{Lu}\p{Ll}/u.test(w.raw)) this.seenEntities.add(w.key);
      if (isNumberKey(w.key)) this.seenNumbers.add(w.key);
    }
    return out;
  }

  /** Questions aimed at `who` that have gone `minAge` or more turns by others without an answer. */
  owed(who: string, minAge: number): OpenQuestion[] {
    const w = who.toLowerCase();
    return this.questions.filter((q) => !q.answered && q.addressee === w && q.age >= minAge);
  }
}

export type ProgressStats = {
  events: ProgressEvent[];
  /** Turns (say and act) that brought anything. */
  progressTurns: number;
  majorEvents: number;
  /** Major events per 10 say turns. */
  majorPer10: number;
  /** The most say turns in a row with no major event. */
  stall: number;
  reversals: number;
};

export type DebtStats = { questions: number; unanswered: number; rate: number; open: number };

/** Progress and question debt of a list of turns (act turns included). */
export function progressAndDebt(turns: readonly ScriptTurn[], names: Iterable<string> = []): { progress: ProgressStats; debt: DebtStats; tracker: ProgressTracker } {
  const tracker = new ProgressTracker({ names });
  const majorAt: boolean[] = [];
  for (const t of turns) {
    const ev = tracker.push(t);
    majorAt.push(ev.some((e) => MAJOR_KINDS.has(e.kind)));
  }
  let stall = 0;
  let run = 0;
  turns.forEach((t, i) => {
    if (majorAt[i]) run = 0;
    else if (isSay(t)) run++;
    stall = Math.max(stall, run);
  });
  const sayN = turns.filter(isSay).length;
  const majorEvents = tracker.events.filter((e) => MAJOR_KINDS.has(e.kind)).length;
  const progressTurns = new Set(tracker.events.map((e) => e.turn)).size;
  // A question is judged once the scene has gone ANSWER_WINDOW turns past it; later ones are still open, not owed.
  const judged = tracker.questions.filter((q) => sayN - 1 - q.sayIndex >= ANSWER_WINDOW);
  const unanswered = judged.filter((q) => !q.answered).length;
  return {
    progress: { events: tracker.events, progressTurns, majorEvents, majorPer10: sayN === 0 ? 0 : (majorEvents / sayN) * 10, stall, reversals: tracker.reversalCount },
    debt: { questions: judged.length, unanswered, rate: judged.length === 0 ? 0 : unanswered / judged.length, open: tracker.questions.filter((q) => !q.answered).length - unanswered },
    tracker,
  };
}

// ---- all of it ---------------------------------------------------------------------------------------------------------------------

export type ScriptStats = {
  language: ScriptLang;
  sayTurns: number;
  actTurns: number;
  speakers: number;
  length: LengthStats;
  rhythm: RhythmStats;
  novelty: NoveltyStats;
  motifs: MotifHit[];
  /** Share of say turns in a phrase or simile-frame motif. */
  loopTurns: number;
  /** Share of say turns in a topic-word motif (a word three turns keep coming back to; real scenes have these). */
  topicTurns: number;
  echoTurns: number;
  progress: ProgressStats;
  debt: DebtStats;
  /** Fewer say turns than {@link MIN_SAY_TURNS}: the numbers are there, the verdict is weak. */
  lowN: boolean;
};

export type StatsOptions = { language?: ScriptLang; names?: Iterable<string> };

export function computeScriptStats(turns: readonly ScriptTurn[], opts: StatsOptions = {}): ScriptStats {
  const sayList = turns.filter(isSay);
  const say = sayList.map(analyze);
  const language = opts.language ?? detectLang(sayList.map((t) => t.text));
  const speakers = new Set(sayList.map((t) => t.speaker.toLowerCase()));
  const { progress, debt, tracker } = progressAndDebt(turns, [...(opts.names ?? []), ...sayList.map((t) => t.speaker)]);
  const names = tracker.nameSet;
  const motifs = findMotifs(say, names);
  return {
    language,
    sayTurns: say.length,
    actTurns: turns.length - say.length,
    speakers: speakers.size,
    length: lengthStats(say.map((a) => a.words.length)),
    rhythm: rhythmStats(say),
    novelty: noveltyStats(say),
    motifs,
    loopTurns: share(motifs, ["phrase", "frame"], say.length),
    topicTurns: share(motifs, ["word"], say.length),
    echoTurns: echoShare(say, names),
    progress,
    debt,
    lowN: say.length < MIN_SAY_TURNS,
  };
}

/** Folded form of a name or label, for matching a speaker against a vocative. */
export const foldName = (s: string): string => fold(s).trim();
