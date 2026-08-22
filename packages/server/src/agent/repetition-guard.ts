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
function normalizeWords(text: string): string[] {
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
function similarity(a: string, b: string): number {
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
