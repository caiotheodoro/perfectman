/**
 * Cinema corpus: one neutral shape every source (stage text, screenplay XML, TV transcript, subtitle file) is turned into
 * before features are read. Text lives only in memory while a scene is being measured; nothing here is ever written out.
 */

export type CineLang = "pt" | "en";
export type CineMedium = "stage" | "film" | "series";
/** `drama`: family drama. `melodrama`: soap-opera and telenovela-style serials. */
export type CineGenre = "drama" | "melodrama" | "thriller" | "comedy" | "other";
/** `classic`: written before about 1930 (archaic diction). `modern`: later, or subtitles of recent releases. */
export type CineEra = "classic" | "modern";
/** `subtitle`: real cue times. `runtime`: scene length shared out of a known running time by text weight. `estimated`: text weight and a reading-rate model only. `clock`: every event carries a real timestamp (a hotel run); an event with no end lasts as long as the reading-rate model says. */
/** What the text is: stage text, screenplay, TV transcript or subtitle file. */
export type CineForm = "play" | "screenplay" | "transcript" | "subtitle";
export type TimeSource = "subtitle" | "runtime" | "estimated" | "clock";

export type CineEvent =
  | { kind: "speech"; speaker: string | null; text: string; t0?: number; t1?: number }
  /** A stage direction, action line or sound cue. `parenthetical` is an actor's note inside a speech ("wryly"). */
  | { kind: "direction"; text: string; parenthetical?: boolean; t0?: number };

export type CineScene = {
  sourceId: string;
  index: number;
  events: CineEvent[];
  /** Real scene length in seconds when the source has cue times. */
  durationSec?: number;
};

export type SourceInfo = {
  id: string;
  title: string;
  lang: CineLang;
  medium: CineMedium;
  genre: CineGenre;
  era: CineEra;
  form: CineForm;
  timeSource: TimeSource;
  /** Running time in minutes, when known (IMDb basics), used to share scene lengths out of a screenplay. */
  runtimeMin?: number;
  imdbId?: string;
  /** The work was written in this language (a Brazilian production for pt), not translated into it. Set for subtitle files only. */
  native?: boolean;
};

/** Everything measured about one scene. Numbers and flags only. */
export type SceneFeatures = {
  src: string;
  lang: CineLang;
  medium: CineMedium;
  genre: CineGenre;
  era: CineEra;
  form: CineForm;
  native: boolean;
  timeSource: TimeSource;
  turns: number;
  directions: number;
  /** False for subtitle files: they carry no action lines, so the direction and act figures below are null. */
  hasDirections: boolean;
  speechWords: number;
  dirWords: number;
  /** Seconds (real for subtitles, shared out of the running time or estimated otherwise). */
  durSec: number;
  // turn length
  wordsP50: number;
  wordsP90: number;
  shortShare: number; // replies of 5 words or fewer
  microShare: number; // replies of 2 words or fewer
  longShare: number; // turns of more than 25 words
  lenHist: number[]; // counts of turns by words: 1,2,3,4,5,6-7,8-10,11-15,16-25,26-40,41+
  // interruption and pauses
  interruptShare: number; // turns that end cut off by a dash
  ellipsisShare: number; // turns that trail off
  silentTurnShare: number; // turns that are only "..." or a pause word
  pauseMarkersPer100: number; // written pause markers (direction or parenthetical) per 100 turns
  overlapShare: number | null; // timed: turns that start before the previous one ends
  rapidShare: number | null; // timed: turns that follow the previous one by less than 0.25 s (back-to-back, incl. a dash-split cue)
  silenceShare: number | null; // timed: share of scene time with nobody talking
  gapsOver2sPerMin: number | null;
  medianGapSec: number | null;
  longestGapFrac: number | null;
  wordsPerSec: number | null;
  turnsPerMin: number;
  // stage directions and action
  dirPerTurn: number | null;
  dirPerMin: number | null;
  actsPerMin: number | null;
  hardActs: number | null;
  softActs: number | null;
  dialogueShare: number | null; // speech words / (speech + direction words)
  directionGapP50: number | null; // turns between two directions
  // arc
  curve: number[]; // 10 bins of smoothed conflict intensity over normalised scene time
  peak: number;
  baseline: number;
  peakRise: number; // peak minus the opening baseline
  tInciting: number | null; // fraction of the scene; null when the scene never rises
  tClimax: number | null;
  aftermathShare: number | null;
  reversals: number; // turning points of the smoothed intensity with a swing of 0.12 or more
  roleFlip: boolean | null; // who asks and who answers swaps between the opening and closing third
  reveals: number;
  accusations: number;
  commitments: number;
  eventsPer10: number; // reveals, accusations, commitments, hard acts and reversals per 10 turns
  longestQuietFrac: number; // longest stretch of turns with no event, as a fraction of the scene
};

/** Whole-source figures, one row per play, film, episode or subtitle file. */
export type SourceStats = {
  src: string;
  lang: CineLang;
  medium: CineMedium;
  genre: CineGenre;
  era: CineEra;
  form: CineForm;
  native: boolean;
  scenes: number;
  turns: number;
  /** Minutes of the source covered (subtitle span, running time, or estimate). */
  minutes: number;
  turnsPerMin: number;
  sceneMinP50: number;
  scenesPer10Min: number;
  dialogueShare: number | null;
  hardActsPer10Min: number | null;
  dirPerMin: number | null;
  // subtitle files only, over every cue pair in the file (not cut by the scene gap)
  talkShare: number | null;
  gaps2PerMin: number | null;
  gaps5PerMin: number | null;
  gaps12PerMin: number | null;
};
