import { isBoilerplate } from "../boilerplate.js";
import type { CineEvent, CineScene } from "../types.js";

const SPEAKER = /^([A-Za-z][A-Za-z0-9 .'#&\-/]{0,30}?):\s+(.*)$/;
/** A stage line that opens a new place or time in a transcript. */
const SCENE_CUE = /^\(?\s*(?:int|ext)[. \/]|^\(?\s*(?:the\s+)?(?:next|later|meanwhile|back|cut|flashback|that\s+(?:night|evening|morning)|the\s+following|at|in|inside|outside|on|downstairs|upstairs|commercial|credits|opening|title|scene|an?|\w+['’]s\s+(?:house|apartment|room|office|place))\b/i;
const words = (t: string): number => t.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;

/**
 * Forever Dreaming transcript lines ("NAME: text", "(stage direction)") to scenes. Transcripts carry no scene numbers, so a new scene starts at a
 * stand-alone direction of four or more words that opens like a change of place or time. Inline (parentheses) directions inside a line stay with it
 * as direction events. This cut is heuristic (see the reliability notes in the norms).
 */
export function parseSummScreen(lines: readonly string[], sourceId: string, maxTurns = 120): CineScene[] {
  const scenes: CineScene[] = [];
  let cur: CineEvent[] = [];
  const flush = (): void => {
    if (cur.some((e) => e.kind === "speech")) for (const part of capScene(cur, maxTurns)) scenes.push({ sourceId, index: scenes.length, events: part });
    cur = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line === "[NEXT_ON]" || isBoilerplate(line)) continue;
    if (line === "[SCENE_BREAK]") { flush(); continue; }
    if (/^[([]?\s*(?:theme\s+)?music\b|^[([]?\s*sfx\s*:|opening (?:title|credits)|^[([]?\s*commercial/i.test(line) && !SPEAKER.test(line)) continue;
    const standalone = /^[([].*[)\]]$/.test(line);
    if (standalone) {
      const t = line.slice(1, -1).trim();
      if ((words(t) >= 4 || /^(?:int|ext)[. \/]/i.test(t)) && SCENE_CUE.test(t)) flush();
      cur.push({ kind: "direction", text: t });
      continue;
    }
    const m = SPEAKER.exec(line);
    if (!m) { if (words(line) >= 3) cur.push({ kind: "direction", text: line }); continue; }
    const speaker = m[1]!.trim().toUpperCase();
    let text = m[2]!;
    const inline: string[] = [];
    text = text.replace(/[([]([^)\]]{3,200})[)\]]/g, (_all, d: string) => { inline.push(d.trim()); return " "; }).replace(/\s+/g, " ").trim();
    if (text !== "") cur.push({ kind: "speech", speaker, text });
    for (const d of inline) cur.push({ kind: "direction", text: d, parenthetical: words(d) < 3 });
  }
  flush();
  return scenes;
}

/** A stretch with more than `maxTurns` spoken turns (a transcript with no scene marks) is cut at the speech nearest its middle, recursively. */
export function capScene(evs: CineEvent[], maxTurns: number): CineEvent[][] {
  const turns = evs.filter((e) => e.kind === "speech").length;
  if (turns <= maxTurns) return [evs];
  let seen = 0, cut = evs.length;
  for (let i = 0; i < evs.length; i++) { if (evs[i]!.kind === "speech" && ++seen > turns / 2) { cut = i; break; } }
  return [...capScene(evs.slice(0, cut), maxTurns), ...capScene(evs.slice(cut), maxTurns)];
}
