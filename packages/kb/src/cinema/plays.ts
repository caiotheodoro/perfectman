import type { Scene } from "../types.js";
import type { CineEvent, CineScene } from "./types.js";

const TITLES = /^(?:MRS|MR|MISS|MS|DR|LADY|LORD|SIR|MADAME|MME|DONA|DOM|D|SR|SRA|SENHOR|SENHORA|O|A)\.?$/i;

/**
 * Stage scenes from the play parser become cinema scenes. A scene (or an act the parser could not cut) longer than `maxTurns` speech turns is cut into
 * consecutive windows of about `window` turns, so stage scenes are about the size of a hotel scene. The cut is arbitrary; it is a documented caveat.
 */
export function playToScenes(scenes: readonly Scene[], sourceId: string, window = 60, maxTurns = 90): CineScene[] {
  const out: CineScene[] = [];
  for (const s of scenes) {
    const events: CineEvent[] = [];
    for (let it of s.items) {
      if (it.kind === "direction") { events.push({ kind: "direction", text: it.text }); continue; }
      // "MRS." / "LADY" cut off at a title's full stop: the name leads the text ("ERLYNNE. Oh! why ...")
      if (TITLES.test(it.speaker)) {
        const t = /^([\p{Lu}][\p{Lu}'’-]{1,20})\.?\s*(.*)$/su.exec(it.text);
        if (t) { it = { ...it, speaker: `${it.speaker} ${t[1]!}`, text: t[2]! }; if (it.text.trim() === "") continue; }
      }
      // "angrily, to Sara.—What is it you want?" : a lower-case stage direction ahead of the line, split off
      const m = /^([a-zà-ú][^.!?—]{2,90})\.?\s*[—–]+\s*(.+)$/su.exec(it.text);
      if (m && /^[a-zà-ú]/.test(m[1]!)) { events.push({ kind: "direction", text: m[1]!, parenthetical: true }); events.push({ kind: "speech", speaker: it.speaker, text: m[2]! }); }
      else events.push({ kind: "speech", speaker: it.speaker, text: it.text });
    }
    const turns = events.filter((e) => e.kind === "speech").length;
    if (turns <= maxTurns) { out.push({ sourceId, index: out.length, events }); continue; }
    const pieces = Math.max(2, Math.round(turns / window));
    const per = Math.ceil(turns / pieces);
    let cur: CineEvent[] = [];
    let n = 0;
    for (const e of events) {
      cur.push(e);
      if (e.kind === "speech" && ++n >= per) { out.push({ sourceId, index: out.length, events: cur }); cur = []; n = 0; }
    }
    if (cur.some((e) => e.kind === "speech")) out.push({ sourceId, index: out.length, events: cur });
  }
  return out;
}
