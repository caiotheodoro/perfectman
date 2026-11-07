import type { HearingLevel, Presence, SpeechMode, Tile } from "@perfectman/shared";
import { chebyshev } from "./geometry.js";

/** Seeds (embodiment.md 7.3); calibrate after the first real runs. */
export const SAY_CLEAR_TILES = 6;
export const SAY_GARBLED_TILES = 10;
export const WHISPER_NOTICE_TILES = 2;

export type HearingResult = {
  /** Listener agentId to level, only for listeners who get the event at all. */
  hearing: Record<string, HearingLevel>;
  /** Everyone who gets the event. Empty means nobody hears it (the `operator_only` shape). */
  visibleToAgents: string[];
};

export type Speaker = { tile: Tile; mode: SpeechMode; /** whisper target, an agentId */ target?: string };

/**
 * Per-listener audibility of a line (D29, D44, embodiment.md 5.2). Only
 * listeners in the speaker's room are considered; the caller passes exactly
 * those. A whisper reaches its target alone, bystanders within 2 tiles get a
 * `notice` (no text), everyone else hears nothing.
 */
export function computeHearing(speaker: Speaker, listeners: readonly Pick<Presence, "ref" | "tile">[]): HearingResult {
  const hearing: Record<string, HearingLevel> = {};
  for (const l of listeners) {
    const d = chebyshev(speaker.tile, l.tile);
    if (speaker.mode === "shout") {
      hearing[l.ref] = "clear";
    } else if (speaker.mode === "whisper") {
      if (l.ref === speaker.target) hearing[l.ref] = "clear";
      else if (d <= WHISPER_NOTICE_TILES) hearing[l.ref] = "notice";
    } else if (d <= SAY_CLEAR_TILES) hearing[l.ref] = "clear";
    else if (d <= SAY_GARBLED_TILES) hearing[l.ref] = "garbled";
  }
  return { hearing, visibleToAgents: Object.keys(hearing) };
}
