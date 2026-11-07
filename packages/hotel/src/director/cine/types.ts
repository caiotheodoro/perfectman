/**
 * Types of the cinematic Director (docs/plans/hotel-cinematic.md).
 *
 * Everything the shot planner and the playback clock touch is plain data, so
 * the planner is a pure function of (item, world, state) and a test can drive a
 * whole scene without a socket, a model or a real timer.
 */
import type { PerfectmanUi } from "../generated.js";

export type Lang = "pt-BR" | "en";
export type Tile = readonly [x: number, y: number];

/** What the planner knows about how someone feels; absent means neutral. */
export type CineMood = { valence: number; arousal: number; affection?: number };

type ItemBase = {
  id: string;
  /** Arrival order; the tiebreak that keeps selection deterministic. */
  seq: number;
  /** Clock ms when the engine produced it (not when it plays). */
  at: number;
  /** The room the action happens in, a hotel room id. */
  room: number;
  ref: string;
};

export type LineItem = ItemBase & {
  kind: "line";
  text: string;
  mode: "say" | "shout" | "whisper";
  to?: string;
  /** 0..1. How much this line deserves the camera. */
  salience: number;
};
export type ThoughtItem = ItemBase & { kind: "thought"; text: string; salience: number };
/** A gated gesture (laugh, wave, ...): released to the hotel when it plays. */
export type GestureItem = ItemBase & { kind: "gesture"; gesture: string; salience: number };
/** Observed, live: someone walks. Only worth a tracking shot when it is fresh. */
export type WalkItem = ItemBase & { kind: "walk"; steps: number; salience: number };
/** Observed, live: someone takes a door to another room. */
export type HopItem = ItemBase & { kind: "hop"; to: number; salience: number };
/** Observed, live: a kiss or hug. */
export type PairItem = ItemBase & { kind: "pair"; pair: "kiss" | "hug"; with: string; salience: number };
/** A thing worth an insert shot: a piece of furniture, a tile, an injected world event. */
export type ObjectItem = ItemBase & { kind: "object"; furni?: number; tile?: Tile; label?: string; sfx?: string; salience: number };

export type CineItem = LineItem | ThoughtItem | GestureItem | WalkItem | HopItem | PairItem | ObjectItem;
export type CineItemKind = CineItem["kind"];

/** Items that are dropped rather than shown late. */
export const OPTIONAL_KINDS: ReadonlySet<CineItemKind> = new Set(["walk", "hop", "pair", "object"]);
/**
 * Things that already happened in the room, live. They are not held back, so the film can only show them
 * while they are fresh; they may be picked out of order, because their moment passes.
 */
export const LIVE_KINDS: ReadonlySet<CineItemKind> = new Set(["walk", "hop", "pair"]);

/** What the planner asks of the hotel mirror. */
export interface CineWorld {
  avatarId(ref: string): number | undefined;
  nameOf(ref: string): string;
  roleOf(ref: string): string | undefined;
  tileOf(ref: string): Tile | undefined;
  roomOf(ref: string): number | undefined;
  /** Refs of the actors in a room. */
  occupants(room: number): string[];
  roomName(room: number): string;
  moodOf(ref: string): CineMood | undefined;
}

/** Narrator output as the planner reads it (always synchronous: the director awaits readiness first). */
export interface NarrationSource {
  card(room: number, kind: "title" | "scene"): { title: string; subtitle?: string };
  caption(room: number, kind: "scene" | "idle"): string | undefined;
}

export type Step =
  | { at: number; k: "ui"; ui: PerfectmanUi }
  | { at: number; k: "release"; item: LineItem | GestureItem | WalkItem | HopItem | PairItem }
  | { at: number; k: "typing"; ref: string }
  | { at: number; k: "next_room"; room: number }
  | { at: number; k: "cut"; room: number; from: number };

export type Program = {
  /** The item this program stages; absent for the intro, a filler or the end. */
  beat: string;
  room: number;
  /** Time until the next program may start (steps may be earlier). */
  durationMs: number;
  steps: Step[];
};

export type TrackEntry =
  | { t: number; k: "start"; run: number; room: number; lang: Lang }
  | { t: number; k: "cue"; room: number; beat?: string; ui: PerfectmanUi }
  | { t: number; k: "line"; room: number; beat: string; ref: string; avatar: number | null; mode: string; text: string; ms: number }
  | { t: number; k: "cut"; room: number; from: number }
  | { t: number; k: "drop"; beat: string; why: string }
  | { t: number; k: "pause" }
  | { t: number; k: "resume" }
  | { t: number; k: "end"; reason: string };

export type CineConfig = {
  language: Lang;
  /** D18: how many pulses of content the engine may run ahead of playback. */
  lookaheadPulses: number;
  pulseMs: number;
  /** Scales readingSeconds (1 = the video renderer's pace). */
  readingScale: number;
  minShotMs: number;
  easeMs: { establishing: number; two_shot: number; close_up: number; tracking: number; reaction: number };
  beatGapMs: number;
  introMs: number;
  sceneCardMs: number;
  /** Silence this long on a non-empty room plays a filler (the dead-air guard, well under deadAirMs). */
  fillerAfterMs: number;
  fillerMs: number;
  maxConsecutiveFillers: number;
  deadAirMs: number;
  /** A room cut within this long of the last one needs a much better reason. */
  minRoomHoldMs: number;
  maxRoomHoldMs: number;
  optionalMaxAgeMs: Record<"walk" | "hop" | "pair" | "object", number>;
  /** Cues that take in_ms go this much early so socket latency does not eat the ease. */
  cueLeadMs: number;
  typingLeadMs: number;
  closeUpSalience: number;
  reactionIntensity: number;
  emotionCueIntensity: number;
  stingGapMs: number;
  emotionCueGapMs: number;
  /** The most the director waits for the narrator before playing fallback text. */
  narratorWaitMs: number;
  drainMs: number;
};

export const DEFAULT_CINE: CineConfig = {
  language: "pt-BR",
  lookaheadPulses: 2,
  pulseMs: 6000,
  readingScale: 1,
  minShotMs: 1800,
  easeMs: { establishing: 700, two_shot: 700, close_up: 450, tracking: 700, reaction: 450 },
  beatGapMs: 250,
  introMs: 3600,
  sceneCardMs: 2600,
  fillerAfterMs: 4500,
  fillerMs: 3200,
  maxConsecutiveFillers: 8,
  deadAirMs: 10_000,
  minRoomHoldMs: 6000,
  maxRoomHoldMs: 25_000,
  optionalMaxAgeMs: { walk: 5000, hop: 8000, pair: 4000, object: 4000 },
  cueLeadMs: 300,
  typingLeadMs: 500,
  closeUpSalience: 0.65,
  reactionIntensity: 0.6,
  emotionCueIntensity: 0.7,
  stingGapMs: 20_000,
  emotionCueGapMs: 15_000,
  narratorWaitMs: 1500,
  drainMs: 20_000,
};
