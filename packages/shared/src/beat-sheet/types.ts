import type { ActVerb } from "../space/act-verbs.js";

/**
 * The beat sheet (Contract A of the cinematic revamp): the scene's whole shape, written once at scene compile by the director step and
 * played on the run clock. Hybrid: the sheet fixes the arc, the blocking, the props, the planted information, the camera intent and the
 * physical climax; the actors still improvise every word inside it. A sheet NEVER carries dialogue (`gist`, `objective`, `subtext` steer).
 *
 * Refs: the form and the model write cast names; the compiled body carries agent ids (`person-N`), as `ScenarioBeat` does.
 * Time: ms on the run clock, counted from the moment the cast is in (the same zero as `body.beats`).
 */

export const SHEET_PHASES = ["setup", "inciting", "escalation", "reversal", "climax", "aftermath"] as const;
export type Phase = (typeof SHEET_PHASES)[number];

export const SHEET_FACES = ["neutral", "smile", "angry", "sad", "surprised", "sleepy", "fear", "disgust", "smug"] as const;
export type Face = (typeof SHEET_FACES)[number];

export const SHEET_SHOTS = ["establishing", "two_shot", "close_up", "tracking", "reaction", "insert"] as const;
export const SHEET_MOVES = ["dolly_in", "dolly_out", "shake", "slowmo", "vignette", "hitstop"] as const;
export type CameraIntent = {
  shot: (typeof SHEET_SHOTS)[number];
  /** A cast ref (agent id), a furniture/zone label, or a pair of refs. */
  on?: string | [string, string];
  zoom?: number;
  /** Move kinds are B4's wire additions (Contract B). */
  move?: (typeof SHEET_MOVES)[number];
  amount?: number;
  ms?: number;
};

export const SHEET_PROP_OPS = ["take", "hand", "place", "show", "break", "read"] as const;
export type PropOp = (typeof SHEET_PROP_OPS)[number];
export const SHEET_BLOCK_HOWS = ["walk", "enter", "exit", "storm"] as const;
export const SHEET_REVEAL_VIAS = ["say", "show", "overhear"] as const;

export type SheetPlace = { tile?: [number, number]; zone?: string; near?: string };

type SheetBeatBase = {
  id: string;
  at_ms: number;
  phase: Phase;
  /** What this moment is for, shown to the actors as scene direction. */
  gist?: string;
};

export type SheetBeat = SheetBeatBase &
  (
    | { kind: "act"; actor: string; verb: ActVerb; with?: string; authored_skip?: true; climax?: true }
    | { kind: "cut"; reason: string }
    | { kind: "block"; actor: string; to: SheetPlace; how?: (typeof SHEET_BLOCK_HOWS)[number] }
    | { kind: "prop"; actor: string; prop: string; op: PropOp; to?: string }
    | { kind: "reveal"; fact: string; to: string[]; from?: string; via: (typeof SHEET_REVEAL_VIAS)[number] }
    | { kind: "note"; actor: string; objective: string; tactic?: string; subtext?: string; until_ms?: number }
    | { kind: "pause"; ms: number }
    | { kind: "expression"; actor: string; face: Face; ms?: number }
    | { kind: "camera"; intent: CameraIntent }
  );

export type SheetBeatKind = SheetBeat["kind"];

export type BeatSheetArc = {
  /** HARD: at most 90 000. */
  inciting_at_ms: number;
  reversal_at_ms?: number;
  /** HARD: at most 240 000, and the climax beat is a physical act at exactly this time. */
  climax_at_ms: number;
  aftermath_until_ms: number;
};

export type BeatSheetOrigin = {
  model: string;
  /** At most `SHEET_COST_CAP_USD`. */
  cost_usd: number;
  ms: number;
  /** Additive: hash of the scenario inputs the sheet was written from, so a changed scenario regenerates it and a hand edit does not. */
  input_hash?: string;
  /** Additive: the deterministic mock wrote it (tests, `PERFECTMAN_LLM_PROVIDER=mock`). */
  mock?: true;
  /** Additive: model calls it took (1, or 2 after a retry on the validator's error list). */
  attempts?: number;
};

export type BeatSheet = {
  version: 1;
  premise: string;
  stakes: string;
  arc: BeatSheetArc;
  beats: SheetBeat[];
  generated_by?: BeatSheetOrigin;
};

/** One compile or validation row, the `DramaRow` shape (`{path, message}`); a warning's message starts with its id (`beat_sheet.prop_mimed`). */
export type SheetIssue = { path: string; message: string };

/** The room the sheet is written for, when it is known at compile (the hotel may pass it; absent, props and places are free names the planner mimes or resolves at run time). */
export type RoomBrief = {
  furni?: ReadonlyArray<{ id?: string | number; label: string }>;
  zones?: ReadonlyArray<{ id?: string; kind?: string; label: string }>;
  places?: readonly string[];
};

/** What a scene's `drama` block says that the sheet's acts are held to (structurally the hotel's `ScenarioDrama`). */
export type SheetDrama = { max_rung: number; may_target: ReadonlyArray<readonly [string, string]>; may_die: readonly string[] };

export type SheetCastMember = { id: string; displayName: string };

export const SHEET_VERSION = 1 as const;
export const MAX_SHEET_BEATS = 60;
/** Contract A: the inciting incident lands by 90 s. */
export const INCITING_MAX_MS = 90_000;
/** Contract A, the hard invariant: a physical climax by 4:00. */
export const CLIMAX_MAX_MS = 240_000;
/** A climax later than this leaves the forcing path (retries on a busy actor, the walk-up) too little room: a warning. */
export const CLIMAX_COMFORT_MS = 225_000;
/** The longest a sheet scene runs. */
export const AFTERMATH_MAX_MS = 600_000;
/** Contract A, invariant 4: a reversal is asked of a scene longer than this. */
export const REVERSAL_SCENE_MS = 120_000;
export const SHEET_COST_CAP_USD = 0.3;
export const SHEET_TIMEOUT_MS = 25_000;
/** Longest authored silence. */
export const PAUSE_MAX_MS = 15_000;
/** GATE-9 / LAD-3: physical beats are this far apart. */
export const SHEET_PHYSICAL_SPACING_MS = 20_000;
/** SCENE-5: a cut comes this long after the scene began or the cut before. */
export const SHEET_CUT_FLOOR_MS = 20_000;

/** Invariant 1: the climax is one of these (the contract's list; `grab` is B3's new verb and is not in the vocabulary yet, so it cannot pass the verb check until it is). */
export const CLIMAX_VERBS = ["slap", "punch", "kill", "die", "shove", "restrain", "grab", "hug", "kiss"] as const;
