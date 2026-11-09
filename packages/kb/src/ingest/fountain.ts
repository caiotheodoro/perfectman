import type { Item, Scene } from "../types.js";

/**
 * Fountain screenplay parser (https://fountain.io/syntax). Own implementation: the published parsers are old and none handles forced
 * elements, dual dialogue, boneyard and notes together. One scene per scene heading.
 *
 *   INT./EXT./EST./I/E  or a leading `.`    scene heading
 *   upper-case line after a blank line       character cue (`@` forces; trailing `^` is dual dialogue; `(CONT'D)` and `(V.O.)` stripped)
 *   (...) under a cue                        parenthetical, kept as a direction
 *   everything else                          action, kept as a direction
 *   >TEXT  ===  # sections  = synopses       transitions, page breaks and outline lines are dropped
 *   [[note]]  and  boneyard blocks            removed before parsing
 */

const HEADING = /^(?:\.(?!\.)|(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[. ])/i;

function cleanCue(raw: string): string {
  return raw
    .replace(/^@/, "")
    .replace(/\s*\^\s*$/, "")
    .replace(/\s*\((?:V\.O\.|O\.S\.|O\.C\.|CONT'D|CONT’D|CONT|[A-Z.' ]{1,12})\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCue(line: string): boolean {
  if (line.startsWith("@")) return true;
  if (line.startsWith("!")) return false;
  const bare = line.replace(/\s*\^\s*$/, "").replace(/\s*\([^)]*\)\s*/g, " ").trim();
  if (bare === "" || /[a-z]/.test(bare)) return false;
  if (HEADING.test(line) || /TO:$/.test(bare) || /^>/.test(line)) return false;
  return /[A-Z]/.test(bare);
}

export function parseFountain(raw: string, sourceId: string): Scene[] {
  let text = raw.replace(/\r\n?/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\[\[[\s\S]*?\]\]/g, "");
  // Title page: `Key: value` lines at the top, ended by a blank line.
  if (/^[A-Za-z ]{2,20}:/.test(text)) {
    const end = text.search(/\n\s*\n/);
    if (end > 0 && text.slice(0, end).split("\n").every((l) => /^([A-Za-z ]{2,20}:|\s+\S)/.test(l))) text = text.slice(end).replace(/^\s+/, "");
  }
  const lines = text.split("\n");

  const scenes: Scene[] = [];
  let heading = "";
  let items: Item[] = [];
  let sceneNo = 0;
  const flush = () => {
    if (items.some((i) => i.kind === "speech")) scenes.push({ sourceId, act: "1", scene: String(sceneNo), heading, items });
    items = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] as string).trimEnd();
    const trimmed = line.trim();
    const prevBlank = i === 0 || (lines[i - 1] as string).trim() === "";
    if (trimmed === "" || /^={3,}$/.test(trimmed) || /^#+\s/.test(trimmed) || /^=\s/.test(trimmed) || /^>[^<]*[^<]$/.test(trimmed) && !trimmed.endsWith("<")) {
      i++;
      continue;
    }
    // A transition: an upper-case line ending in TO:, alone between blank lines.
    if (prevBlank && /^[A-Z0-9][A-Z0-9 .'’\-]*TO:$/.test(trimmed)) {
      i++;
      continue;
    }
    if (prevBlank && HEADING.test(trimmed)) {
      flush();
      sceneNo++;
      heading = trimmed.replace(/^\./, "").replace(/\s*#[^#]+#\s*$/, "");
      i++;
      continue;
    }
    if (prevBlank && isCue(trimmed) && i + 1 < lines.length && (lines[i + 1] as string).trim() !== "") {
      const who = cleanCue(trimmed);
      let j = i + 1;
      const speech: string[] = [];
      while (j < lines.length && (lines[j] as string).trim() !== "") {
        const l = (lines[j] as string).trim();
        if (/^\(.*\)$/.test(l)) {
          if (speech.length) {
            items.push({ kind: "speech", speaker: who, text: speech.join(" ") });
            speech.length = 0;
          }
          items.push({ kind: "direction", text: l.slice(1, -1) });
        } else speech.push(l);
        j++;
      }
      if (speech.length) items.push({ kind: "speech", speaker: who, text: speech.join(" ") });
      i = j;
      continue;
    }
    // Action: gather the paragraph.
    const para: string[] = [];
    let j = i;
    while (j < lines.length && (lines[j] as string).trim() !== "") {
      para.push((lines[j] as string).trim().replace(/^!/, ""));
      j++;
    }
    items.push({ kind: "direction", text: para.join(" ") });
    i = j;
  }
  flush();
  return scenes;
}
