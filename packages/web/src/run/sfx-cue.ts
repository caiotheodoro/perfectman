/**
 * Which one-shot sound a beat makes, if any.
 *
 * Pure, so the rule is testable without an audio element: a spoken line clicks
 * once — on its first page, because a long line is several beats — someone
 * arriving or leaving gets their own cue, and a thought makes no sound because
 * nobody in the room heard it.
 */
import type { SFX, StageBeat } from "@perfectman/shared";

export function sfxCueFor(beat: StageBeat): keyof typeof SFX | null {
  if (beat.stageAction) return beat.stageAction.kind === "leave" ? "departure" : "arrival";
  if (beat.kind === "message" && beat.page === 0) return "message";
  return null;
}
