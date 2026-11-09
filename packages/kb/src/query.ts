import { dot, type Embedder } from "./embed.js";
import { Store, type StoredBeat } from "./store.js";
import { TACTIC_GROUP_OF, fromPlanTag, normaliseTactic } from "./taxonomy.js";
import type { ReferenceBeat } from "./types.js";

export type QueryOptions = {
  limit?: number;
  /** Free text about the situation, added to the query so it matches the beat's meaning and not only its labels. */
  situation?: string;
  medium?: "THEATRE" | "CINEMA";
  language?: string;
  /** Include the beat text (cut at `maxChars`) for prompt injection. Off by default: plan.json must never carry third-party text. */
  includeText?: boolean;
  maxChars?: number;
  /** First cast window around `castSize`. Default 2: a request for 3 starts with scenes of 1 to 5 speakers, and the window widens until `limit` beats are found. Nearer casts rank higher. */
  castSlack?: number;
};

const ACTION_WORDS: Record<string, string> = {
  KILLING: "a killing, a death, a murder",
  KISSING: "a kiss, passion, intimacy",
  HUGGING: "an embrace, comfort, reunion",
  CRYING: "weeping, a breakdown, grief",
  VIOLENT_PUSH: "a violent shove, pushing someone away",
  VIOLENT_STRIKE: "a slap or a blow, a violent strike",
  PHYSICAL_RETREAT: "turning away, storming out, leaving",
  FAINTING: "a faint, collapse, swooning",
  DIALOGUE_ONLY: "a spoken confrontation without physical action",
};

/**
 * Score = cosine similarity of the query and the beat, plus: the exact tactic (+0.25) or its group (+0.08), closeness of cast size
 * (up to -0.12), and the tagger's confidence (+0.05). The action tag is a hard filter, not a score.
 */
export async function queryReferenceBeats(store: Store, embedder: Embedder, tactic: string, actionTag: string, castSize: number, opts: QueryOptions = {}): Promise<ReferenceBeat[]> {
  const action = fromPlanTag(actionTag);
  if (!action) throw new Error(`unknown action tag ${JSON.stringify(actionTag)}`);
  const wantTactic = normaliseTactic(tactic);
  const slack = opts.castSlack ?? 2;
  const limit = opts.limit ?? 5;

  // Start with the cast window asked for and widen it until there are enough beats: a rare action in a small cast would otherwise
  // return one result. Nearer casts still rank higher (see `score`).
  let pool: StoredBeat[] = [];
  for (const widen of [slack, slack + 2, slack + 4, Number.POSITIVE_INFINITY]) {
    pool = store.candidates({
      action_type: action,
      ...(opts.medium ? { medium: opts.medium } : {}),
      ...(opts.language ? { language: opts.language } : {}),
      ...(Number.isFinite(widen) ? { castMin: Math.max(1, castSize - widen), castMax: castSize + widen } : {}),
    });
    if (pool.filter((b) => b.embed_model === embedder.id).length >= limit) break;
  }
  if (pool.length === 0) return [];

  const q = await embedder.embedQuery(`${wantTactic ?? tactic}. ${ACTION_WORDS[action]}. ${opts.situation ?? ""}`.trim());
  const scored = pool
    .filter((b) => b.embed_model === embedder.id)
    .map((b) => ({ b, score: score(b, q, wantTactic, castSize) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);

  return scored.map(({ b, score: s }) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    act: b.act,
    scene: b.scene,
    medium: b.medium,
    language: b.language,
    tactic_verb: b.tag.tactic_verb,
    status_delta: b.tag.status_delta,
    action_type: b.tag.action_type,
    castSize: b.castSize,
    score: Math.round(s * 1000) / 1000,
    license_class: b.license_class,
    ...(opts.includeText ? { excerpt: b.text.length > (opts.maxChars ?? 1200) ? `${b.text.slice(0, opts.maxChars ?? 1200)} [...]` : b.text } : {}),
  }));
}

function score(b: StoredBeat, q: Float32Array, tactic: string | undefined, castSize: number): number {
  let s = dot(q, b.vec);
  if (tactic) {
    if (b.tag.tactic_verb === tactic) s += 0.25;
    else if (TACTIC_GROUP_OF[b.tag.tactic_verb] === TACTIC_GROUP_OF[tactic]) s += 0.08;
  }
  s -= Math.min(0.12, 0.04 * Math.abs(b.castSize - castSize));
  s += 0.05 * b.tag.confidence;
  return s;
}

/** What goes into `plan.json` `reference_beats`: pointers and labels, never the text. */
export function toPlanRefs(refs: readonly ReferenceBeat[]): Array<Pick<ReferenceBeat, "id" | "title" | "act" | "scene" | "tactic_verb" | "action_type" | "status_delta" | "castSize" | "score" | "license_class">> {
  return refs.map(({ id, title, act, scene, tactic_verb, action_type, status_delta, castSize, score: s, license_class }) => ({ id, title, act, scene, tactic_verb, action_type, status_delta, castSize, score: s, license_class }));
}

/** The three-argument shape from the spec, bound to one store and embedder. */
export function createReferenceQuery(store: Store, embedder: Embedder) {
  return (tactic: string, actionTag: string, castSize: number, opts?: QueryOptions): Promise<ReferenceBeat[]> => queryReferenceBeats(store, embedder, tactic, actionTag, castSize, opts);
}
