/**
 * How far back an agent remembers what it already said. Both are owned by
 * the eval's sweep-repetition harness (`packages/eval/src/cli/sweep-repetition.ts`).
 *
 * OWN_HISTORY_LIMIT: own messages the scheduler hands the engine from the
 * full committed log, independent of the 40-event shared context window.
 * OWN_UTTERANCE_WINDOW: own utterances the perception packet keeps (was 5,
 * drawn from the shared window only — ~8-12 pulses in a 4-agent room, which
 * is why a re-announcement at pulse 18 sailed past the guard).
 */
export const OWN_HISTORY_LIMIT = 12;
export const OWN_UTTERANCE_WINDOW = 12;
