import type { Analyzed } from "./metrics.js";
import { STOP_WORDS, demandCues, isNumberKey, letterCount, stemOf } from "./text.js";
import type { Word } from "./text.js";

/**
 * Two loops the motif check cannot see because they are not phrases three turns share: one actor making the same demand again and again
 * (in new words each time), and one actor leaning on a single word (a vocative, a catchphrase: "rapaz", "mano") in turn after turn.
 *
 * Both read only the turns they are given, content turns (reactions already removed), in order. Timed turns use the 90 s motif window; untimed
 * ones count room turns.
 */

export const DEMAND_MIN_TURNS = 3;
export const DEMAND_WINDOW_MS = 90_000;
export const DEMAND_WINDOW_TURNS = 7;
/** Two demand turns of one actor are the same demand when the Jaccard overlap of their topic words is at least this. */
export const DEMAND_JACCARD = 0.4;
export const TIC_MIN_TURNS = 5;
/** Room turns a tic's {@link TIC_MIN_TURNS} uses may be spread over (a scene window). */
export const TIC_WINDOW_TURNS = 24;

/** Forms of address that a speaker says in turn after turn without it being a tic. */
const FORMS_OF_ADDRESS: ReadonlySet<string> = new Set("senhor senhora dona doutor madam miss lord lady".split(" "));

/** Whether a word is a person's name mid-sentence (capitalised, not opening a sentence). */
const properNoun = (w: Word): boolean => !w.start && /^\p{Lu}\p{Ll}/u.test(w.raw);

/** A turn's topic words: 4 or more letters, not a stop word, a number, a name or a proper noun. */
export function topicWords(a: Analyzed, names: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const w of a.words) if (letterCount(w.key) >= 4 && !STOP_WORDS.has(w.key) && !names.has(w.key) && !isNumberKey(w.key) && !properNoun(w)) out.add(w.key);
  return out;
}

const jaccard = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let both = 0;
  for (const k of a) if (b.has(k)) both++;
  return both / (a.size + b.size - both);
};

export type DemandHit = { speaker: string; /** Indices into the turns given. */ turns: number[]; /** The topic words the turns share. */ shared: string[] };

type DemandTurn = { index: number; topic: Set<string>; cues: Set<string> };

/**
 * Demand loops: an actor's turns that carry a demand cue (a demand phrase, an imperative opening a sentence) are clustered by the overlap of
 * their topic words (Jaccard 0.4 or more), or by one shared demand phrase and one shared topic word of 5 letters or more (the same ultimatum
 * in new words); a loop is {@link DEMAND_MIN_TURNS} or more turns of one cluster inside the window.
 */
export function findDemandLoops(say: readonly Analyzed[], names: ReadonlySet<string>): DemandHit[] {
  const timed = say.every((a) => typeof a.turn.atMs === "number");
  const bySpeaker = new Map<string, DemandTurn[]>();
  say.forEach((a, index) => {
    const cues = new Set(demandCues(a.words, a.joined).filter((c) => !c.startsWith(">")));
    const imperative = demandCues(a.words, a.joined).some((c) => c.startsWith(">"));
    if (cues.size === 0 && !imperative) return;
    const who = a.turn.speaker.toLowerCase();
    bySpeaker.set(who, [...(bySpeaker.get(who) ?? []), { index, topic: topicWords(a, names), cues }]);
  });
  const hits: DemandHit[] = [];
  for (const [speaker, list] of bySpeaker) {
    const parent = list.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    const same = (a: DemandTurn, b: DemandTurn): boolean => {
      if (jaccard(a.topic, b.topic) >= DEMAND_JACCARD) return true;
      const cue = [...a.cues].some((c) => b.cues.has(c));
      return cue && [...a.topic].some((k) => letterCount(k) >= 5 && b.topic.has(k));
    };
    for (let j = 1; j < list.length; j++) for (let i = 0; i < j; i++) if (same(list[i]!, list[j]!)) parent[find(j)] = find(i);
    const clusters = new Map<number, DemandTurn[]>();
    list.forEach((t, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), t]));
    for (const members of clusters.values()) {
      if (members.length < DEMAND_MIN_TURNS) continue;
      const inHit = new Set<number>();
      for (let j = 0; j + DEMAND_MIN_TURNS <= members.length; j++) {
        const first = members[j]!.index;
        const last = members[j + DEMAND_MIN_TURNS - 1]!.index;
        const within = timed ? say[last]!.turn.atMs! - say[first]!.turn.atMs! <= DEMAND_WINDOW_MS : last - first < DEMAND_WINDOW_TURNS;
        if (within) for (let k = j; k < j + DEMAND_MIN_TURNS; k++) inHit.add(members[k]!.index);
      }
      if (inHit.size === 0) continue;
      const hit = members.filter((m) => inHit.has(m.index));
      const shared = [...hit[0]!.topic].filter((k) => hit.every((m) => m.topic.has(k)));
      hits.push({ speaker, turns: hit.map((m) => m.index), shared });
    }
  }
  return hits.sort((a, b) => a.turns[0]! - b.turns[0]!);
}

export type TicHit = { speaker: string; word: string; /** Indices into the turns given. */ turns: number[] };

/**
 * Tics: one topic word (a stem, so "rapaz" and "rapazes" meet) in {@link TIC_MIN_TURNS} or more turns of one speaker inside a window of
 * {@link TIC_WINDOW_TURNS} room turns. Names, proper nouns (a word capitalised everywhere it appears) and forms of address ("senhor") are not tics.
 * Topical words trip it in real scenes too (a character who keeps coming back to the money); the norms carry that rate, so only a share of turns
 * beyond what real scenes show lowers a score.
 */
export function findTics(say: readonly Analyzed[], names: ReadonlySet<string>): TicHit[] {
  const seen = new Map<string, number[]>();
  const shown = new Map<string, string>();
  // A word that is capitalised everywhere it appears is a name or a title's name ("Mrs. Elvsted"), whatever opens the sentence.
  const lowered = new Set<string>();
  for (const a of say) for (const w of a.words) if (!/^\p{Lu}/u.test(w.raw)) lowered.add(stemOf(w.key));
  say.forEach((a, index) => {
    const who = a.turn.speaker.toLowerCase();
    const stems = new Set<string>();
    for (const k of topicWords(a, names)) {
      if (FORMS_OF_ADDRESS.has(k)) continue;
      const stem = stemOf(k);
      if (!lowered.has(stem)) continue;
      stems.add(stem);
      if (!shown.has(`${who}|${stem}`)) shown.set(`${who}|${stem}`, k);
    }
    for (const stem of stems) seen.set(`${who}|${stem}`, [...(seen.get(`${who}|${stem}`) ?? []), index]);
  });
  const hits: TicHit[] = [];
  for (const [key, idx] of seen) {
    if (idx.length < TIC_MIN_TURNS) continue;
    const inHit = new Set<number>();
    for (let j = 0; j + TIC_MIN_TURNS <= idx.length; j++) {
      if (idx[j + TIC_MIN_TURNS - 1]! - idx[j]! < TIC_WINDOW_TURNS) for (let k = j; k < j + TIC_MIN_TURNS; k++) inHit.add(idx[k]!);
    }
    if (inHit.size === 0) continue;
    hits.push({ speaker: key.slice(0, key.indexOf("|")), word: shown.get(key) ?? key, turns: [...inHit].sort((a, b) => a - b) });
  }
  return hits.sort((a, b) => a.turns[0]! - b.turns[0]!);
}
