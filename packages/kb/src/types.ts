import type { ActionType, Emotion, Medium, StatusDelta } from "./taxonomy.js";

/** A source file as the corpus manifest describes it. `license_class` decides what may ever be committed (see README). */
export type SourceMeta = {
  file: string;
  title: string;
  author: string;
  language: string;
  medium: Medium;
  source_url: string;
  retrieved: string;
  license_line: string;
  license_class: string;
  rights_flag?: string | null;
  /** Folder under corpus/ the file lives in. Filled by the loader. */
  dir?: string;
};

/** One thing on the page, in order: someone speaking, or a stage direction. */
export type Item = { kind: "speech"; speaker: string; text: string } | { kind: "direction"; text: string };

export type Scene = {
  sourceId: string;
  act: string;
  scene: string;
  heading: string;
  items: Item[];
};

export type Beat = {
  /** `<sourceId>:<act>.<scene>.<index>`, stable for a given file and parser version. */
  id: string;
  sourceId: string;
  title: string;
  author: string;
  language: string;
  medium: Medium;
  act: string;
  scene: string;
  index: number;
  /** Distinct speakers in the beat, in order of first speech. */
  speakers: string[];
  /** Distinct speakers in the whole scene: the cast on stage as far as the text shows. */
  castSize: number;
  text: string;
  /** Stage directions in the beat, verbatim. */
  directions: string[];
  /** Keyword guess at the physical action. A prior for the tagger, never the final tag. */
  actionHint: ActionType;
  license_class: string;
};

/** What the tagger returns for one beat. Validated against the taxonomy before it is stored. */
export type TagRecord = {
  id: string;
  tactic_verb: string;
  status_delta: StatusDelta;
  action_type: ActionType;
  emotion: Emotion;
  driver: string;
  target: string | null;
  /** 0 to 1, the tagger's own confidence. */
  confidence: number;
  /** False when the beat should be split or merged: a measure of the chunker, not a tag. */
  boundary_ok: boolean;
  tagged_by: string;
};

export type TaggedBeat = Beat & { tag: TagRecord };

/** A retrieved reference, shaped for `plan.json` `reference_beats` and for prompt injection. */
export type ReferenceBeat = {
  id: string;
  title: string;
  author: string;
  act: string;
  scene: string;
  medium: Medium;
  language: string;
  tactic_verb: string;
  status_delta: StatusDelta;
  action_type: ActionType;
  castSize: number;
  score: number;
  license_class: string;
  /** The beat text, cut at `maxChars`. Present only when the caller asks for it; never written into plan.json. */
  excerpt?: string;
};
