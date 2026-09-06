/**
 * Which `privateMotiveSummary` strings the engine wrote on the agent's behalf
 * instead of the model.
 *
 * This lives in `shared` because every reader needs it and one of those readers
 * is the browser. Anything that renders a motive as the character's private
 * truth — the narrator, the spectator view, the web stage — has to exclude
 * these: a JSON parse error is not a feeling. Pulling it in from
 * `@perfectman/server` would drag `better-sqlite3`, `discord.js` and `ollama`
 * into a bundle that has no use for them.
 *
 * A committed event carries no separate "this was a fallback" flag (see the
 * no-conflation note on `repetition_blocked` in event.types.ts), so prefix
 * matching is the one signal every reader shares. `private_motive_summary`
 * events stamp the verdict as `engineAuthored` at emission so downstream code
 * stops re-deriving it.
 */

/** Marker the repetition guard writes into a blocked intent's motive. */
export const REPETITION_GUARD_MARKER = "Repetition guard";

/**
 * Prefixes written by `IntentParser.createFallback`, the retry-exhausted floor,
 * the budget and provider gates in `action-intent-step.ts`, and the repetition
 * guard.
 */
export const ENGINE_MOTIVE_PREFIXES: readonly string[] = [
  "Fallback applied:",
  `${REPETITION_GUARD_MARKER}:`,
  "LLM budget exceeded:",
  "Provider failed:",
  "Retry call failed.",
  "Reaction target unresolvable",
  "unresolvable ",
];

export function isEngineAuthoredMotive(motive: string): boolean {
  return ENGINE_MOTIVE_PREFIXES.some((prefix) => motive.startsWith(prefix));
}
