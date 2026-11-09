import type { Item, Scene } from "../types.js";

/**
 * Parser for plain-text plays as Project Gutenberg and Wikisource ship them. The formats differ between files, so the rules are
 * written to be tolerant and the tests pin each shape:
 *
 *   NORA.                       speaker alone on a line, speech on the following lines
 *   IAGO. Why, now I see...     speaker and first words on the same line
 *   [At the door.] / (aside)    stage direction in brackets, may span lines
 *   Enter OTHELLO.  / Exeunt.   stage direction as its own line
 *   ACT I / ACT FIRST. / SCENE II. Cyprus.
 *
 * A table of contents near the top repeats the act headings; a heading only counts when a speaker follows it soon, with no other
 * heading in between. Footnote marks like `[93]` are dropped.
 */

export type PlayTextOptions = {
  /** Extra stage words that look like a speaker but are not (upper-case line, ends with a period). */
  notSpeakers?: readonly string[];
  /** Speaker pattern for texts that write names in mixed case ("Nora.", "Varya:"). Capture group 1 is the name. */
  mixedCaseSpeaker?: RegExp;
};

const NOT_SPEAKERS = new Set([
  "ACT", "SCENE", "ENTER", "EXIT", "EXEUNT", "CURTAIN", "THE END", "FINIS", "CONTENTS", "PERSONS REPRESENTED", "DRAMATIS PERSONAE",
  "CHARACTERS", "PROLOGUE", "EPILOGUE", "ACT DROP", "TIME", "PLACE", "SCENERY", "NOTE", "FOOTNOTES", "THE SCENE",
]);

const ACT_RE = /^\s*(?:ACT|ACTO|ATO|ACTUS)\s+(?:([IVXLC]+)|(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|PRIMUS|SECUNDUS|TERTIUS|QUARTUS|QUINTUS|PRIMEIRO|SEGUNDO|TERCEIRO|QUARTO|QUINTO)|(\d{1,2}))\b[.:]?(.*)$/i;
const SCENE_RE = /^\s*(?:SCENE|CENA|SCOENA|SCAENA|SCENA)\s+(?:([IVXLC]+)|(\d{1,2})|(PRIMA|SECUNDA|TERTIA|QUARTA|QUINTA|SEXTA|PRIMEIRA|SEGUNDA|TERCEIRA))\b[.:]?(.*)$/i;
const UP = "[A-Z][A-Z0-9'’ \\-]{0,38}[A-Z0-9]";
const SPEAKER_ALONE = new RegExp(`^\\s{0,16}(${UP})\\.\\s*$`);
const SPEAKER_INLINE = new RegExp(`^\\s{0,16}(${UP})\\.\\s+(\\S.*)$`);
const UPPER_COLON = new RegExp(`^\\s{0,6}(${UP}):\\s*(.*)$`);
const UPPER_BARE = new RegExp(`^\\s{0,6}(${UP})\\s*$`);
const MIXED_PERIOD = /^\s{0,6}([A-Z][a-zA-Z'’\-]{0,20}(?: [A-Z][a-zA-Z'’\-]{0,20}){0,2})\.\s*(.*)$/;
const DASH = /^\s*(\p{Lu}[\p{L}'’\-]*(?: \p{L}[\p{L}'’\-]*){0,2})(?:,[^–-]{1,160}?)?\s+[–-]\s+(\S.*)$/u;
const COMMON_WORDS = new Set(["Sim", "Não", "Oh", "Ah", "Yes", "No", "Nay", "Ay", "Why", "Well", "Come", "Go", "Now", "Then", "Hark", "Hush", "Alas", "Tis", "Mr", "Mrs", "Dr", "St", "Sr", "Sra", "Ora", "Eis", "Cena", "Ato", "Scene", "Act"]);

type Style = { id: string; paren: boolean; match: (line: string, next: string | undefined) => { name: string; rest: string } | undefined };

const STYLES: readonly Style[] = [
  {
    id: "upper-period",
    paren: false,
    match: (l) => {
      const a = SPEAKER_ALONE.exec(l);
      if (a) return { name: (a[1] as string).trim(), rest: "" };
      const i = SPEAKER_INLINE.exec(l);
      return i ? { name: (i[1] as string).trim(), rest: i[2] as string } : undefined;
    },
  },
  { id: "upper-colon", paren: false, match: (l) => { const m = UPPER_COLON.exec(l); return m ? { name: (m[1] as string).trim(), rest: (m[2] as string).trim() } : undefined; } },
  { id: "upper-bare", paren: false, match: (l, next) => { const m = UPPER_BARE.exec(l); return m && next !== undefined && /^\s{2,}\S/.test(next) ? { name: (m[1] as string).trim(), rest: "" } : undefined; } },
  { id: "mixed-period", paren: false, match: (l) => { const m = MIXED_PERIOD.exec(l); return m && !COMMON_WORDS.has(m[1] as string) ? { name: (m[1] as string).trim(), rest: (m[2] as string).trim() } : undefined; } },
  { id: "dash", paren: true, match: (l) => { const m = DASH.exec(l); return m && !COMMON_WORDS.has(m[1] as string) ? { name: (m[1] as string).trim(), rest: (m[2] as string).trim() } : undefined; } },
];

/** The style whose speaker names repeat most: a name counts when it appears at least three times. Ties go to the earlier style. */
export function detectSpeakerStyle(lines: readonly string[]): { style: Style; names: ReadonlySet<string> } {
  let best: { style: Style; names: Set<string>; score: number } | undefined;
  for (const style of STYLES) {
    const counts = new Map<string, number>();
    for (let i = 0; i < lines.length; i++) {
      const m = style.match(lines[i] as string, lines[i + 1]);
      if (m && !NOT_SPEAKERS.has(m.name.toUpperCase())) counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
    }
    const names = new Set([...counts].filter(([, c]) => c >= 3).map(([n]) => n));
    const score = [...counts].filter(([n]) => names.has(n)).reduce((a, [, c]) => a + c, 0);
    if (!best || score > best.score * 1.15) best = { style, names, score };
  }
  return { style: (best as NonNullable<typeof best>).style, names: (best as NonNullable<typeof best>).names };
}
const DIRECTION_LINE = /^\s*(Enter|Exit|Exeunt|Re-enter|Reenter|Alarum|Flourish|Thunder|Music|Within|They (?:exit|go|embrace|fight)|A (?:noise|knocking)|Dies|Kills|Stabs)\b[^]*$/i;
const DIR_MARK = (n: number) => `\u0001D${n}\u0001`;
const DIR_SPLIT = /\u0001D(\d+)\u0001/;

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
const WORD_NUM: Record<string, number> = {
  FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5, SIXTH: 6, PRIMUS: 1, SECUNDUS: 2, TERTIUS: 3, QUARTUS: 4, QUINTUS: 5,
  PRIMEIRO: 1, SEGUNDO: 2, TERCEIRO: 3, QUARTO: 4, QUINTO: 5, PRIMA: 1, SECUNDA: 2, TERTIA: 3, QUARTA: 4, QUINTA: 5, SEXTA: 6, PRIMEIRA: 1, SEGUNDA: 2, TERCEIRA: 3,
};

export function romanToInt(s: string): number {
  let total = 0;
  const up = s.toUpperCase();
  for (let i = 0; i < up.length; i++) {
    const v = ROMAN[up[i] as string] ?? 0;
    const next = ROMAN[up[i + 1] as string] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

function actNumber(m: RegExpMatchArray): number {
  if (m[1]) return romanToInt(m[1]);
  if (m[2]) return WORD_NUM[m[2].toUpperCase()] ?? 0;
  return Number(m[3] ?? 0);
}

/** Cuts the Project Gutenberg licence header and footer when present. */
export function stripGutenberg(text: string): string {
  const start = text.search(/\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\n/i);
  let body = text;
  if (start >= 0) {
    const nl = text.indexOf("\n", start);
    body = text.slice(nl + 1);
  }
  const end = body.search(/\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG/i);
  return end >= 0 ? body.slice(0, end) : body;
}

type Marker = { line: number; act: number; label: string };

type Detected = ReturnType<typeof detectSpeakerStyle>;

function speakerAt(lines: readonly string[], i: number, opts: PlayTextOptions, det: Detected): { name: string; rest: string } | undefined {
  const line = lines[i] as string;
  if (ACT_RE.test(line) || SCENE_RE.test(line)) return undefined;
  const m = det.style.match(line, lines[i + 1]);
  if (!m) return undefined;
  const upper = m.name.toUpperCase();
  if (NOT_SPEAKERS.has(upper) || opts.notSpeakers?.includes(m.name) === true || opts.notSpeakers?.includes(upper) === true) return undefined;
  if (!det.names.has(m.name)) return undefined;
  return m;
}

export function parsePlayText(raw: string, sourceId: string, opts: PlayTextOptions = {}): Scene[] {
  // Gutenberg marks italics with underscores: `[_Exit._]`. Drop the marks, keep the words.
  const text = stripGutenberg(raw).replace(/\r\n?/g, "\n").replace(/_(?=\S)([^_]{1,400}?)(?<=\S)_/g, "$1");
  const det: Detected = opts.mixedCaseSpeaker
    ? { style: { id: "custom", paren: false, match: (l) => { const m = (opts.mixedCaseSpeaker as RegExp).exec(l); return m && m[1] ? { name: (m[1] as string).trim(), rest: l.slice(m[0].length).trim() } : undefined; } }, names: new Set() }
    : detectSpeakerStyle(text.split("\n"));
  if (opts.mixedCaseSpeaker) {
    const names = new Set<string>();
    for (const l of text.split("\n")) { const m = det.style.match(l, undefined); if (m) names.add(m.name); }
    (det as { names: ReadonlySet<string> }).names = names;
  }

  // 1. Pull bracketed directions out so speeches that contain them keep their order.
  const directions: string[] = [];
  const bracket = det.style.paren ? /[\[(]([^\])]{1,600})[\])]/g : /\[([^\]]{1,600})\]/g;
  const flat = text.replace(bracket, (_all, inner: string) => {
    const t = inner.replace(/\s+/g, " ").trim();
    if (/^\d+$/.test(t) || t === "") return " ";
    directions.push(t);
    return ` ${DIR_MARK(directions.length - 1)} `;
  });
  const lines = flat.split("\n");

  // 2. Find heading candidates, then keep the ones that a speaker follows.
  const candidates: Marker[] = [];
  lines.forEach((line, i) => {
    const m = ACT_RE.exec(line);
    if (m) candidates.push({ line: i, act: actNumber(m), label: line.trim() });
  });
  const firstSpeakerAfter = (from: number, limit: number): number => {
    for (let j = from + 1; j < Math.min(lines.length, from + limit); j++) if (speakerAt(lines, j, opts, det)) return j;
    return -1;
  };
  const acts: Marker[] = candidates.filter((c, idx) => {
    const sp = firstSpeakerAfter(c.line, 80);
    if (sp < 0) return false;
    const next = candidates[idx + 1];
    return !(next && next.line < sp);
  });

  const actAt = (i: number): Marker | undefined => {
    let cur: Marker | undefined;
    for (const a of acts) if (a.line <= i) cur = a;
    return cur;
  };
  // A play with no usable act headings is one act.
  const startLine = acts[0]?.line ?? (() => {
    for (let i = 0; i < lines.length; i++) if (speakerAt(lines, i, opts, det)) return i;
    return 0;
  })();

  const scenes: Scene[] = [];
  let curAct = acts[0]?.act ?? 1;
  let curSceneNo = 0;
  let curHeading = "";
  let items: Item[] = [];
  let sceneOpen = false;

  const flush = () => {
    if (items.some((it) => it.kind === "speech")) {
      scenes.push({ sourceId, act: String(curAct), scene: String(curSceneNo || 1), heading: curHeading, items });
    }
    items = [];
  };

  let speaker: string | null = null;
  let buf: string[] = [];
  const endSpeech = () => {
    if (speaker !== null) {
      pushText(speaker, buf.join(" "));
    }
    speaker = null;
    buf = [];
  };
  const pushText = (who: string, joined: string) => {
    const parts = joined.split(DIR_SPLIT);
    // split() with a capture group yields [text, idx, text, idx, ...]
    for (let k = 0; k < parts.length; k++) {
      const part = (parts[k] as string).replace(/\s+/g, " ").replace(/^[.,;:]+\s*/, "").trim();
      if (k % 2 === 1) {
        const d = directions[Number(parts[k])];
        if (d) items.push({ kind: "direction", text: d });
      } else if (part) {
        items.push({ kind: "speech", speaker: who, text: part });
      }
    }
  };

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i] as string;
    const act = acts.find((a) => a.line === i);
    if (act) {
      endSpeech();
      flush();
      curAct = act.act || curAct;
      curSceneNo = 0;
      curHeading = act.label;
      sceneOpen = true;
      continue;
    }
    const sc = SCENE_RE.exec(line);
    if (sc && (acts.length === 0 || actAt(i))) {
      endSpeech();
      flush();
      curSceneNo = sc[1] ? romanToInt(sc[1]) : sc[2] ? Number(sc[2]) : (WORD_NUM[(sc[3] ?? "").toUpperCase()] ?? 0);
      curHeading = line.trim();
      sceneOpen = true;
      continue;
    }
    if (/^\s*SCENE\s*$/i.test(line)) continue;
    void sceneOpen;

    const sp = speakerAt(lines, i, opts, det);
    if (sp) {
      endSpeech();
      speaker = sp.name;
      if (sp.rest) buf.push(sp.rest);
      continue;
    }
    if (DIRECTION_LINE.test(line) && line.trim().length < 200 && (line.match(/^\s{0,3}\S/) !== null || speaker === null || /^\s*(Enter|Exit|Exeunt)/i.test(line))) {
      endSpeech();
      items.push({ kind: "direction", text: line.replace(/\s+/g, " ").trim() });
      continue;
    }
    if (line.trim() === "") {
      // A blank line ends nothing on its own: Ibsen puts one right after the speaker name.
      continue;
    }
    if (speaker !== null) buf.push(line.trim());
    else if (/\u0001D\d+\u0001/.test(line)) {
      for (const part of line.split(DIR_SPLIT)) void part;
      const pieces = line.split(DIR_SPLIT);
      for (let k = 0; k < pieces.length; k++) {
        if (k % 2 === 1) {
          const d = directions[Number(pieces[k])];
          if (d) items.push({ kind: "direction", text: d });
        }
      }
    }
  }
  endSpeech();
  flush();
  return scenes;
}
