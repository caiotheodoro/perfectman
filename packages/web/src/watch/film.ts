/**
 * A replay becomes a film: a timeline, laid out and ready to sample.
 */
import {
  buildTimeline, makePageWords, planBalloons, PACES,
  type DirectorReplay, type HuddleMode, type PaceName, type TextMeasurer, type Timeline,
} from "@perfectman/shared";

export type Film = { T: Timeline; replay: DirectorReplay };

export function buildFilm(
  replay: DirectorReplay,
  opts: { pace?: PaceName; huddle?: HuddleMode; measure: TextMeasurer },
): Film {
  const ctx = { archetype: (id: string) => replay.agentProfiles?.[id]?.archetype ?? replay.agentArchetypes[id] ?? "", measure: opts.measure };
  const T = buildTimeline(replay, { pace: PACES[opts.pace ?? "normal"], huddle: opts.huddle ?? "push", pageWords: makePageWords(ctx) });
  planBalloons(T, ctx);
  return { T, replay };
}

export const formatDuration = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
