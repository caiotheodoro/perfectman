import { REPETITION_GUARD_MARKER } from "./repetition-guard.js";

/**
 * Prefixes of every `privateMotiveSummary` the engine writes on the agent's
 * behalf instead of the model: `IntentParser.createFallback`, the
 * retry-exhausted floor and the budget/provider gates in
 * `action-intent-step.ts`, and the repetition guard. A committed event
 * carries no separate "this was a fallback" flag (see the no-conflation note
 * on `repetition_blocked` in event.types.ts), so prefix matching is the one
 * signal every reader shares — the same convention `REPETITION_GUARD_MARKER`
 * already relies on.
 *
 * Readers that render a motive as the character's private truth (narrator,
 * spectator hints, probes) must exclude these; a JSON parse error is not a
 * feeling. `private_motive_summary` events stamp the verdict as
 * `engineAuthored` at emission so downstream code stops re-deriving it.
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
