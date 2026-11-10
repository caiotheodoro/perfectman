/**
 * Echo, loop and garble checks on one line an actor is about to say (hotel mode).
 *
 * `repetition-guard.ts` compares word SETS (Jaccard 0.7), which a repeat with a changed tail slips under: the same
 * 14-word sentence plus six new words scores 0.67. This module compares word SEQUENCES, so a long shared prefix, a
 * long shared run or a high share of shared trigrams is an echo whatever surrounds it, and it names a tic the actor
 * keeps coming back to. Everything is pure and deterministic; nothing here calls a model.
 *
 * Lines are folded before they are compared: case, accents, punctuation, stage directions ("*sorri*", "(rindo)"),
 * laughter runs ("KKKK", "hahaha", "rsrs") and letter elongation ("siiiim") do not make two lines different.
 */

/** A word of a line: how it was written, and the folded form it is compared by. */
export type Tok = { raw: string; key: string };

const STAGE_DIRECTIONS = [/\*[^*\n]{1,80}\*/g, /\([^()\n]{1,80}\)/g, /\[[^\]\n]{1,80}\]/g, /<[^<>\n]{1,80}>/g];
const SPLIT = /[\s.,;:!?…"“”‘’()[\]{}<>\-–—/\\|]+/u;
const COMBINING = /\p{M}/gu;
const NOT_WORD = /[^\p{L}\p{N}]/gu;
const ELONGATION = /(\p{L})\1{2,}/gu;
const LAUGH = /^(?:k{2,}|(?:ha){2,}h?|(?:he){2,}h?|(?:hi){2,}h?|(?:rs)+|(?:ah){2,}h?|(?:ja){3,}|lol|lmao)$/;

/** Words of `text`, folded, with laughter and decoration dropped. A line that is only a gesture or a laugh has none. */
export function tokenize(text: string): Tok[] {
  let t = text;
  for (const re of STAGE_DIRECTIONS) t = t.replace(re, " ");
  const out: Tok[] = [];
  for (const piece of t.split(SPLIT)) {
    if (piece === "") continue;
    const folded = piece.toLowerCase().normalize("NFKD").replace(COMBINING, "").replace(NOT_WORD, "");
    if (folded === "" || LAUGH.test(folded)) continue;
    out.push({ raw: piece.replace(/^['’]+|['’]+$/gu, ""), key: folded.replace(ELONGATION, "$1") });
  }
  return out;
}

const keysOf = (text: string): string[] => tokenize(text).map((t) => t.key);

/** Folded word sequence of a line as one string: two lines with the same value say the same thing. */
export function foldLine(text: string): string {
  return keysOf(text).join(" ");
}

function commonPrefix(a: readonly string[], b: readonly string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Length of the longest run of words the two lines share, contiguous in both. */
function longestRun(a: readonly string[], b: readonly string[]): number {
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue;
      const run = (prev[j - 1] ?? 0) + 1;
      cur[j] = run;
      if (run > best) best = run;
    }
    prev = cur;
  }
  return best;
}

function trigrams(k: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 3 <= k.length; i++) out.add(`${k[i]} ${k[i + 1]} ${k[i + 2]}`);
  return out;
}

/** Share of the shorter line's trigrams the other line also has: 1 when one line is contained in the other. */
function trigramContainment(a: readonly string[], b: readonly string[]): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  const smaller = ta.size <= tb.size ? ta : tb;
  const larger = smaller === ta ? tb : ta;
  if (smaller.size === 0) return 0;
  let shared = 0;
  for (const g of smaller) if (larger.has(g)) shared++;
  return shared / smaller.size;
}

// ---- echoes ----------------------------------------------------------------

/** Own lines a new line is compared with (the packet keeps 12; the guard's older Jaccard check still reads all of them). */
export const OWN_ECHO_WINDOW = 8;
/** The room's newest lines a new line is compared with for a verbatim echo. */
export const ROOM_ECHO_WINDOW = 4;
/** Words the shorter of two lines needs before a sequence check applies: "Verdade, cara." twice is the older guard's business. */
export const ECHO_MIN_WORDS = 5;

type EchoRule = { prefix: number; run: number; runShare: number; shingle: number; shingleMinWords: number };

/**
 * Own lines: a 6-word shared opening, or a 6-word shared run covering 60% of the shorter line, or 60% of its trigrams.
 * Chosen so a stock frame ("eu acho que você tem ...") shared by two different lines stays under 6 words.
 */
const OWN_RULE: EchoRule = { prefix: 6, run: 6, runShare: 0.6, shingle: 0.6, shingleMinWords: 7 };
/** Another actor's line: only a near-verbatim copy counts, since answering in the other's words is half of talking. */
const ROOM_RULE: EchoRule = { prefix: Number.POSITIVE_INFINITY, run: 5, runShare: 0.7, shingle: 0.7, shingleMinWords: 6 };

export type EchoKind = "exact" | "prefix" | "run" | "shingle";
export type EchoHit = { kind: EchoKind; prior: string };

function echoKind(c: readonly string[], p: readonly string[], rule: EchoRule): EchoKind | undefined {
  const shorter = Math.min(c.length, p.length);
  if (shorter < ECHO_MIN_WORDS) return undefined;
  if (c.length === p.length && c.every((k, i) => k === p[i])) return "exact";
  if (commonPrefix(c, p) >= rule.prefix) return "prefix";
  const run = longestRun(c, p);
  if (run >= rule.run && run >= rule.runShare * shorter) return "run";
  if (shorter >= rule.shingleMinWords && trigramContainment(c, p) >= rule.shingle) return "shingle";
  return undefined;
}

function firstEcho(candidate: string, priors: readonly string[], rule: EchoRule): EchoHit | undefined {
  const c = keysOf(candidate);
  if (c.length < ECHO_MIN_WORDS) return undefined;
  for (const prior of priors) {
    const kind = echoKind(c, keysOf(prior), rule);
    if (kind) return { kind, prior };
  }
  return undefined;
}

/** The candidate repeats, in whole or with a changed tail or a word dropped in, one of the actor's own last lines. */
export function findOwnEcho(candidate: string, ownPriors: readonly string[], window: number = OWN_ECHO_WINDOW): EchoHit | undefined {
  return firstEcho(candidate, ownPriors.slice(-window), OWN_RULE);
}

/** The candidate is a verbatim or near-verbatim copy of one of the other actors' last lines. */
export function findRoomEcho(candidate: string, roomLines: readonly string[], window: number = ROOM_ECHO_WINDOW): EchoHit | undefined {
  return firstEcho(candidate, roomLines.slice(-window), ROOM_RULE);
}

// ---- signature phrases and question frames ---------------------------------

/** Own lines before the candidate that count toward a loop: 2 of these 4 plus the candidate is 3 of the last 5. */
export const LOOP_PRIORS = 4;
const LOOP_GRAM = 4;

/** Words that carry no topic: a phrase made of them alone is grammar, not a tic. */
const STOP = new Set(
  ("a o as os um uma uns umas de do da dos das em no na nos nas ao aos que e é eu tu voce vc ele ela eles elas me te se lhe nos meu minha meus minhas seu sua seus suas " +
    "teu tua pra para por com sem mas ou ja nao sim ne né ta to tem ter foi ser sao vai vou vamos esta estou isso isto esse essa este aquele aquela la ai aqui ali so " +
    "tambem mais muito bem assim entao como quando onde quem qual quanto " +
    "the to of in on at and or is it you your my i we he she they this that for with be do not are was").split(" "),
);

const contentKeys = (toks: readonly Tok[]): Set<string> => new Set(toks.map((t) => t.key).filter((k) => !STOP.has(k) && k.length >= 3));

export type LoopKind = "ngram" | "edge" | "frame";
export type LoopHit = {
  /** The phrase as the candidate wrote it, for the retry note to name. */
  phrase: string;
  kind: LoopKind;
};

function hasGram(keys: readonly string[], gram: readonly string[]): boolean {
  outer: for (let i = 0; i + gram.length <= keys.length; i++) {
    for (let j = 0; j < gram.length; j++) if (keys[i + j] !== gram[j]) continue outer;
    return true;
  }
  return false;
}

const say = (toks: readonly Tok[]): string => toks.map((t) => t.raw).join(" ");

/**
 * The candidate carries a signature phrase or question the actor already used in 2 of its last 4 lines (so 3 of its
 * last 5): a shared phrase of 5 words, or of 4 with 3 topic words, the same opening or closing 3 words ("meu bem... não é, querido?"),
 * or the same question about the same 3 topic words ("você já viu um pato de perto?").
 */
export function findPhraseLoop(candidate: string, ownPriors: readonly string[]): LoopHit | undefined {
  const cand = tokenize(candidate);
  const recent = ownPriors.slice(-LOOP_PRIORS).map((p) => tokenize(p));
  if (cand.length < LOOP_GRAM || recent.length < 2) return undefined;
  const ck = cand.map((t) => t.key);
  const rk = recent.map((r) => r.map((t) => t.key));

  for (let i = 0; i + LOOP_GRAM <= ck.length; i++) {
    const gram = ck.slice(i, i + LOOP_GRAM);
    if (gram.filter((k) => !STOP.has(k)).length < 2) continue;
    if (rk.filter((r) => hasGram(r, gram)).length < 2) continue;
    // The whole shared run, not just its first 4 words with 2 topic words: grow it both ways while 2 priors still hold it.
    let start = i;
    let end = i + LOOP_GRAM;
    const held = (from: number, to: number): boolean => rk.filter((r) => hasGram(r, ck.slice(from, to))).length >= 2;
    while (end < ck.length && held(start, end + 1)) end++;
    while (start > 0 && held(start - 1, end)) start--;
    // A scene about one object names it often ("o envelope do Otávio"): a shared noun phrase alone is not a tic.
    if (end - start < 5 && ck.slice(start, end).filter((k) => !STOP.has(k)).length < 3) continue;
    return { phrase: say(cand.slice(start, end)), kind: "ngram" };
  }

  if (cand.length >= 5) {
    const tail = ck.slice(-3);
    const head = ck.slice(0, 3);
    const same = (rows: readonly string[][], edge: readonly string[], at: "head" | "tail"): number =>
      rows.filter((r) => r.length >= 5 && edge.every((k, j) => k === (at === "head" ? r[j] : r[r.length - 3 + j]))).length;
    if (tail.some((k) => !STOP.has(k)) && same(rk, tail, "tail") >= 2) return { phrase: say(cand.slice(-3)), kind: "edge" };
    if (head.some((k) => !STOP.has(k)) && same(rk, head, "head") >= 2) return { phrase: say(cand.slice(0, 3)), kind: "edge" };
  }

  if (candidate.includes("?")) {
    const topic = contentKeys(cand);
    if (topic.size >= 3) {
      const asked = ownPriors.slice(-LOOP_PRIORS).filter((p) => {
        if (!p.includes("?")) return false;
        const other = contentKeys(tokenize(p));
        const shared = [...topic].filter((k) => other.has(k)).length;
        return shared >= 3 && shared >= 0.6 * Math.min(topic.size, other.size);
      });
      if (asked.length >= 2) return { phrase: say(cand).slice(0, 70), kind: "frame" };
    }
  }
  return undefined;
}

// ---- garbled text ----------------------------------------------------------

/** Letters Portuguese, Spanish, French and English lines use. Anything else in a line is corruption unless the room already wrote it. */
const LETTERS = new Set(Array.from("abcdefghijklmnopqrstuvwxyzàáâãäçèéêëìíîïñòóôõöùúûüªº"));
/** A control, private-use or replacement character; a tab or a line break is ordinary in a chat line. */
const CONTROL = /(?![\t\n\r])[\p{Cc}\p{Co}\uFFFD]/u;
/** No Portuguese word starts with these and carries on: they are two words with the space lost. */
const GLUED = /^(?:umas?[a-z]{6,}|voce[a-z]{4,})$/;
const MAX_WORD = 28;
const MAX_SAME_WORD = 7;

export type GarbleKind = "control" | "letter" | "glued" | "long" | "stuck";
export type GarbleHit = { token: string; kind: GarbleKind };

/**
 * Obviously corrupt text: a replacement or control character, a letter no Portuguese line uses ("Éduğunu"), two words
 * glued by a lost space ("umapreciação"), a word of 28 letters or more, one word seven times running. `seen` is the
 * text the room has already written: a letter or name that is in it (a guest called Łukasz) is not corruption.
 */
export function findGarble(text: string, seen: readonly string[] = []): GarbleHit | undefined {
  const line = text.normalize("NFC");
  const words = line.split(/\s+/u).filter((w) => w !== "");
  const wordWith = (test: (ch: string) => boolean): string => words.find((w) => Array.from(w).some(test)) ?? line.slice(0, 20);

  if (CONTROL.test(line)) return { token: wordWith((ch) => CONTROL.test(ch)), kind: "control" };

  const odd = Array.from(line).filter((ch) => /\p{L}/u.test(ch) && !LETTERS.has(ch.toLowerCase()));
  if (odd.length > 0) {
    const known = new Set(Array.from(seen.join(" ").normalize("NFC")));
    const bad = odd.find((ch) => !known.has(ch));
    if (bad !== undefined) return { token: wordWith((ch) => ch === bad), kind: "letter" };
  }

  const toks = tokenize(line);
  let run = 1;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (GLUED.test(t.key)) return { token: t.raw, kind: "glued" };
    if (t.key.length >= MAX_WORD) return { token: t.raw.slice(0, 40), kind: "long" };
    run = i > 0 && toks[i - 1]!.key === t.key ? run + 1 : 1;
    if (run >= MAX_SAME_WORD && !/^\d+$/.test(t.key)) return { token: t.raw, kind: "stuck" };
  }
  return undefined;
}
