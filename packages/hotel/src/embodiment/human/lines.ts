import type { SpeechMode } from "@perfectman/shared";
import { readHostility } from "../../director/drama/hostility.js";
import { namedIn } from "../plan.js";
import type { HumanLine } from "./types.js";

const AMUSED = /(\b(?:ha){2,}\b|\bk{3,}\b|\brs+\b|\bhehe+\b|\bhaha+\b|\blol\b|\bkkk+)/i;

/** Words of a line, split on whitespace; a dash alone is not a word. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * Everything the human layer wants to know about a line, read from its text (no model): length, a question, how loudly it is written, laughter,
 * the hostile or revealing thing it says, and who it names. `lie` and `reveal` are authored (a beat sheet's note, a planted reveal) and win over the read.
 */
export function lineFacts(o: {
  n: number;
  speaker: string;
  to?: string;
  atMs: number;
  text: string;
  mode?: SpeechMode;
  /** ref -> display name of the cast, to find who a line names. */
  cast?: ReadonlyMap<string, string>;
  lie?: boolean;
  reveal?: boolean;
}): HumanLine {
  const text = o.text.replace(/\s+/g, " ").trim();
  const letters = text.replace(/[^\p{L}]/gu, "");
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  const bangs = text.match(/!/g)?.length ?? 0;
  const caps = letters.length >= 5 ? upper / letters.length : 0;
  const stress = Math.min(1, bangs * 0.3 + (caps > 0.5 ? 0.5 : 0) + (o.mode === "shout" ? 0.5 : 0));
  const own = readHostility(text).own;
  const mentioned = o.cast ? namedIn(text, o.cast).filter((r) => r !== o.speaker && r !== o.to) : [];
  const reveal = o.reveal ?? (own === "accusation" || own === "blackmail");
  return {
    n: o.n,
    speaker: o.speaker,
    ...(o.to ? { to: o.to } : {}),
    atMs: o.atMs,
    text,
    words: wordCount(text),
    mode: o.mode ?? "say",
    mentioned,
    ...(own ? { hostile: own } : {}),
    question: /\?\s*$/.test(text) || /\?/.test(text.slice(-12)),
    stress,
    amusement: AMUSED.test(text),
    ...(o.lie !== undefined ? { lie: o.lie } : {}),
    ...(reveal ? { reveal } : {}),
  };
}
