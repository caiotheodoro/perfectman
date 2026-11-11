import { isBoilerplate } from "../boilerplate.js";
import type { CineEvent, CineScene } from "../types.js";

const ENT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" };
const unent = (s: string): string => s.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => ENT[m] ?? m).replace(/\s+/g, " ").trim();
/** MovieSum tokenises with spaces around punctuation and bracket tokens; put them back so dashes and ellipses read as written. */
const detok = (s: string): string =>
  s.replace(/-LRB-/g, "(").replace(/-RRB-/g, ")").replace(/\s+([,.!?;:])/g, "$1").replace(/\s+(['’]s?)\b/g, "$1").replace(/(?:^|\s)-\s-(?=\s|$)/g, " --").replace(/\.\s\.\s\./g, "...");

/** A character cue that is really a scene number, a heading or a transition (a shooting script the formatter could not split). */
const BAD_SPEAKER = /^\d|\b(?:INT|EXT)\.|^(?:CUT TO|FADE|OMIT|CONTINUED|DISSOLVE)\b|\)$|^\W*\w?\W*$/;

/**
 * MovieSum screenplay XML (<scene>, <stage_direction> slug, <scene_description>, <character>, <parenthetical>, <dialogue>) to scenes.
 * A slug line is a scene heading and is not counted as an action line. A scene with more than `maxTurns` spoken turns is dropped (the
 * source's own scene cut failed there); the count is returned.
 */
export function parseMovieSum(xml: string, sourceId: string, maxTurns = 300): { scenes: CineScene[]; dropped: number; garbled: number } {
  const scenes: CineScene[] = [];
  let dropped = 0;
  let garbled = 0;
  let cur: CineEvent[] = [];
  let speaker: string | null = null;
  const flush = (): void => {
    if (cur.length === 0) return;
    const sp = cur.filter((e): e is Extract<CineEvent, { kind: "speech" }> => e.kind === "speech");
    const bad = sp.filter((e) => e.speaker !== null && BAD_SPEAKER.test(e.speaker)).length;
    if (sp.length > maxTurns) dropped += 1;
    else if (sp.length > 0 && bad / sp.length > 0.1) garbled += 1;
    else scenes.push({ sourceId, index: scenes.length, events: cur });
    cur = [];
  };
  const re = /<scene>|<(stage_direction|scene_description|character|parenthetical|dialogue)>([\s\S]*?)<\/\1>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (!m[1]) { flush(); speaker = null; continue; }
    const text = detok(unent(m[2] ?? ""));
    if (text === "") continue;
    if ((m[1] === "scene_description" || m[1] === "parenthetical") && isBoilerplate(text)) continue;
    switch (m[1]) {
      case "stage_direction": flush(); speaker = null; break;
      case "scene_description": cur.push({ kind: "direction", text }); break;
      case "character": speaker = text.replace(/\s*\(.*?\)\s*/g, " ").trim().toUpperCase(); break;
      case "parenthetical": cur.push({ kind: "direction", text, parenthetical: true }); break;
      case "dialogue": cur.push({ kind: "speech", speaker, text }); break;
    }
  }
  flush();
  return { scenes: scenes.map((s, i) => ({ ...s, index: i })), dropped, garbled };
}
