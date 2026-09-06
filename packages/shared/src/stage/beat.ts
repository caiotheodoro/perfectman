/**
 * A beat: one thing the stage shows at one time.
 *
 * The live sibling of the video renderer's `VideoBeat`. Two deliberate
 * differences. It carries its own `text`, because the MP4 composition leaves
 * text out of its runtime data and scrapes it back out of pre-rendered DOM
 * nodes — workable for a fixed film, wrong for a view that re-renders. And it
 * has no `start`: a live run has no timeline yet, so the clock owns when a beat
 * begins and this only says how long it should hold.
 */
import type { RecordedEmotion } from "./emotion-face.js";

export type StageBeatKind = "message" | "silence" | "event" | "notice";

/** What an agent was actually thinking, which only the viewer ever sees. */
export type StageThought = {
  text: string;
  intentType?: string;
  drivers: string[];
};

export type StageBeat = {
  id: string;
  kind: StageBeatKind;
  pulseIndex: number;
  channelId: string;
  actorId?: string;
  text: string;
  /**
   * Empty means everyone in the channel. Reading this backwards inverts the
   * whole exclusion story, so it is never normalised on the way in.
   */
  audienceIds: string[];
  /** Everyone in frame for this beat, actor included. */
  participantIds: string[];
  emotion?: RecordedEmotion;
  thought?: StageThought;
  stageAction?: { kind: "arrive" | "leave" | "invite"; agentIds: string[] };
  /** Seconds this beat holds before the next one takes the stage. */
  duration: number;
};

/** Keep every code point and newline; split at a word boundary when possible. */
export function paginate(text: string, maxCharacters = 220): string[] {
  if (!text.length) return [""];
  const characters = Array.from(text);
  const pages: string[] = [];
  for (let start = 0; start < characters.length; ) {
    let end = Math.min(start + maxCharacters, characters.length);
    let newlines = 0;
    for (let i = start; i < end; i++) {
      if (characters[i] === "\n" && ++newlines === 5) {
        end = i + 1;
        break;
      }
    }
    if (end < characters.length && !/\s/u.test(characters[end - 1]!)) {
      for (let i = end - 1; i > start + Math.floor((end - start) / 2); i--) {
        if (/\s/u.test(characters[i]!)) {
          end = i + 1;
          break;
        }
      }
    }
    pages.push(characters.slice(start, end).join(""));
    start = end;
  }
  return pages;
}

/**
 * How long a line stays up, from the video renderer's reading model: a floor,
 * plus whichever of words-per-second and characters-per-second is slower.
 * Deliberately generous — the point is to be watchable, not efficient.
 */
export function readingSeconds(text: string): number {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(2.5, 1 + words / 3.2, 1 + Array.from(text).length / 24);
}
