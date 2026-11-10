import { DRAFT_REFERENCE_MAX_CHARS, renderReferenceScenes, selectSlimBeats } from "@perfectman/shared";
import type { SlimAction, SlimKb, SlimPick, StoryDraft } from "@perfectman/shared";
import { detectLanguage } from "./language-detect.js";

/**
 * Reference scenes for the draft prompt (packages/kb README, "Slim artifact"). Before the model writes there is only the idea, so what the
 * scene will be is guessed from its words: the physical peak it hints at, up to three tactics, an emotion, the cast size. The guess only
 * chooses labels from the KB's controlled lists; the idea's own text never goes into a query. Whatever the references say reaches the model
 * as prompt context, and what the model answers is as untrusted as ever: on top of `toStoryDraft` and `repairBeats`, `guardDraft` cuts back any
 * line that repeats a run of words the model was shown and refuses a draft that copies prose or borrows a name from the references.
 */

export type DraftIntent = { cast: number; peak: SlimAction; tactics: string[]; emotion?: string };

const MIN_CAST = 2;
const MAX_CAST = 6;
/** No people given: the prompt asks for "three to five". */
const DEFAULT_CAST = 4;
/** Words in a row that make a line a copy. */
const SHINGLE = 5;

const fold = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const wordsOf = (text: string): string[] => fold(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w !== "");
const hit = (word: string, pattern: string): boolean => (pattern.endsWith("*") ? word.startsWith(pattern.slice(0, -1)) : word === pattern);

/** Most severe first: the first group that has a word in the idea is the peak. English and Brazilian Portuguese, accents folded. */
const PEAKS: ReadonlyArray<readonly [SlimAction, readonly string[]]> = [
  ["KILLING", ["kill*", "murder*", "poison*", "stab*", "strangl*", "assassin*", "shoot*", "shot", "mata", "matar", "matou", "envenen*", "esfaque*", "tiro", "atira*"]],
  ["VIOLENT_STRIKE", ["slap*", "punch*", "hit", "hits", "strike*", "struck", "fight*", "tapa", "soco", "socar", "bofet*", "brig*", "agred*"]],
  ["VIOLENT_PUSH", ["shov*", "push*", "empurr*"]],
  ["KISSING", ["kiss*", "beij*", "affair", "lover", "lovers", "amante", "amantes"]],
  ["HUGGING", ["hug*", "embrac*", "abrac*", "reconcil*", "forgiv*", "perdo*"]],
  ["FAINTING", ["faint*", "swoon*", "desmai*"]],
  ["CRYING", ["cry", "cries", "cried", "crying", "weep*", "grief", "mourn*", "funeral", "chor*", "luto", "velorio"]],
  ["PHYSICAL_RETREAT", ["storm*", "flee*", "foge", "fugir", "abandon*"]],
];

/** By the order the words come in the idea. */
const TACTICS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["to accuse", ["accus*", "blam*", "acus*", "culp*"]],
  ["to confront", ["confront*", "enfrent*", "betray*", "traic*", "trair", "traiu", "traid*", "cheat*", "infiel", "infidel*"]],
  ["to threaten", ["threat*", "blackmail*", "chantag*", "ameac*"]],
  ["to demand", ["demand*", "ultimat*", "exig*"]],
  ["to plead", ["plead*", "beg", "begs", "begged", "implor*", "suplic*"]],
  ["to seduce", ["seduc*", "seduz*", "flirt*", "paquer*", "cortej*", "court*"]],
  ["to confess", ["confess*", "admit*"]],
  ["to expose", ["expos*", "reveal*", "revel*", "secret", "secrets", "segredo", "segredos", "uncover*", "descobr*", "discover*", "lie", "lies", "lied", "lying", "mentir*", "mentira*"]],
  ["to humiliate", ["humiliat*", "humilh*", "mock*", "zomb*", "ridicul*"]],
  ["to comfort", ["comfort*", "consol*", "soothe*"]],
  ["to negotiate", ["negotiat*", "negoci*", "bargain*", "acordo", "bribe*", "suborn*"]],
  ["to interrogate", ["interrogat*", "interrog*"]],
  ["to evade", ["evade*", "evad*", "deflect*", "stonewall*"]],
  ["to persuade", ["persuad*", "convenc*", "convinc*"]],
  ["to refuse", ["refus*", "recus*"]],
  ["to provoke", ["provok*", "provoc*", "taunt*"]],
];

const EMOTIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["anger", ["angr*", "fury", "furious", "rage", "raiva", "furi*"]],
  ["jealousy", ["jealous*", "ciume*", "ciumen*"]],
  ["fear", ["afraid", "fear*", "terror*", "medo", "temor"]],
  ["shame", ["shame*", "ashamed", "vergonha*"]],
  ["sadness", ["grief", "mourn*", "funeral", "luto", "sad", "triste*"]],
  ["contempt", ["contempt*", "desprez*", "scorn*"]],
  ["love", ["love*", "amor", "paix*", "passion*"]],
];

/** When the idea names no tactic, or fewer than three: what a scene with that peak usually runs on. */
const DEFAULT_TACTICS: Record<SlimAction, readonly string[]> = {
  KILLING: ["to threaten", "to accuse", "to confront"],
  VIOLENT_STRIKE: ["to accuse", "to humiliate", "to provoke"],
  VIOLENT_PUSH: ["to confront", "to dominate", "to provoke"],
  KISSING: ["to seduce", "to confess", "to plead"],
  HUGGING: ["to comfort", "to apologise", "to forgive"],
  CRYING: ["to confess", "to console", "to accuse"],
  FAINTING: ["to expose", "to accuse", "to confront"],
  PHYSICAL_RETREAT: ["to confront", "to refuse", "to accuse"],
  DIALOGUE_ONLY: ["to confront", "to accuse", "to press"],
};

export function inferDraftIntent(idea: string, people?: number): DraftIntent {
  const words = wordsOf(idea);
  const peak = PEAKS.find(([, patterns]) => words.some((w) => patterns.some((p) => hit(w, p))))?.[0] ?? "DIALOGUE_ONLY";
  const found: Array<[number, string]> = [];
  for (const [tactic, patterns] of TACTICS) {
    const at = words.findIndex((w) => patterns.some((p) => hit(w, p)));
    if (at >= 0) found.push([at, tactic]);
  }
  const tactics = found.sort((a, b) => a[0] - b[0]).map(([, tactic]) => tactic);
  for (const tactic of DEFAULT_TACTICS[peak]) if (tactics.length < 3 && !tactics.includes(tactic)) tactics.push(tactic);
  const emotion = EMOTIONS.find(([, patterns]) => words.some((w) => patterns.some((p) => hit(w, p))))?.[0];
  const cast = people === undefined ? DEFAULT_CAST : Math.min(MAX_CAST, Math.max(MIN_CAST, Math.round(people)));
  return { cast, peak, tactics: tactics.slice(0, 3), ...(emotion ? { emotion } : {}) };
}

/** Run-of-words fingerprints of what the model was shown, and the words of the works' titles and authors. */
export type ReferenceGuard = { shingles: ReadonlySet<string>; names: ReadonlySet<string> };

export type DraftReferences = { block: string; ids: string[]; guard: ReferenceGuard };

function shinglesOf(text: string): Set<string> {
  const words = wordsOf(text);
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE <= words.length; i += 1) out.add(words.slice(i, i + SHINGLE).join(" "));
  return out;
}

/**
 * Two or three scenes from the KB for this idea: the scene with the physical peak first, then dialogue scenes for the climb, each from a
 * different play. Only in the draft's language: a slot the KB has no scene for in that language is left empty, and no scene at all is better
 * than a mismatched one, and never a mix. The one exception is an idea that is explicitly English under a pinned Portuguese draft, where
 * English scenes stand in when the KB has no Portuguese scene at all. Undefined when nothing fits or the block cannot fit its cap, and then
 * the prompt is the one it always was.
 */
export function draftReferences(kb: SlimKb, idea: string, people: number | undefined, language: "en" | "pt-BR" | undefined): DraftReferences | undefined {
  const intent = inferDraftIntent(idea, people);
  const detected = detectLanguage(idea);
  const tongue = language ?? detected.language;
  // Explicitly English: the detector is sure (nothing Portuguese in it, at least two English function words and nearly all markers English).
  const explicitlyEnglish = detected.language === "en" && detected.confidence >= 0.8 && detected.markers.length >= 2;
  const asks: Array<{ action: SlimAction; tactic: string }> =
    intent.peak === "DIALOGUE_ONLY"
      ? intent.tactics.map((tactic) => ({ action: "DIALOGUE_ONLY", tactic }))
      : [
          { action: intent.peak, tactic: intent.tactics[0] as string },
          { action: "DIALOGUE_ONLY", tactic: intent.tactics[1] ?? (intent.tactics[0] as string) },
          { action: "DIALOGUE_ONLY", tactic: intent.tactics[2] ?? (intent.tactics[0] as string) },
        ];

  const collect = (scenes: "en" | "pt-BR"): SlimPick[] => {
    const picks: SlimPick[] = [];
    const ids = new Set<string>();
    const works = new Set<number>();
    for (const ask of asks) {
      const query = { action: ask.action, tactic: ask.tactic, cast: intent.cast, language: scenes, languageOnly: true, limit: 1, ...(intent.emotion ? { emotion: intent.emotion } : {}) };
      // A different play for each slot while the KB has one; a rare action may leave only the same play.
      const pick = selectSlimBeats(kb, { ...query, exclude: ids, excludeWorks: works })[0] ?? selectSlimBeats(kb, { ...query, exclude: ids })[0];
      if (!pick) continue;
      picks.push(pick);
      ids.add(pick.beat.id);
      works.add(pick.beat.work);
    }
    return picks;
  };
  // Never a mix, and never the wrong language: the draft's own, or, for an explicitly English idea whose KB has no scene at all in a pinned Portuguese draft's language, English.
  let picks = collect(tongue);
  if (picks.length === 0 && tongue === "pt-BR" && explicitlyEnglish) picks = collect("en");
  const shown = renderReferenceScenes(picks, DRAFT_REFERENCE_MAX_CHARS);
  if (!shown) return undefined;

  const shingles = new Set<string>();
  const names = new Set<string>();
  for (const pick of shown.used) {
    for (const s of shinglesOf(pick.beat.excerpt.replace(/^[A-Z?]: /gm, ""))) shingles.add(s);
    for (const w of wordsOf(`${pick.work.title} ${pick.work.author}`)) if (w.length >= 5) names.add(w);
  }
  return { block: shown.text, ids: shown.used.map((p) => p.beat.id), guard: { shingles, names } };
}

const copies = (text: string, guard: ReferenceGuard): boolean => [...shinglesOf(text)].some((s) => guard.shingles.has(s));

/**
 * What the model wrote, checked against what it was shown. A line (something a person would say) that repeats a run of five words of a
 * reference is cut; the rest of the draft is kept. Prose that does (title, situation, goal, obstacle, method, voice) or a person named by a
 * word of a shown play's title or author that the idea did not use is not a draft to repair: it throws, and the caller treats it as an
 * unusable reply and asks again.
 */
export function guardDraft(draft: StoryDraft, guard: ReferenceGuard, idea: string): StoryDraft {
  const given = new Set(wordsOf(idea));
  const refuse = (what: string): never => {
    throw new Error(`copies a reference scene (${what})`);
  };
  if (copies(draft.title, guard)) refuse("title");
  if (copies(draft.situation, guard)) refuse("situation");
  const people = draft.people.map((person) => {
    for (const word of wordsOf(person.name)) if (guard.names.has(word) && !given.has(word)) refuse(`the name ${person.name}`);
    for (const [field, value] of [["goal", person.goal], ["voice", person.voice], ["obstacle", person.obstacle], ["method", person.method]] as const) {
      if (value !== undefined && copies(value, guard)) refuse(`${person.name}'s ${field}`);
    }
    const lines = person.lines.filter((line) => !copies(line, guard));
    return lines.length === person.lines.length ? person : { ...person, lines };
  });
  return people.every((person, i) => person === draft.people[i]) ? draft : { ...draft, people };
}
