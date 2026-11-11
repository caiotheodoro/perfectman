import { isBoilerplate } from "../boilerplate.js";
import type { CineEvent, CineScene } from "../types.js";

const SLUG = /^\s*(?:CENA\s+\d+[.:\-–]?\s*\S.*|(?:INT|EXT|I\/E|INT\.?\/EXT|EXT\.?\/INT)[.\/ ]\s*\S.*)$/;
const indentOf = (l: string): number => l.length - l.trimStart().length;
const isUpperCue = (t: string): boolean => /^[\p{Lu}0-9 .'\-()/&]+$/u.test(t) && /\p{Lu}{2}/u.test(t) && t.length <= 42;

/**
 * A screenplay in `pdftotext -layout` form (scene heading, character cue indented far, dialogue indented a little, action flush) to scenes.
 * Indents are read relative to the leftmost script line, so a script set in a margin works the same. Parsing starts at the first scene heading
 * and stops 40 lines after the last, so a thesis's front matter and references are left out. Scenes are cut at each heading.
 */
export function parseLayoutScreenplay(raw: string, sourceId: string): CineScene[] {
  const all = raw.replace(/\f/g, "\n").split("\n");
  const first = all.findIndex((l) => SLUG.test(l));
  if (first < 0) return [];
  let last = first;
  all.forEach((l, i) => { if (i > first && SLUG.test(l)) last = i; });
  const lines = all.slice(first, Math.min(all.length, last + 40));
  const body = lines.filter((l) => l.trim() !== "" && !/^\s*\d{1,3}\s*$/.test(l));
  const base = Math.min(...body.map(indentOf));
  const scenes: CineScene[] = [];
  let cur: CineEvent[] = [];
  const flush = (): void => { if (cur.some((e) => e.kind === "speech")) scenes.push({ sourceId, index: scenes.length, events: cur }); cur = []; };
  let speaker: string | null = null;
  let buf: string[] = [];
  let action: string[] = [];
  const endSpeech = (): void => { if (speaker && buf.length) cur.push({ kind: "speech", speaker, text: buf.join(" ").replace(/\s+/g, " ").trim() }); buf = []; };
  const endAction = (): void => { if (action.length) cur.push({ kind: "direction", text: action.join(" ").replace(/\s+/g, " ").trim() }); action = []; };
  for (const l of lines) {
    const t = l.trim();
    if (isBoilerplate(t)) continue;
    if (t === "" || /^\d{1,3}$/.test(t)) { endSpeech(); endAction(); speaker = speaker && buf.length === 0 ? speaker : null; continue; }
    if (SLUG.test(l)) { endSpeech(); endAction(); flush(); speaker = null; continue; }
    const rel = indentOf(l) - base;
    if (rel >= 14 && isUpperCue(t.replace(/\s*\(.*?\)\s*$/, "")) ) { endSpeech(); endAction(); speaker = t.replace(/\s*\(.*?\)\s*/g, " ").trim(); continue; }
    if (speaker && rel >= 4) {
      if (/^\(.*\)$/.test(t)) cur.push({ kind: "direction", text: t.slice(1, -1), parenthetical: true });
      else buf.push(t);
      continue;
    }
    // flush-left text: action, unless it follows a dialogue block directly (then it is action too)
    endSpeech();
    speaker = null;
    action.push(t);
  }
  endSpeech(); endAction(); flush();
  return scenes.map((s, i) => ({ ...s, index: i }));
}
