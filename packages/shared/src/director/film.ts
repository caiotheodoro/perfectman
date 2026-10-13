/**
 * A film as a function of the replay and a few choices, with every measurement
 * taken from the glyph table, so node and a page lay it out identically.
 */
import { makePageWords, planBalloons } from "./balloon-layout.js";
import { tableMeasurer } from "./balloon-metrics.js";
import { stripOmniscient } from "./sample.js";
import { buildTimeline, type Timeline } from "./timeline.js";
import type { DirectorReplay, HuddleMode } from "./types.js";

export type FilmChoices = {
  /** Words a viewer reads per second. */
  pace: number;
  huddle: HuddleMode;
  /** Leave the private thoughts out altogether. */
  fictionOnly: boolean;
};

export function buildFilmTimeline(replay: DirectorReplay, choices: FilmChoices): Timeline {
  const ctx = { archetype: (id: string) => replay.agentProfiles?.[id]?.archetype ?? replay.agentArchetypes[id] ?? "", measure: tableMeasurer };
  const T = buildTimeline(replay, { pace: choices.pace, huddle: choices.huddle, pageWords: makePageWords(ctx) });
  planBalloons(T, ctx);
  return choices.fictionOnly ? stripOmniscient(T) : T;
}
