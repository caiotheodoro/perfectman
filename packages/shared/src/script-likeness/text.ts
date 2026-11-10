/**
 * Text folding for the script-likeness metrics: words of a line, stage directions and laughter dropped, accents and case folded,
 * a light stem so inflections of one word meet, and the stop lists and speech-act lexicons the detectors read.
 *
 * Pure and deterministic. The same folding is used on real play text (when norms are built) and on a run's chat lines (when a run is
 * scored or a candidate line is checked), so the two are comparable.
 */

export type ScriptLang = "pt" | "en";

const STAGE_DIRECTIONS = [/\*[^*\n]{1,80}\*/g, /\([^()\n]{1,200}\)/g, /\[[^\]\n]{1,300}\]/g, /<[^<>\n]{1,80}>/g];
const LAUGH = /^(?:k{2,}|(?:ha){2,}h?|(?:he){2,}h?|(?:hi){2,}h?|(?:rs)+|(?:ah){2,}h?|(?:ja){3,}|lol|lmao)$/;
const COMBINING = /\p{M}/gu;
const ELONGATION = /(\p{L})\1{2,}/gu;
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/** The line without stage directions ("*sorri*", "(rindo)", "[exits]"). */
export function stripDirections(text: string): string {
  let t = text;
  for (const re of STAGE_DIRECTIONS) t = t.replace(re, " ");
  return t;
}

const foldPlain = (word: string): string => word.toLowerCase().normalize("NFKD").replace(COMBINING, "").replace(/['’]/gu, "");

/** Lower case, no accents, no apostrophes, an elongated letter squeezed ("siiim" is "sim"). */
export function fold(word: string): string {
  return foldPlain(word).replace(ELONGATION, "$1");
}

/** A word of a line: as written, folded, and whether it opens a sentence. */
export type Word = { raw: string; key: string; start: boolean };

/** Words of `text` in order, directions and laughter dropped. */
export function wordsOf(text: string): Word[] {
  const t = stripDirections(text);
  const out: Word[] = [];
  for (const m of t.matchAll(WORD)) {
    const raw = m[0];
    const plain = foldPlain(raw);
    if (plain === "" || LAUGH.test(plain)) continue;
    const key = plain.replace(ELONGATION, "$1");
    const before = t.slice(0, m.index).trimEnd();
    out.push({ raw, key, start: before === "" || /[.!?…:;—–"“(¿¡-]$/u.test(before) });
  }
  return out;
}

/**
 * Splits `text` after each of `enders` that is followed by white space, dropping the white space (what a regex lookbehind split does, without one:
 * this module is bundled into the browser build, and lookbehind is a syntax error in older Safari).
 */
export function splitAfter(text: string, enders: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    cur += ch;
    const next = text[i + 1];
    if (enders.includes(ch) && (next === undefined || /\s/u.test(next))) {
      parts.push(cur.trim());
      cur = "";
      while (i + 1 < text.length && /\s/u.test(text[i + 1]!)) i++;
    }
  }
  if (cur.trim() !== "") parts.push(cur.trim());
  return parts.filter((p) => p !== "");
}

/** Number of words a turn is counted as. */
export function wordCount(text: string): number {
  return wordsOf(text).length;
}

/** Letters in a folded word (digits do not count). */
export const letterCount = (key: string): number => key.replace(/[^\p{L}]/gu, "").length;

/** Folded words of 4 or more letters: the unit of lexical novelty. */
export function contentKeys(words: readonly Word[]): string[] {
  return words.filter((w) => letterCount(w.key) >= 4).map((w) => w.key);
}

/** A cut stem: inflections of one word ("aposta", "apostar", "apostei") meet; a stem is 5 letters of a word of 5 or more. */
export function stemOf(key: string): string {
  const k = key.length > 4 && key.endsWith("s") ? key.slice(0, -1) : key;
  return k.length <= 4 ? k : k.slice(0, 5);
}

/** Words that carry no topic, in Portuguese and English, folded. */
export const STOP_WORDS: ReadonlySet<string> = new Set(
  ("a o as os um uma uns umas de do da dos das em no na nos nas ao aos que e eu tu voce voces vc ele ela eles elas me te se lhe nos meu minha meus minhas seu sua seus suas " +
    "teu tua pra para por com sem mas ou ja nao sim ne ta to tem ter foi ser sao vai vou vamos esta estou isso isto esse essa este aquele aquela la ai aqui ali so mim ti si comigo contigo " +
    "tambem mais muito bem assim entao como quando onde quem qual quanto sobre ate depois antes ainda ha era eram sera seja fui tinha tinham pode posso quer quero faz fazer " +
    "the to of in on at and or is it you your my i we he she they this that for with be do not are was have has had will would can could what who how when where why his her him them its our their " +
    "there here but if so no yes am were been being than then just very too also from by about into over such shall must may might one").split(" "),
);

/** Determiners and possessives that open a noun phrase: the word after one is an object being named. */
export const DETERMINERS: ReadonlySet<string> = new Set(
  "o a os as um uma uns umas seu sua seus suas meu minha meus minhas teu tua esse essa esses essas este esta aquele aquela the an my your his her our their this that these those".split(" "),
);

const PT_HINT = new Set("que nao uma voce para pra com mas isso tem esta eu meu minha ne ta mano cara entao ele ela vai foi sao dos das nos aqui nem tipo pois senhor senhora".split(" "));
const EN_HINT = new Set("the you and that with not have this for are was what your his her they there would will but from".split(" "));

/** Which language a list of lines is in, by stop-word hits. Ties are Portuguese (the product's default). */
export function detectLang(texts: readonly string[]): ScriptLang {
  let pt = 0;
  let en = 0;
  for (const t of texts) {
    for (const w of wordsOf(t)) {
      if (PT_HINT.has(w.key)) pt++;
      if (EN_HINT.has(w.key)) en++;
    }
  }
  return en > pt ? "en" : "pt";
}

/** Tokens of speaker labels ("DONA NEIDE", "MRS. LINDE") as names the lines may use: folded, 3 letters or more, not a title. */
const TITLES = new Set("mrs mr dona dom sra senhor senhora lord lady sir the dr doutor miss madam".split(" "));
export function nameKeys(speakers: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const s of speakers) {
    for (const piece of s.split(/[\s.]+/u)) {
      const k = fold(piece);
      if (letterCount(k) >= 3 && !TITLES.has(k)) out.add(k);
    }
  }
  return out;
}

// ---- speech-act lexicons (folded, matched on the folded words joined by single spaces) ---------------------------

const has = (joined: string, phrases: readonly string[]): boolean => phrases.some((p) => joined.includes(` ${p} `));
const re = (joined: string, patterns: readonly RegExp[]): boolean => patterns.some((p) => p.test(joined));

const COMMIT = [
  "prometo", "juro", "juramos", "aceito", "aceitamos", "topo", "topamos", "fechado", "combinado", "decidi", "decidimos", "resolvi", "resolvemos", "farei", "irei", "darei", "pagarei",
  "chega", "basta", "acabou", "recuso", "me recuso", "nunca mais", "estou fora", "estou dentro", "pode deixar", "deixa comigo", "aposto", "apostei", "aposta aceita", "negocio fechado",
  "assino", "entrego", "devolvo", "nao vou", "vamos embora", "consinto", "juro por",
  "i will", "ill", "i shall", "i promise", "i swear", "i vow", "i accept", "i refuse", "i decline", "i agree", "agreed", "deal", "it is done", "i have decided", "i am going to", "never again",
  "enough", "i will not", "i wont", "so be it", "i consent", "i bet", "you have my word",
];
const COMMIT_RE = [/ vou \p{L}{3,}(?:ar|er|ir|or) /u, / vamos \p{L}{3,}(?:ar|er|ir|or) /u, / im going to /u];

const ACCUSE = [
  "mentiu", "mentiste", "roubou", "roubaste", "traiu", "traiste", "escondeu", "enganou", "enganaste", "matou", "mentiroso", "mentirosa", "ladrao", "traidor", "traidora", "culpa", "culpado", "culpada",
  "mentira", "canalha", "miseravel", "velhaco", "patife", "tratante", "safado", "sem vergonha", "foi voce", "foi ele", "foi ela", "voce sabia", "voce fez",
  "you lied", "you stole", "you took", "you betrayed", "you hid", "you knew", "you killed", "you cheated", "liar", "thief", "traitor", "villain", "wretch", "it was you", "your fault", "guilty", "how dare you",
  "shame on you", "you did this",
];

const REVEAL = [
  "na verdade", "a verdade e", "confesso", "confessar", "eu sabia", "descobri", "o segredo", "fui eu", "sou eu que", "eu escondi", "nunca te contei", "preciso te contar", "tenho que te dizer", "escondi", "revelo",
  "the truth is", "in truth", "actually", "i confess", "i knew", "i found out", "it was i", "it was me", "i am the one", "i never told", "i have to tell you", "i must tell you", "my secret", "i hid",
];

const ACT_WORDS = [
  "entra", "entram", "sai", "saem", "senta", "levanta", "corre", "foge", "abraca", "beija", "bate", "empurra", "cai", "desmaia", "chora", "agarra", "puxa", "larga", "atira", "mata", "foi embora",
  "enter", "enters", "exit", "exits", "exeunt", "sits", "rises", "runs", "falls", "kisses", "strikes", "embraces", "draws", "takes", "gives", "turns", "leaves", "faints", "weeps", "seizes", "pulls", "flings",
];

/** The turn makes a promise, accepts or refuses, bets, decides. */
export const isCommitment = (joined: string): boolean => has(joined, COMMIT) || re(joined, COMMIT_RE);
/** The turn names a person as the one who lied, took, hid or betrayed. */
export const isAccusation = (joined: string): boolean => has(joined, ACCUSE);
/** The turn gives up a secret or says what was hidden. */
export const isReveal = (joined: string): boolean => has(joined, REVEAL);
/** A stage direction that moves a body (a corpus direction; chat has acts as events). */
export const isBodyDirection = (joined: string): boolean => has(joined, ACT_WORDS);

const NUMBER_WORDS = new Set(
  ("dois duas tres quatro cinco seis sete oito nove dez onze doze vinte trinta quarenta cinquenta cem cento mil milhao milhoes two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred thousand million").split(" "),
);
/** A digit run or a number word. */
export const isNumberKey = (key: string): boolean => /\d/.test(key) || NUMBER_WORDS.has(key);

/** Simile frames: the frame is the repeated thing, whatever it likens. "tipo" needs a topic word after it (as a filler it is not a simile). */
export const SIMILE_FRAMES: Readonly<Record<ScriptLang | "all", readonly string[]>> = {
  pt: ["que nem", "tipo", "feito", "igual a", "igual ao", "parece um", "parece uma", "como se"],
  en: ["like a", "like an", "like the", "as if", "looks like", "sounds like", "as though"],
  all: [],
};

/** The simile frames a joined line uses, each as `frame` (only frames that name something after them). */
export function similesIn(joined: string): string[] {
  const out: string[] = [];
  for (const frame of [...SIMILE_FRAMES.pt, ...SIMILE_FRAMES.en]) {
    const at = joined.indexOf(` ${frame} `);
    if (at < 0) continue;
    const next = joined.slice(at + frame.length + 2).split(" ")[0] ?? "";
    if (frame === "tipo" && (next === "" || STOP_WORDS.has(next))) continue;
    out.push(frame);
  }
  return out;
}

/** A line's words as the single-spaced folded string the lexicons read, with a space at each end. */
export function joinedKeys(words: readonly Word[]): string {
  return ` ${words.map((w) => w.key).join(" ")} `;
}
