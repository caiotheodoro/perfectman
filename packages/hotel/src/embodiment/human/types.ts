import type { SpeechMode, Tile } from "@perfectman/shared";

/** One spoken line as the human layer sees it. Built by `lineFacts` from the text and what the run knows about it. */
export type HumanLine = {
  /** Counts lines in the run, 1-based: the key of every deterministic draw about this line. */
  n: number;
  speaker: string;
  /** The person it is for, when the run knows. */
  to?: string;
  /** Run clock, ms, when the line reached the wire. */
  atMs: number;
  text: string;
  words: number;
  mode: SpeechMode;
  /** Other people the text names (not the speaker, not the addressee). */
  mentioned: string[];
  /** The strongest hostile thing the line says of its own (the hostility lexicon), if any. */
  hostile?: string;
  question: boolean;
  /** Exclamation marks, capitals: how loudly the text is written, 0..1. */
  stress: number;
  /** Laughter markers (haha, kkk, rs) or a joke's tell. */
  amusement: boolean;
  /** Authored: the speaker is lying in this line (a beat sheet's note or reveal says so). */
  lie?: boolean;
  /** Authored or read: the line reveals something hidden, or accuses. */
  reveal?: boolean;
  /** The line was cut off by an interruption. */
  cut?: boolean;
};

/** A thing in the room that matters to the scene (the envelope, the safe), and the words that point at it. */
export type HumanProp = { id: string; label: string; tile: Tile; words: readonly string[] };

/** What the planner is given when the human layer is on (`PlanInput.human`). Absent means every rule here is silent. */
export type HumanPlanCtx = {
  /** `human_likeness`, 0..1. */
  h: number;
  seed: number;
  /** Recent lines, oldest first. */
  lines: readonly HumanLine[];
  /** Movement is held: a beat sheet's blocking beat or an act's staging owns this actor's feet. */
  hold?: boolean;
  props?: readonly HumanProp[];
  /** Who last shoved, slapped or punched this actor, and when. */
  hitBy?: { ref: string; at: number };
  /** The body log. */
  log?: (entry: HumanLogEntry) => void;
};

export type HumanLogKind = "walk" | "face" | "gaze" | "gesture" | "expression" | "typing" | "backchannel" | "interrupt" | "idle" | "react" | "latency";

/** One line of `body-log.jsonl`: what the human layer did, and the rule that did it. `t_ms` is added by the writer (run clock). */
export type HumanLogEntry = {
  actor: string;
  kind: HumanLogKind;
  rule: string;
  /** The line this was about. */
  line?: number;
  to?: string;
  tile?: Tile;
  dist?: number;
  ms?: number;
  detail?: string;
  /** `skipped:<why>` for a rule that had a reason to act and held back. */
  skipped?: string;
};
