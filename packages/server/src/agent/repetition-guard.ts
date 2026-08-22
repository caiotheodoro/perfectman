/**
 * Repetition guard — catches an agent repeating (or near-repeating) one of
 * its own recent messages, structurally, instead of relying on the model to
 * self-police a prompt instruction.
 *
 * Why this exists: the prompt already tells the model not to repeat itself
 * and renders the exact prior text it must avoid (see
 * action-intent-prompt-builder.ts <no_repeat> container), but empirically
 * small local models keep repeating anyway — the instruction alone isn't
 * sufficient. This is the enforcement backstop.
 */

const STOPWORDS = new Set(["a", "o", "e", "de", "que", "do", "da", "em", "um", "uma", "and", "of", "to", "the"]);

const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

/** Lowercase, strip punctuation/emoji/diacritics, collapse whitespace, drop stopwords. */
export function normalizeWords(text: string): string[] {
  const stripped = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_DIACRITICS, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // punctuation/emoji -> space
    .trim();
  if (stripped.length === 0) return [];
  return stripped.split(/\s+/).filter((w) => w.length > 0 && !STOPWORDS.has(w));
}

/** Jaccard similarity over normalized word sets. 1.0 = identical content. */
export function similarity(a: string, b: string): number {
  const wordsA = new Set(normalizeWords(a));
  const wordsB = new Set(normalizeWords(b));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection++;
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export const REPETITION_SIMILARITY_THRESHOLD = 0.7;

/**
 * Marker written into no_op motives when the guard blocks a repeat.
 *
 * Load-bearing prose: the offline sweeps have no structural signal to count
 * guard blocks (the block is an ordinary `no_op` fallback, and `intent_blocked`
 * is also raised for rate limits and permission denials), so they match this
 * prefix. Keep it as the first token of the blocked motive.
 */
export const REPETITION_GUARD_MARKER = "Repetition guard";

/**
 * Repetition-guard policy knobs. Omitting either field reproduces the shipped
 * behavior: Jaccard threshold 0.7, exactly one retry before a structural block.
 *
 * Retries are billed but not pre-authorized by the surface's budget gate, which
 * runs once before the first call. `ActionIntentStep` therefore re-checks
 * `llmBudget.canCall` before every retry, so raising `maxRetries` cannot
 * multiply unmetered wire calls.
 */
export type RepetitionPolicy = {
  /** Similarity at or above which a candidate counts as a repeat. Clamped to [0, 1]. */
  threshold?: number;
  /** Retries allowed after a detected repeat before blocking. Clamped to a non-negative integer. */
  maxRetries?: number;
};

export const DEFAULT_REPETITION_MAX_RETRIES = 1;

/**
 * Returns true if `candidate` is a near-duplicate of any of the agent's own
 * recent utterances (word-overlap similarity >= threshold).
 */
export function isNearRepeat(
  candidate: string,
  ownRecentUtterances: readonly string[],
  threshold: number = REPETITION_SIMILARITY_THRESHOLD,
): boolean {
  if (!candidate || candidate.trim().length === 0) return false;
  return ownRecentUtterances.some((prior) => similarity(candidate, prior) >= threshold);
}
