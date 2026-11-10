import { SLIM_ACTIONS, type SlimAction, type SlimBeat, type SlimKb, type SlimLanguage, type SlimWork } from "./slim.js";

/**
 * Metadata-only retrieval over the slim file: no embedding model, so it runs anywhere the file can be read. Hard filter on the physical
 * action and the cast size (nearest window that holds enough), then a weighted score, then a stable tie-break on the beat id, so one ask
 * always returns the same beats. Tactic labels are about 40% exact in the index, so the tactic ranks and never decides.
 */
export type SlimQuery = {
  /** A KB action type, or the plan's `NONE` for dialogue only. Unknown: nothing matches. */
  action: string;
  /** Cast size of the scene being written. */
  cast: number;
  /** "to threaten" or "threaten". */
  tactic?: string;
  status?: string;
  emotion?: string;
  /** "en", "pt" or "pt-BR". A preference, not a filter. */
  language?: string;
  /** Default 3. */
  limit?: number;
  /** At most this many beats from one work while another work can fill the slot. Default 1. */
  maxPerWork?: number;
  exclude?: ReadonlySet<string>;
  /** Works (indexes into `works`) to leave out, so several asks in one prompt draw on different plays. */
  excludeWorks?: ReadonlySet<number>;
  /** Only beats that have a quip (the runtime style lines need one). */
  needQuip?: boolean;
};

export type SlimPick = { beat: SlimBeat; work: SlimWork; score: number };

/** The weights, in one place so a test can pin the order of preference. */
export const SLIM_WEIGHTS = {
  language: 3,
  tacticExact: 2.5,
  tacticGroup: 1,
  status: 1,
  emotion: 0.75,
  boundaryOk: 0.5,
  confidence: 0.25,
  /** Up to this for an excerpt of 300 characters or more: a two-line stub teaches less than a scene. */
  richness: 0.3,
  /** Per step of cast distance, up to three steps. */
  castStep: 0.4,
} as const;

const WINDOWS = [1, 2, 4, Number.POSITIVE_INFINITY] as const;

const byAction = new WeakMap<SlimKb, Map<SlimAction, SlimBeat[]>>();

function indexed(kb: SlimKb): Map<SlimAction, SlimBeat[]> {
  let map = byAction.get(kb);
  if (!map) {
    map = new Map();
    for (const beat of kb.beats) {
      const list = map.get(beat.action);
      if (list) list.push(beat);
      else map.set(beat.action, [beat]);
    }
    byAction.set(kb, map);
  }
  return map;
}

/** The plan's `NONE` is the KB's `DIALOGUE_ONLY`. */
export function slimActionOf(tag: string): SlimAction | undefined {
  if (tag === "NONE") return "DIALOGUE_ONLY";
  return (SLIM_ACTIONS as readonly string[]).includes(tag) ? (tag as SlimAction) : undefined;
}

export function slimLanguageOf(language: string | undefined): SlimLanguage | undefined {
  if (language === undefined) return undefined;
  const lower = language.toLowerCase();
  if (lower === "en" || lower.startsWith("en-")) return "en";
  if (lower === "pt" || lower.startsWith("pt-")) return "pt";
  return undefined;
}

/** "Threaten", "to  threaten" and "TO THREATEN" are one tactic. */
export function slimTacticOf(tactic: string | undefined): string | undefined {
  if (tactic === undefined) return undefined;
  const t = tactic.trim().toLowerCase().replace(/\s+/g, " ");
  if (t === "") return undefined;
  return t.startsWith("to ") ? t : `to ${t}`;
}

export function selectSlimBeats(kb: SlimKb, query: SlimQuery): SlimPick[] {
  const action = slimActionOf(query.action);
  const limit = Math.max(0, Math.floor(query.limit ?? 3));
  if (action === undefined || limit === 0) return [];
  const all = indexed(kb).get(action) ?? [];
  const language = slimLanguageOf(query.language);
  const tactic = slimTacticOf(query.tactic);
  const wantGroup = tactic === undefined ? undefined : kb.groups[tactic];
  const maxPerWork = Math.max(1, Math.floor(query.maxPerWork ?? 1));
  const usable = all.filter((b) => !query.exclude?.has(b.id) && !query.excludeWorks?.has(b.work) && (!query.needQuip || b.quip !== undefined));

  const score = (b: SlimBeat): number => {
    let s = SLIM_WEIGHTS.confidence * b.confidence + SLIM_WEIGHTS.richness * Math.min(1, b.excerpt.length / 300) - SLIM_WEIGHTS.castStep * Math.min(3, Math.abs(b.cast - query.cast));
    if (language !== undefined && b.language === language) s += SLIM_WEIGHTS.language;
    if (tactic !== undefined) {
      if (b.tactic === tactic) s += SLIM_WEIGHTS.tacticExact;
      else if (wantGroup !== undefined && kb.groups[b.tactic] === wantGroup) s += SLIM_WEIGHTS.tacticGroup;
    }
    if (query.status !== undefined && b.status === query.status) s += SLIM_WEIGHTS.status;
    if (query.emotion !== undefined && b.emotion === query.emotion) s += SLIM_WEIGHTS.emotion;
    if (b.boundaryOk) s += SLIM_WEIGHTS.boundaryOk;
    return s;
  };

  let picks: SlimPick[] = [];
  for (const window of WINDOWS) {
    const pool = usable.filter((b) => Math.abs(b.cast - query.cast) <= window);
    picks = diversify(
      pool.map((beat) => ({ beat, work: kb.works[beat.work] as SlimWork, score: Math.round(score(beat) * 1000) / 1000 })).sort((a, b) => b.score - a.score || (a.beat.id < b.beat.id ? -1 : 1)),
      limit,
      maxPerWork,
    );
    if (picks.length >= limit) break;
  }
  return picks;
}

/** Best first, at most `maxPerWork` from one work; if that leaves too few, the best of what was skipped fills the rest. */
function diversify(ranked: SlimPick[], limit: number, maxPerWork: number): SlimPick[] {
  const taken: SlimPick[] = [];
  const perWork = new Map<number, number>();
  const skipped: SlimPick[] = [];
  for (const pick of ranked) {
    if (taken.length >= limit) break;
    const n = perWork.get(pick.beat.work) ?? 0;
    if (n >= maxPerWork) skipped.push(pick);
    else (taken.push(pick), perWork.set(pick.beat.work, n + 1));
  }
  for (const pick of skipped) {
    if (taken.length >= limit) break;
    taken.push(pick);
  }
  return taken.sort((a, b) => b.score - a.score || (a.beat.id < b.beat.id ? -1 : 1));
}
