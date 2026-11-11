import { BODY_EXPRESSIONS } from "../space/body-intent.schema.js";
import type { Face } from "./types.js";

/**
 * The faces the wire knows today are the six of `BODY_EXPRESSIONS`; `fear`, `disgust` and `smug` are B3's new styles (Contract B). Until the hotel offers
 * them a sheet's face is sent as the nearest old one, so the beat still lands. Pass the wire's own list as `native` once B3's styles ship and the fallback
 * stops being used.
 */
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

export function wireFace(face: Face, native: readonly string[] = BODY_EXPRESSIONS): string {
  return native.includes(face) ? face : FACE_FALLBACK[face];
}
