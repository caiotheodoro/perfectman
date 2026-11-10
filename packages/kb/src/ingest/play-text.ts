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
 *
 * Guards against a following speaker being swallowed into the speech or direction before it:
 *  - an unclosed `[` (a missing `]` in the source) ends at the next blank line, never swallows the cue after it;
 *  - `NAME (direction):` cues are read, the direction becomes its own item;
 *  - a speaker that appears only once or twice (a Messenger, a typo'd name) is still a cue when the name is upper case, and a rare
 *    name one letter off a frequent one is the frequent one;
 *  - apparatus is dropped, not parsed: `[Footnote n: ...]` and `[Illustration]` blocks, the Project Gutenberg licence tail, and
 *    anything from a manifest `parse.stopBefore` pattern on;
 *  - no speech is longer than `MAX_SPEECH_CHARS`: a longer one is split on sentence boundaries into consecutive speeches of the
 *    same speaker.
 */

/** Longest single speech item. Longer speeches are split at sentence ends (or, with none, at a space) into same-speaker items. */
export const MAX_SPEECH_CHARS = 1200;

export type PlayTextOptions = {
  /** Extra stage words that look like a speaker but are not (upper-case line, ends with a period). */
  notSpeakers?: readonly string[];
  /** Speaker pattern for texts that write names in mixed case ("Nora.", "Varya:"). Capture group 1 is the name. */
  mixedCaseSpeaker?: RegExp;
  /** Cut the text at the first match (multiline): an editor's afterword or notes that follow the play. */
  stopBefore?: RegExp;
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
const UPPER_COLON = new RegExp(`^\\s{0,6}(${UP})(?:\\s*\\(([^()]{1,200})\\))?:\\s*(.*)$`);
const UPPER_BARE = new RegExp(`^\\s{0,6}(${UP})\\s*$`);
const MIXED_PERIOD = /^\s{0,6}([A-Z][a-zA-Z'’\-]{0,20}(?: [A-Z][a-zA-Z'’\-]{0,20}){0,2})\.\s*(.*)$/;
const DASH = /^\s*((?:(?:D|Dr|Dra|Sr|Sra)\. )?\p{Lu}[\p{L}'’\-]*(?: \p{L}[\p{L}'’\-]*){0,2})(?:,[^–-]{1,160}?)?\s+[–-]\s+(\S.*)$/u;
const COMMON_WORDS = new Set(["Sim", "Não", "Oh", "Ah", "Yes", "No", "Nay", "Ay", "Why", "Well", "Come", "Go", "Now", "Then", "Hark", "Hush", "Alas", "Tis", "Mr", "Mrs", "Dr", "St", "Sr", "Sra", "Ora", "Eis", "Cena", "Ato", "Scene", "Act"]);

type Cue = { name: string; rest: string; dir?: string };
type Style = { id: string; paren: boolean; match: (line: string, next: string | undefined) => Cue | undefined };

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
  {
    id: "upper-colon",
    paren: false,
    match: (l) => {
      const m = UPPER_COLON.exec(l);
      if (!m) return undefined;
      const dir = m[2]?.replace(/\s+/g, " ").trim();
      return { name: (m[1] as string).trim(), rest: (m[3] as string).trim(), ...(dir ? { dir } : {}) };
    },
  },
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

/** Cuts the Project Gutenberg licence header and footer when present. The end marker is found with or without its leading stars. */
export function stripGutenberg(text: string): string {
  const start = text.search(/\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\n/i);
  let body = text;
  if (start >= 0) {
    const nl = text.indexOf("\n", start);
    body = text.slice(nl + 1);
  }
  const end = body.search(/(?:\*\*\* ?|^)END OF (?:THE |THIS )?PROJECT GUTENBERG/im);
  if (end >= 0) return body.slice(0, end);
  const licence = body.search(/^START: FULL LICENSE\s*$/m);
  return licence >= 0 ? body.slice(0, licence) : body;
}

/** Drops editorial apparatus that is not play text: footnote and illustration blocks, and a lone "FOOTNOTES:" heading. */
export function stripApparatus(text: string): string {
  return text
    .replace(/\[(?:Footnote|Illustration)\b[^\]]*\]/g, " ")
    .replace(/^[ \t]*FOOTNOTES:?[ \t]*$/gm, "");
}

/** Splits a speech longer than `max` at sentence ends, packing sentences up to the cap. A sentence over the cap is cut at a space. */
export function splitSpeech(text: string, max = MAX_SPEECH_CHARS): string[] {
  if (text.length <= max) return [text];
  const sentences = text.split(/(?<=[.!?…][)\]"”’']*)\s+/u);
  const out: string[] = [];
  let cur = "";
  const push = () => {
    if (cur) out.push(cur);
    cur = "";
  };
  for (const sentence of sentences) {
    if (sentence.length > max) {
      push();
      let rest = sentence;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(" ", max);
        if (cut <= 0) cut = max;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      cur = rest;
      continue;
    }
    if (cur && cur.length + 1 + sentence.length > max) push();
    cur = cur ? `${cur} ${sentence}` : sentence;
  }
  push();
  return out;
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min((prev[j] as number) + 1, (row[j - 1] as number) + 1, (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length] as number;
}

/** A rare name one letter off a frequent one (two letters off, for names of nine letters or more) is that frequent name: an OCR slip. */
function nearKnownName(name: string, known: ReadonlySet<string>): string | undefined {
  const n = norm(name);
  if (n.length < 5) return undefined;
  const limit = n.length >= 9 ? 2 : 1;
  let best: { name: string; d: number } | undefined;
  for (const k of known) {
    const d = editDistance(n, norm(k));
    if (d <= limit && (!best || d < best.d)) best = { name: k, d };
  }
  return best?.name;
}

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Some dash-style sources put two speeches on one line ("PEDRO - Ah!... CARLOTINHA - Não li!"). A known speaker name, right after
 * a sentence end or a direction, followed by a dash, starts a new line there.
 */
function splitInlineCues(lines: string[], det: Detected): string[] {
  if (det.style.id !== "dash" || det.names.size === 0) return lines;
  const names = [...det.names].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
  const re = new RegExp(`(?<=[.!?…»”"’)\\u0001]\\s+)(?=(?:${names})(?:,[^–-]{1,160}?)?\\s+[–-]\\s)`, "gu");
  return lines.flatMap((l) => (l.length > 20 ? l.split(re) : [l]));
}

/** A lone "CURTAIN." or "THE END" closes the speech before it: what follows (a cast list, notes) is not that speaker's words. */
const END_MARK = /^\s*(?:CURTAIN(?: DROP| FALLS)?|THE END|FINIS|FIM)\.?\s*$/;

const APPARATUS_NAME = /\b(?:NOTES?|PERSONS|CHARACTERS|INTRODUCTION|CONTENTS|PREFACE|DRAMATIS|PERSONAE|TRANSLATOR)\b/;
const NOT_RARE_SPEAKERS = new Set(["MRS", "MME", "MLLE", "AND", "THE", "ETC", "ESQ", "LTD", "CURTAIN DROP", "THE CURTAIN FALLS", "PLAY", "SONG", "THE SONG"]);

/** An upper-case name that the style matched but that is too rare to be in `det.names`: a minor character or a typo. */
function rareSpeaker(m: Cue, det: Detected): boolean {
  if (det.style.id === "custom" || det.style.id === "mixed-period") return false;
  const n = m.name;
  if (n !== n.toUpperCase() || n.toLowerCase() === n) return false;
  const letters = n.replace(/[^\p{L}]/gu, "");
  if (letters.length < 3 || /^[IVXLC]+$/.test(letters) || NOT_RARE_SPEAKERS.has(n) || APPARATUS_NAME.test(n)) return false;
  return n.split(/\s+/).length <= 5;
}

type Marker = { line: number; act: number; label: string };

type Detected = ReturnType<typeof detectSpeakerStyle>;

function speakerAt(lines: readonly string[], i: number, opts: PlayTextOptions, det: Detected, rare = false): Cue | undefined {
  const line = lines[i] as string;
  if (ACT_RE.test(line) || SCENE_RE.test(line)) return undefined;
  const m = det.style.match(line, lines[i + 1]);
  if (!m) return undefined;
  const upper = m.name.toUpperCase();
  if (NOT_SPEAKERS.has(upper) || opts.notSpeakers?.includes(m.name) === true || opts.notSpeakers?.includes(upper) === true) return undefined;
  if (det.names.has(m.name)) return m;
  if (!rare || !rareSpeaker(m, det)) return undefined;
  return { ...m, name: nearKnownName(m.name, det.names) ?? m.name };
}

export function parsePlayText(raw: string, sourceId: string, opts: PlayTextOptions = {}): Scene[] {
  // Gutenberg marks italics with underscores: `[_Exit._]`. Drop the marks, keep the words.
  let text = stripApparatus(stripGutenberg(raw)).replace(/\r\n?/g, "\n").replace(/_(?=\S)([^_]{1,400}?)(?<=\S)_/g, "$1");
  if (opts.stopBefore) {
    const at = text.search(new RegExp(opts.stopBefore.source, opts.stopBefore.flags.includes("m") ? opts.stopBefore.flags : `${opts.stopBefore.flags}m`));
    if (at >= 0) text = text.slice(0, at);
  }
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
  // A direction never crosses a blank line or holds another opener: a missing `]` in the source must not swallow the next cue.
  const bracket = det.style.paren ? /[[(]((?:(?!\n[ \t]*\n)[^[\]()]){1,600})[\])]/g : /\[((?:(?!\n[ \t]*\n)[^[\]]){1,600})\]/g;
  const unclosed = det.style.paren ? /^[ \t]*[[(]((?:(?!\n[ \t]*\n)[^[\]()]){1,800})(?=\n[ \t]*\n|(?![\s\S]))/gm : /^[ \t]*\[((?:(?!\n[ \t]*\n)[^[\]]){1,800})(?=\n[ \t]*\n|(?![\s\S]))/gm;
  const takeDirection = (_all: string, inner: string) => {
    const t = inner.replace(/\s+/g, " ").trim();
    if (/^\d+$/.test(t) || t === "") return " ";
    directions.push(t);
    return ` ${DIR_MARK(directions.length - 1)} `;
  };
  const flat = text.replace(bracket, takeDirection).replace(unclosed, takeDirection);
  const lines = splitInlineCues(flat.split("\n"), det);

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
        for (const piece of splitSpeech(part)) items.push({ kind: "speech", speaker: who, text: piece });
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
    if (END_MARK.test(line)) {
      endSpeech();
      continue;
    }
    void sceneOpen;

    const sp = speakerAt(lines, i, opts, det, true);
    if (sp) {
      endSpeech();
      if (sp.dir) items.push({ kind: "direction", text: sp.dir });
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
