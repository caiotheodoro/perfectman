/**
 * The intro plays a real scene, not a diagram.
 *
 * Six beats, hand-written, no server involved: two people talk past a third,
 * and the third's reason for staying quiet shows up in handwriting. Everything
 * the product does is in there — silence as a choice, a motive nobody says, a
 * face that moves with a feeling — and nobody had to read a bullet list.
 *
 * These are the same beat and emotion shapes a real run produces, so the intro
 * renders through the same components as the stage.
 */
import type { FaceState, RecordedEmotion } from "@perfectman/shared";

export type IntroBeat = {
  /** Roster index of whoever holds the beat. */
  actor: number;
  line?: string;
  thought?: string;
  faces: FaceState[];
  emotions: RecordedEmotion[];
  hold: number;
};

export const INTRO_CAST = ["íris", "bruno", "marcela"];

const calm: RecordedEmotion = { source: "authored", label: "neutral" };
const warm: RecordedEmotion = { source: "authored", label: "smile" };
const wary: RecordedEmotion = { source: "authored", label: "worried" };
const sharp: RecordedEmotion = { source: "authored", label: "angry" };

export const INTRO_BEATS: IntroBeat[] = [
  {
    actor: 0,
    line: "so are we talking about last night or not",
    faces: ["neutral", "neutral", "neutral"],
    emotions: [calm, calm, calm],
    hold: 3200,
  },
  {
    actor: 1,
    line: "there's nothing to talk about, honestly",
    faces: ["neutral", "smile", "worried"],
    emotions: [calm, warm, wary],
    hold: 3200,
  },
  {
    actor: 2,
    thought: "he answered her in four seconds. he read mine an hour ago.",
    faces: ["neutral", "smile", "worried"],
    emotions: [calm, warm, wary],
    hold: 4200,
  },
  {
    actor: 0,
    line: "marcela? you've been quiet",
    faces: ["neutral", "neutral", "worried"],
    emotions: [calm, calm, wary],
    hold: 3000,
  },
  {
    actor: 2,
    thought: "if i say it now it sounds like i counted. i counted.",
    faces: ["neutral", "worried", "angry"],
    emotions: [calm, wary, sharp],
    hold: 4400,
  },
  {
    actor: 2,
    line: "nope. all good.",
    faces: ["worried", "worried", "angry"],
    emotions: [wary, wary, sharp],
    hold: 3600,
  },
];
