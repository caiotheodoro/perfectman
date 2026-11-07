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

import type { PerceptionPacket } from "@perfectman/shared";

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
  // Two sets that both normalize to zero words carry no overlapping content
  // evidence — scoring them 1.0 made `isNearRepeat("😂", ["🔥"])` a false
  // positive inside the runtime guard (emoji-only messages blocked as
  // repeats). The probes exclude empty-normalizing turns at their own layer.
  if (wordsA.size === 0 && wordsB.size === 0) return 0;
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
export { REPETITION_GUARD_MARKER } from "@perfectman/shared";

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
  /**
   * Hotel mode: similarity at or above which a line counts as a copy of something ANOTHER cast member just said
   * (three people saying the same sentence). Absent means no cross-actor check, the shipped behavior. Only lines of
   * three or more content words are compared, so a shared "Verdade." or "Oi!" is never a copy.
   */
  roomThreshold?: number;
  /**
   * Hotel mode: retries allowed when nobody spoke to the actor (an ambient turn). A repeat on a turn nobody waits on
   * is not worth the same spend as one a person asked for. Absent means `maxRetries`.
   */
  ambientMaxRetries?: number;
};

/** Content words a line needs before it can be a copy of another person's (see `RepetitionPolicy.roomThreshold`). */
export const ROOM_REPEAT_MIN_WORDS = 3;
/** How many of the room's newest cast lines a new line is compared with. */
export const ROOM_LINES_LIMIT = 8;

/**
 * What the OTHER cast members just said where this agent can hear it: their say/reply lines in the event window and
 * the line that woke it. A person's line (untrusted) is not in this list: answering a guest in the guest's words is the
 * house rules' business, not a repetition.
 */
export function roomLinesHeard(packet: Pick<PerceptionPacket, "agentId" | "triggeringEvent" | "visibleContextEvents">): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [...packet.visibleContextEvents, ...(packet.triggeringEvent ? [packet.triggeringEvent] : [])]) {
    if (e.type !== "message_sent" && e.type !== "reply_sent") continue;
    if (e.actorId === packet.agentId || seen.has(e.id)) continue;
    const payload = e.payload as Record<string, unknown> | undefined;
    if (payload?.["untrusted"] === true) continue;
    const content = payload?.["content"];
    if (typeof content !== "string" || content.trim().length === 0) continue;
    seen.add(e.id);
    out.push(content);
  }
  return out.slice(-ROOM_LINES_LIMIT);
}

/** True when `candidate` is a near-duplicate of a line somebody else in the room just said. */
export function isRoomCopy(candidate: string, roomLines: readonly string[], threshold: number): boolean {
  if (normalizeWords(candidate).length < ROOM_REPEAT_MIN_WORDS) return false;
  return roomLines.some((line) => normalizeWords(line).length >= ROOM_REPEAT_MIN_WORDS && similarity(candidate, line) >= threshold);
}

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
  // A candidate that normalizes to zero words (emoji/stopword-only) cannot
  // be a repeat no matter what the priors look like — the Jaccard over two
  // empty sets is now 0, but short-circuit here so the intent is explicit.
  if (normalizeWords(candidate).length === 0) return false;
  return ownRecentUtterances.some((prior) => similarity(candidate, prior) >= threshold);
}
