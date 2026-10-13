/**
 * What the director reads, and what it produces.
 *
 * The input is a structural slice of a stored replay (`SimulationReplay` in the
 * server package satisfies it), so the director can run in the browser, in
 * node and inside the video renderer without depending on any of them.
 */
import type { SceneLook } from "../stage/scene-look.js";

export type DirectorMood = { valence: number; arousal: number; energy: number };

export type DirectorAgentState = {
  coreMood: DirectorMood;
  socialEmotions: Record<string, number>;
  relationalStates?: Record<string, Record<string, number>>;
};

export type DirectorEvent = {
  id: string;
  channelId: string;
  actorId: string;
  type: string;
  payload: Record<string, unknown>;
};

export type DirectorThinking = {
  privateMotiveSummary: string;
  emotionDrivers: string[];
  intentType?: string;
};

export type DirectorPulse = {
  pulseIndex: number;
  committedEvents: DirectorEvent[];
  agentStates: Record<string, DirectorAgentState>;
  agentThinking?: Record<string, DirectorThinking>;
};

export type DirectorProfile = {
  displayName: string;
  archetype: string;
  writingStyle?: string;
  language?: string;
  messageLength?: "short" | "medium" | "long" | "rapid_fire";
};

export type DirectorChannel = { id: string; name: string; type: string; memberAgentIds: string[] };

export type DirectorReplay = {
  agentIds: string[];
  agentNames: Record<string, string>;
  agentArchetypes: Record<string, string>;
  agentProfiles?: Record<string, DirectorProfile>;
  channels: DirectorChannel[];
  pulses: DirectorPulse[];
  storyClock?: { start: string; minutesPerPulse: number };
  look?: SceneLook;
};

/** The huddle shot when two or three people talk privately. */
export type HuddleMode = "push" | "door" | "wide";

export type DirectorOptions = {
  /** Words a viewer reads per second; see `PACES`. */
  pace?: number;
  huddle?: HuddleMode;
  /**
   * Measures how many words land on each page of a balloon, so a long line is
   * paced by its reading. Omit it and every line is treated as one page.
   */
  pageWords?: (line: { kind: BalloonKind; actor: string; text: string; arousal: number }) => number[] | null;
};

export type BalloonKind = "speech" | "shout" | "whisper" | "thought";

/** A point on the 1200 x 600 stage. */
export type Spot = { x: number; y: number; w: number };

export type CameraState = { cx: number; cy: number; z: number; pool: number; bg: number; room: number };

export type TimedWord = { t: number; len: number };

export type BalloonPage = {
  lines: string[];
  W: number;
  H: number;
  /** Index of the first word on this page, and how many words it holds. */
  w0: number;
  n: number;
  t0: number;
  t1: number;
};

export type Balloon = {
  id: string;
  kind: BalloonKind;
  actor: string;
  text: string;
  to?: string[];
  drivers?: string[];
  /** Words land from s0 to s1; the balloon shows from t0 to t1. */
  s0: number;
  s1: number;
  t0: number;
  t1: number;
  arousal: number;
  words: TimedWord[];
  wordCount: number;
  pulse: number;
  /** Only the omniscient lens shows it. */
  omniscient: boolean;
  sceneIndex: number;
  /** Set by `planBalloons`. */
  pages?: BalloonPage[];
  slot?: { cx: number; cy: number; tip: { x: number; y: number } };
  world?: { c: { x: number; y: number }; tip: { x: number; y: number }; z: number };
};

export type SceneKind = "wide" | "huddle";

export type Scene = {
  key: string;
  type: SceneKind;
  members: string[];
  t0: number;
  t1: number;
  cam: CameraState;
};

export type TimelineMessage = {
  id: string;
  actor: string;
  channelId: string;
  text: string;
  to: string[];
  /** True when the engine did not record the addressees and they were inferred. */
  inferred: boolean;
  pulse: number;
  s0: number;
  s1: number;
  readEnd: number;
  wordCount: number;
  words: TimedWord[];
  sceneIndex: number;
};

export type ReactionMark = { t: number; dur: number; actor: string; kind: "steam" | "sweat" | "heart" | "?" | "*" };
export type Caption = { t0: number; t1: number; text: string; where: "bl" | "top" };
export type Cue = { t: number; actor: string; text: string; whisper: boolean };
export type LightKey = { t: number; minute: number };
