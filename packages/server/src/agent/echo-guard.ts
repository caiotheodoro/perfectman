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
 *
 * Short lines (a median turn is 13 words) are compared a second way, on what they SAY: names and forms of address ("Otávio, meu bem,",
 * "rapaz", "minha cara") are taken off the ends of each clause, then the opening words and the set of topic words are compared. The
 * sequence thresholds above are unchanged for long lines; the short-line rules are in the "short lines" section below.
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

/**
 * How a line repeats another: "exact", "prefix", "run" and "shingle" read the words as written; "lead", "open", "set" and "frame" are the short-line
 * rules, which read what a line says with names and forms of address taken off (see `shortEcho`).
 */
export type EchoKind = "exact" | "prefix" | "run" | "shingle" | "lead" | "open" | "set" | "frame";
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

/**
 * The candidate repeats, in whole or with a changed tail or a word dropped in, one of the actor's own last lines. Long lines are judged by their word
 * sequences; a short one is also judged by what it says, with the names in `names` (folded, the people in the room) and forms of address taken off
 * (`short` false leaves that out: the sequence rules alone, as before the short-line rules).
 */
export function findOwnEcho(candidate: string, ownPriors: readonly string[], window: number = OWN_ECHO_WINDOW, names: ReadonlySet<string> = NO_NAMES, short = true): EchoHit | undefined {
  const priors = ownPriors.slice(-window);
  return firstEcho(candidate, priors, OWN_RULE) ?? (short ? shortEcho(candidate, priors, names) : undefined);
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

// ---- short lines ---------------------------------------------------------------

/**
 * Forms of address, folded. "Otávio, meu bem, sente-se." and "Renato, querido, sente-se." say the same thing, and so do "Vinho não, minha cara."
 * and "Vinho não." So names of the room's people and these forms are taken off the ends of every clause before two lines are compared, and the
 * ones that are not names are what a vocative tic is made of.
 */
const ADDRESS_WORDS = new Set(
  ("rapaz rapazes moco moca cara caro mano mana manos manas mina bicho amigo amiga amigos amigas parceiro parceira parca chefe colega querido querida queridos queridas amor amorzinho " +
    "anjo benzinho nego nega senhor senhora senhores dona doutor doutora patrao patroa irmao irma irmaos gente pessoal galera " +
    "man dude buddy pal sir madam honey dear darling mate bro sweetie friend friends folks guys boys girls").split(" "),
);
/** "meu", "minha" or "my" followed by one of these is one form of address ("meu bem", "minha cara", "my dear"). */
const ADDRESS_POSSESSIVE = new Set(["meu", "minha", "my"]);
const ADDRESS_AFTER_POSSESSIVE = new Set(
  ("bem cara caro amor querido querida anjo filho filha amigo amiga irmao irma velho velha linda lindo rapaz senhor senhora chapa parceiro mano mana bicho " +
    "dear friend love lord lady boy girl man").split(" "),
);
/** Interjections at the edge of a clause that say nothing ("Pô, ...", "..., né?"). */
const EDGE_FILLERS = new Set("po ue uai ah oh hm hmm hum ne ei eh vish nossa puxa ixi ok okay hein well".split(" "));
/** Connectors a line may open with that are not its subject: skipped when the first words of two lines are compared ("Mas vinho não" opens like "Vinho não"). */
const CONNECTORS = new Set("mas e entao ai pois bom olha ta and but so".split(" "));
/** One word that ends a tag question ("..., né?", "..., certo?"); "não" and a verb is the other kind ("..., não pode?"). */
const TAG_WORDS = new Set("ne certo hein ta entende entendeu sabe viu ok okay right".split(" "));

const NO_NAMES: ReadonlySet<string> = new Set();

/** Function words `STOP` leaves out, so the topic words of a short line are the ones that name something. */
const MORE_STOP = new Set(
  ("pode podem quer quero faz fazer disse diz tudo nada algo todo toda todos todas cada outro outra qualquer mesmo mesma tanto entre sobre desde pois porque num numa pro nem dele dela deles delas " +
    "nosso nossa voces vcs sei sabe tinha tinham havia seja sido pelo pela pelos pelas aquilo ate dar deu dei vem vim vir ficar fica ficou ver vejo veja olha olhe vou vai vamos ir fui " +
    "mim ti si comigo contigo consigo dois ainda depois antes agora hoje seu sua seus suas").split(" "),
);

/** A folded word that names something: not a function word, 3 letters or more. */
const isTopicWord = (k: string): boolean => k.length >= 3 && !STOP.has(k) && !MORE_STOP.has(k);
/** One stem for a word and its plural ("carta", "cartas"). */
const stem = (k: string): string => (k.length > 4 && k.endsWith("s") ? k.slice(0, -1) : k);

type AddressAt = { len: number; /** The form of address as folded words, "" for a name or a filler. */ term: string };

/** The form of address, name or filler at the start of `keys`, if there is one. */
function addressAtStart(keys: readonly string[], names: ReadonlySet<string>): AddressAt | undefined {
  const k = keys[0];
  if (k === undefined) return undefined;
  const next = keys[1];
  if (ADDRESS_POSSESSIVE.has(k) && next !== undefined && ADDRESS_AFTER_POSSESSIVE.has(next)) return { len: 2, term: `${k} ${next}` };
  if (names.has(k)) return { len: 1, term: "" };
  if (ADDRESS_WORDS.has(k)) return { len: 1, term: k };
  if (EDGE_FILLERS.has(k)) return { len: 1, term: "" };
  return undefined;
}

/** The same at the end of `keys`. */
function addressAtEnd(keys: readonly string[], names: ReadonlySet<string>): AddressAt | undefined {
  const n = keys.length;
  const k = keys[n - 1];
  if (k === undefined) return undefined;
  const before = keys[n - 2];
  if (before !== undefined && ADDRESS_POSSESSIVE.has(before) && ADDRESS_AFTER_POSSESSIVE.has(k)) return { len: 2, term: `${before} ${k}` };
  if (names.has(k)) return { len: 1, term: "" };
  if (ADDRESS_WORDS.has(k)) return { len: 1, term: k };
  if (EDGE_FILLERS.has(k)) return { len: 1, term: "" };
  return undefined;
}

const CLAUSE = /([^.,;:!?…"“”()[\]{}<>–—]+)([.,;:!?…"“”()[\]{}<>–—]*)/gu;

/** One clause of a line: its written words, the folded key of each ("" for a word that is only laughter or decoration) and the punctuation after it. */
type Clause = {
  words: string[];
  keys: string[];
  sep: string;
  /** Indexes into `words` of the words that carry a key. */
  at: number[];
  /** The forms of address, names and fillers on the left edge (in order, `from`..`to` in `at` positions) and on the right edge. */
  left: Array<{ term: string; from: number; to: number }>;
  right: Array<{ term: string; from: number; to: number }>;
  /** Everything in the clause is address: it is a vocative on its own ("Rapaz.", "minha cara,"). */
  addressOnly: boolean;
};

function clausesOf(text: string, names: ReadonlySet<string>): Clause[] {
  let t = text;
  for (const re of STAGE_DIRECTIONS) t = t.replace(re, " ");
  const out: Clause[] = [];
  for (const m of t.matchAll(CLAUSE)) {
    const words = (m[1] ?? "").trim().split(/\s+/u).filter((w) => w !== "");
    if (words.length === 0) continue;
    const keys = words.map((w) => {
      const toks = tokenize(w);
      return toks.length === 0 ? "" : toks.map((x) => x.key).join(" ");
    });
    const at = keys.flatMap((k, i) => (k === "" ? [] : [i]));
    if (at.length === 0) continue;
    const ck = at.map((i) => keys[i]!);
    const left: Clause["left"] = [];
    let lo = 0;
    for (let a = addressAtStart(ck.slice(lo), names); a !== undefined; a = addressAtStart(ck.slice(lo), names)) {
      left.push({ term: a.term, from: lo, to: lo + a.len });
      lo += a.len;
    }
    const right: Clause["right"] = [];
    let hi = ck.length;
    for (let a = hi > lo ? addressAtEnd(ck.slice(lo, hi), names) : undefined; a !== undefined; a = hi > lo ? addressAtEnd(ck.slice(lo, hi), names) : undefined) {
      right.push({ term: a.term, from: hi - a.len, to: hi });
      hi -= a.len;
    }
    out.push({ words, keys, sep: m[2] ?? "", at, left, right, addressOnly: lo >= ck.length });
  }
  return out;
}

/** A line read for what it says: address taken off, then its words, its topic words and how it opens and closes. */
export type Voice = {
  /** Folded words without names, forms of address and edge fillers. */
  keys: string[];
  /** Topic words in order, one stem each, no name. */
  topics: string[];
  /** The forms of address (not names) the line opens with and ends with, folded: "querido", "minha cara". */
  leadTerms: string[];
  trailTerms: string[];
  /** The line ends with a tag question ("..., não pode?", "..., né?"). */
  tag: boolean;
};

/** The words of a clause that say something: those between its address edges. */
function sayingKeys(c: Clause): string[] {
  const from = c.left.length === 0 ? 0 : c.left[c.left.length - 1]!.to;
  const to = c.right.length === 0 ? c.at.length : c.right[c.right.length - 1]!.from;
  return c.at.slice(from, to).flatMap((i) => c.keys[i]!.split(" "));
}

/** A line read for what it says (see {@link Voice}). `names` are the folded names of the people in the room. */
export function voiceOf(text: string, names: ReadonlySet<string> = NO_NAMES): Voice {
  const clauses = clausesOf(text, names);
  const kept = clauses.filter((c) => !c.addressOnly);
  const keys = kept.flatMap(sayingKeys);
  const topics: string[] = [];
  for (const k of keys) {
    const s = stem(k);
    if (isTopicWord(k) && !names.has(k) && !topics.includes(s)) topics.push(s);
  }
  const leadTerms: string[] = [];
  for (const c of clauses) {
    leadTerms.push(...c.left.map((e) => e.term).filter((x) => x !== ""));
    if (!c.addressOnly) break;
  }
  const trailTerms: string[] = [];
  for (let i = clauses.length - 1; i >= 0; i--) {
    const c = clauses[i]!;
    trailTerms.push(...(c.addressOnly ? c.left : c.right).map((e) => e.term).filter((x) => x !== ""));
    if (!c.addressOnly) break;
  }
  // A tag question is the last clause of the line, a comma after the one before it: "..., não pode?", "..., né?" (the filler "né" is a clause of its own here).
  const last = clauses[clauses.length - 1];
  const before = clauses[clauses.length - 2];
  const tail = last === undefined ? [] : last.at.map((i) => last.keys[i]!);
  const tag =
    last !== undefined &&
    before !== undefined &&
    !before.addressOnly &&
    last.sep.includes("?") &&
    before.sep.includes(",") &&
    tail.length >= 1 &&
    tail.length <= 3 &&
    (tail[0] === "nao" || (tail.length === 1 && TAG_WORDS.has(tail[0]!)));
  return { keys, topics, leadTerms, trailTerms, tag };
}

/** First `n` folded words of a voice, a leading connector ("mas", "e", "então") skipped. */
function opening(v: Voice, n: number): string[] {
  let from = 0;
  while (from < v.keys.length - n && CONNECTORS.has(v.keys[from]!)) from++;
  return v.keys.slice(from, from + n);
}

const sharedCount = (a: readonly string[], b: readonly string[]): number => a.filter((k) => b.includes(k)).length;

/** Topic words each line needs before the "open" and "set" rules apply: "Vinho não." has one, and a line of one is never a repeat of another. */
export const SHORT_MIN_TOPICS = 3;
/** The share of the shorter line's topic words the other holds, when both open with the same 3 words ("Bêbado, sim. Mas viu o que você escondeu" and "Bêbado, sim. Mas o que ele viu"). */
export const SHORT_OPEN_SHARE = 0.5;
/** The share of topic words two lines hold in common, in any order (Jaccard). */
export const SHORT_SET_SHARE = 0.6;
/** Own lines before the candidate that count toward a shared opening: 2 of these 5 plus the candidate is 3 of the last 6 turns. */
export const FRAME_PRIORS = 5;
/** Words of a written opening (names and address included) two lines of the actor may share: "Otávio, meu bem, sente-se." is 5 of them. */
export const LEAD_WORDS = 4;

/** Written words at the start of a line that are names, forms of address or fillers ("Otávio, meu bem," is 3). */
function leadingAddress(keys: readonly string[], names: ReadonlySet<string>): number {
  let at = 0;
  for (let a = addressAtStart(keys, names); a !== undefined; a = addressAtStart(keys.slice(at), names)) at += a.len;
  return at;
}

function shortKind(cand: string, prior: string, c: Voice, p: Voice, names: ReadonlySet<string>): EchoKind | undefined {
  if (c.keys.length >= 2 && c.keys.length === p.keys.length && c.keys.every((k, i) => k === p.keys[i])) return "exact";
  const ck = keysOf(cand);
  const run = commonPrefix(ck, keysOf(prior));
  if (run >= LEAD_WORDS) {
    // The same address and then the same words ("Otávio, meu bem, sente-se"): the vocative is what makes a stock opening ("eu acho que você") a tic of this actor.
    const addr = leadingAddress(ck, names);
    if (addr > 0 && run - addr >= 2 && ck.slice(addr, run).some((k) => isTopicWord(k) && !names.has(k))) return "lead";
  }
  if (c.topics.length < SHORT_MIN_TOPICS || p.topics.length < SHORT_MIN_TOPICS) return undefined;
  const shared = sharedCount(c.topics, p.topics);
  const co = opening(c, 3);
  const po = opening(p, 3);
  if (co.length === 3 && co.every((k, i) => k === po[i]) && shared >= SHORT_OPEN_SHARE * Math.min(c.topics.length, p.topics.length)) return "open";
  if (shared / (c.topics.length + p.topics.length - shared) >= SHORT_SET_SHARE) return "set";
  return undefined;
}

/**
 * Short lines: the candidate against the actor's own last lines, by what it says. Flagged when, with names and forms of address taken off (so
 * "Otávio, meu bem, sente-se." compares by "sente-se"): the two say the same words ("exact"); they open with the same names, address and 4 words
 * or more ("lead"); they open with the same 3 words and the shorter one has half its topic words in the other ("open"); they share 60% of their
 * topic words in any order ("set"); or the same first 2 words open the candidate and 2 of the actor's previous 5 lines ("frame"). "open" and "set"
 * need 3 topic words in each line. The prior returned is the line that matched (for "frame", the newest).
 */
function shortEcho(candidate: string, priors: readonly string[], names: ReadonlySet<string>): EchoHit | undefined {
  const c = voiceOf(candidate, names);
  if (c.keys.length < 2) return undefined;
  const voices = priors.map((p) => voiceOf(p, names));
  for (let i = priors.length - 1; i >= 0; i--) {
    const kind = shortKind(candidate, priors[i]!, c, voices[i]!, names);
    if (kind) return { kind, prior: priors[i]! };
  }
  const head = opening(c, 2);
  if (head.length === 2 && head.some(isTopicWord)) {
    const same: string[] = [];
    for (let i = Math.max(0, priors.length - FRAME_PRIORS); i < priors.length; i++) {
      const h = opening(voices[i]!, 2);
      if (h[0] === head[0] && h[1] === head[1]) same.push(priors[i]!);
    }
    if (same.length >= 2) return { kind: "frame", prior: same[same.length - 1]! };
  }
  return undefined;
}

// ---- tics ------------------------------------------------------------------------

/** Own lines before the candidate a tic is counted in: with the candidate, the actor's last 6 turns. */
export const TIC_PRIORS = 5;
/** Turns of those 6 (the candidate included) that must carry the same opener or form of address for it to be a tic. */
export const TIC_MIN = 4;

export type TicKind = "address" | "tag" | "opener";
export type TicHit = {
  kind: TicKind;
  /** The form of address ("querido", "minha cara"), "não pode?" for a tag question, or the word every line opens with. */
  term: string;
  /** Turns among the actor's last 6 (the candidate included) that carry it. */
  count: number;
};

/**
 * What the actor keeps starting or ending its lines with: a form of address (not a name: a name said in three lines is address, not a tic) on the
 * left or right edge of the line in 4 of its last 6 turns, a tag question ("..., não pode?") ending 4 of them, or one word (not a function word)
 * opening 4. Only the candidate's own opener or ending counts, so a line that already dropped it is clean.
 */
export function findTics(candidate: string, ownPriors: readonly string[], names: ReadonlySet<string> = NO_NAMES): TicHit[] {
  const c = voiceOf(candidate, names);
  // A line of fewer than 3 words ("Rapaz.", "Vinho não.") has nothing to take the tic off of.
  if (c.keys.length < 3) return [];
  const priors = ownPriors.slice(-TIC_PRIORS).map((p) => voiceOf(p, names));
  const hits: TicHit[] = [];
  for (const term of new Set([...c.leadTerms, ...c.trailTerms])) {
    const count = 1 + priors.filter((p) => p.leadTerms.includes(term) || p.trailTerms.includes(term)).length;
    if (count >= TIC_MIN) hits.push({ kind: "address", term, count });
  }
  if (c.tag) {
    const count = 1 + priors.filter((p) => p.tag).length;
    if (count >= TIC_MIN) hits.push({ kind: "tag", term: "tag", count });
  }
  const first = opening(c, 1)[0];
  if (first !== undefined && isTopicWord(first)) {
    const count = 1 + priors.filter((p) => opening(p, 1)[0] === first).length;
    if (count >= TIC_MIN) hits.push({ kind: "opener", term: first, count });
  }
  return hits;
}

// ---- deterministic repairs -------------------------------------------------------------

/** The text of a line with clauses taken out: what is left of each clause's words, the punctuation fixed, a capital on the new first word. */
function rebuild(clauses: readonly Clause[], drop: ReadonlyMap<number, ReadonlySet<number>>, endAs?: string): string {
  const kept: Array<{ words: string[]; sep: string; source: number }> = [];
  clauses.forEach((c, ci) => {
    const gone = drop.get(ci);
    const words = c.words.filter((_, i) => !gone?.has(i));
    if (words.length > 0) kept.push({ words, sep: c.sep, source: ci });
  });
  const last = kept[kept.length - 1];
  if (last === undefined) return "";
  const finalSep = endAs ?? clauses[clauses.length - 1]!.sep;
  if (endAs !== undefined || !/[.!?…]/u.test(last.sep)) last.sep = /[.!?…]/u.test(finalSep) ? finalSep : ".";
  let text = kept.map((k) => `${k.words.join(" ")}${k.sep}`).join(" ").replace(/\s+/gu, " ").trim();
  const firstKept = kept[0]!;
  if (firstKept.source !== 0 || drop.get(0)?.has(0)) text = text.replace(/\p{L}/u, (ch) => ch.toUpperCase());
  return text;
}

/** Word indexes (into a clause's `words`) of the address items in `edge`, restricted to those whose term is wanted. */
function edgeWords(c: Clause, edge: Clause["left"], wanted: ReadonlySet<string>): number[] {
  return edge.filter((e) => wanted.has(e.term)).flatMap((e) => c.at.slice(e.from, e.to));
}

/** A line is quoted or has brackets: it is not cut apart, because its punctuation is not clause punctuation. */
const NO_CUT = /["“”()[\]{}<>*]/u;

/**
 * The line without the forms of address (and the tag question) it keeps ending its lines with: the vocative at the start or the end is taken off
 * ("Rapaz, ela escondeu o caixa." is "Ela escondeu o caixa."), names and everything else stay. Undefined when nothing was taken off, when the
 * line has quotes or brackets, or when fewer than 3 words would be left.
 */
export function stripTics(text: string, hits: readonly TicHit[], names: ReadonlySet<string> = NO_NAMES): string | undefined {
  if (NO_CUT.test(text)) return undefined;
  const wanted = new Set(hits.filter((h) => h.kind === "address").map((h) => h.term));
  const dropTag = hits.some((h) => h.kind === "tag");
  if (wanted.size === 0 && !dropTag) return undefined;
  const clauses = clausesOf(text, names);
  const drop = new Map<number, Set<number>>();
  const mark = (ci: number, words: Iterable<number>): void => {
    const set = drop.get(ci) ?? new Set<number>();
    for (const w of words) set.add(w);
    drop.set(ci, set);
  };
  for (let ci = 0; ci < clauses.length; ci++) {
    const c = clauses[ci]!;
    mark(ci, edgeWords(c, c.left, wanted));
    if (!c.addressOnly) break;
  }
  for (let ci = clauses.length - 1; ci >= 0; ci--) {
    const c = clauses[ci]!;
    mark(ci, edgeWords(c, c.addressOnly ? c.left : c.right, wanted));
    if (!c.addressOnly) break;
  }
  let endAs: string | undefined;
  if (dropTag && voiceOf(text, names).tag) {
    const keptIdx = clauses.map((c, i) => (c.addressOnly ? -1 : i)).filter((i) => i >= 0);
    const tagAt = keptIdx[keptIdx.length - 1]!;
    mark(tagAt, clauses[tagAt]!.words.keys());
    endAs = ".";
  }
  if ([...drop.values()].every((s) => s.size === 0)) return undefined;
  const out = rebuild(clauses, drop, endAs);
  return tokenize(out).length >= 3 && out !== text ? out : undefined;
}

/** Fresh words a repaired line must still have, besides what the actor already said ("4 words of new content"). */
export const REPAIR_MIN_FRESH = 4;

/** Share of a clause's topic words that were already said for it to be struck as a repeat (the scene's own topic words do not count either way). */
export const STALE_SHARE = 0.75;

const staleTopics = (topics: readonly string[], seen: ReadonlySet<string>, skip: ReadonlySet<string>): boolean => {
  const considered = topics.filter((t) => !skip.has(t));
  return considered.length > 0 && considered.filter((t) => seen.has(t)).length >= STALE_SHARE * considered.length;
};

/**
 * A line that repeats the actor's own recent lines, repaired instead of dropped: the sentences three quarters of whose topic words the actor already used in its last 8 lines are
 * struck, and so are stale clauses at the start or the end of a sentence that has fresh ones; a vocative left at the start or the end goes with them, and the
 * rest is kept. Returns what is left, or undefined when nothing was struck or fewer than 4 words of what is left are new (the line says nothing the actor had not
 * said, so there is nothing to keep). `ignore` are folded words that never count as already said (the scene's own topic: "cofre" in a scene about a safe).
 */
export function strikeEcho(text: string, ownPriors: readonly string[], names: ReadonlySet<string> = NO_NAMES, ignore: ReadonlySet<string> = NO_NAMES): string | undefined {
  if (NO_CUT.test(text)) return undefined;
  const priors = ownPriors.slice(-OWN_ECHO_WINDOW).map((p) => voiceOf(p, names));
  const skip = new Set([...ignore].map(stem));
  const seenTopics = new Set(priors.flatMap((p) => p.topics));
  const seenWords = new Set(priors.flatMap((p) => p.keys));
  const clauses = clausesOf(text, names);
  const drop = new Map<number, Set<number>>();
  const strike = (ci: number): void => void drop.set(ci, new Set(clauses[ci]!.words.keys()));
  const topicsOf = (ci: number): string[] => voiceOf(clauses[ci]!.words.join(" "), names).topics;
  // The sentences: runs of clauses up to the one that ends with . ! ? or …
  const sentences: number[][] = [];
  let run: number[] = [];
  clauses.forEach((c, ci) => {
    run.push(ci);
    if (/[.!?…]/u.test(c.sep) || ci === clauses.length - 1) {
      sentences.push(run);
      run = [];
    }
  });
  for (const sentence of sentences) {
    const said = sentence.filter((ci) => !clauses[ci]!.addressOnly);
    if (said.length === 0) continue;
    if (staleTopics(said.flatMap(topicsOf).filter((t, i, all) => all.indexOf(t) === i), seenTopics, skip)) {
      for (const ci of sentence) strike(ci);
      continue;
    }
    // A stale clause at the start or the end of a sentence that says something new elsewhere, and a short clause with no topic word next to it ("sim").
    if (said.length < 2) continue;
    const stale = said.map((ci) => staleTopics(topicsOf(ci), seenTopics, skip));
    const bare = said.map((ci) => topicsOf(ci).length === 0 && voiceOf(clauses[ci]!.words.join(" "), names).keys.length <= 2);
    let from = 0;
    while (from < said.length && (stale[from] || bare[from])) from++;
    if (from > 0 && from < said.length && stale.slice(0, from).some(Boolean)) for (let m = 0; m < from; m++) strike(said[m]!);
    let to = said.length;
    while (to > 0 && (stale[to - 1] || bare[to - 1])) to--;
    if (to > 0 && to < said.length && stale.slice(to).some(Boolean)) for (let m = to; m < said.length; m++) strike(said[m]!);
  }
  if (drop.size === 0) return undefined;
  // A vocative left before what was struck (or after it) goes with it: "Otávio, meu bem," before a sentence that is no longer there.
  const firstSaid = clauses.findIndex((c) => !c.addressOnly);
  const lastSaid = clauses.length - 1 - [...clauses].reverse().findIndex((c) => !c.addressOnly);
  if (drop.has(firstSaid)) for (let i = 0; i < firstSaid; i++) strike(i);
  if (drop.has(lastSaid)) for (let i = lastSaid + 1; i < clauses.length; i++) strike(i);
  const out = rebuild(clauses, drop);
  const v = voiceOf(out, names);
  if (v.keys.filter((k) => !seenWords.has(k)).length < REPAIR_MIN_FRESH) return undefined;
  return out;
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
