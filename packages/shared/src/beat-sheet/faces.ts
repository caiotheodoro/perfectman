import { BODY_EXPRESSIONS } from "../space/body-intent.schema.js";
import type { Face } from "./types.js";

/**
 * The faces the wire knows: the nine of `Face` (styles 0..=8; `fear`, `disgust` and `smug` are 6..=8, verb table rev 4), which are the nine a sheet may ask for.
 * A model's own `body.expression` still takes the six of `BODY_EXPRESSIONS`. `FACE_FALLBACK` is for a hotel that offers fewer: pass that hotel's list as `native`
 * and a face it lacks goes out as the nearest old one, so the beat still lands.
 */
export const WIRE_FACES: readonly Face[] = ["neutral", "smile", "angry", "sad", "surprised", "sleepy", "fear", "disgust", "smug"];

export const FACE_FALLBACK: Readonly<Record<Face, (typeof BODY_EXPRESSIONS)[number]>> = {
  neutral: "neutral",
  smile: "smile",
  angry: "angry",
  sad: "sad",
  surprised: "surprised",
  sleepy: "sleepy",
  fear: "surprised",
  disgust: "angry",
  smug: "smile",
};

export function wireFace(face: Face, native: readonly string[] = WIRE_FACES): string {
  return native.includes(face) ? face : FACE_FALLBACK[face];
}
