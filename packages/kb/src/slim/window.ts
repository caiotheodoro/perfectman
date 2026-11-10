/**
 * Cutting a beat down to an excerpt: whole lines only, never a line cut in the middle, speakers named A, B, C. A beat's text is one item per
 * line: `NAME: speech` or `[a stage direction]`. The window is the run of consecutive lines that fits the cap and has the most voices, with the
 * stage direction of the physical action in it when the beat has one.
 */

type Line = { kind: "speech"; cue: string; text: string } | { kind: "direction"; text: string };
export type RenderedLine = { kind: "speech" | "direction"; text: string; letter?: string };

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const TITLE_WORDS = new Set(["first", "second", "third", "fourth", "young", "old", "lord", "lady", "king", "queen", "miss", "madam", "madame", "dona", "dama", "senhor", "senhora", "servant", "maid", "messenger", "citizen", "officer", "soldier"]);
const CUE = /^([^:[\]]{1,32}):\s*(.*)$/;
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lines of a beat as the chunker wrote them. A line that is neither a direction nor a known or upper-case cue continues the line before it. */
export function parseBeatLines(text: string, speakers: readonly string[]): Line[] {
  const known = new Set(speakers.map((s) => s.trim().toLowerCase()));
  const out: Line[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("[")) {
      out.push({ kind: "direction", text: line });
      continue;
    }
    const m = CUE.exec(line);
    const cue = m?.[1]?.trim();
    if (m && cue !== undefined && (known.has(cue.toLowerCase()) || /^[\p{Lu}][\p{Lu}\s.'’-]*$/u.test(cue))) {
      // The chunker leaves a stray ". " after a cue when the source had a stage word there ("NORA: . Yes").
      out.push({ kind: "speech", cue, text: (m[2] ?? "").replace(/^\.\s+/, "").trim() });
      continue;
    }
    const last = out[out.length - 1];
    if (last) last.text = `${last.text} ${line}`.trim();
  }
  return out.filter((l) => l.text !== "");
}

/** Speakers become A, B, C in order of first speech, in the speech lines and inside the directions. */
export function anonymise(lines: readonly Line[]): RenderedLine[] {
  const letterOf = new Map<string, string>();
  for (const l of lines) {
    if (l.kind === "speech" && !letterOf.has(l.cue.toLowerCase()) && letterOf.size < LETTERS.length) letterOf.set(l.cue.toLowerCase(), LETTERS[letterOf.size] as string);
  }
  // A cue of several words is also named by its own words in the directions ("MRS LINDE" is "Linde" there), except titles and ordinals.
  const aliases = new Map(letterOf);
  for (const [name, letter] of letterOf) {
    for (const word of name.split(/[\s.]+/)) if (word.length >= 4 && !TITLE_WORDS.has(word) && !aliases.has(word)) aliases.set(word, letter);
  }
  // Longest names first, so "MRS LINDE" goes before "LINDE".
  const names = [...aliases.keys()].sort((a, b) => b.length - a.length);
  return lines.map((l) => {
    if (l.kind === "speech") return { kind: "speech", text: l.text, letter: letterOf.get(l.cue.toLowerCase()) ?? "?" };
    let text = l.text;
    for (const name of names) text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "giu"), aliases.get(name) as string);
    return { kind: "direction", text };
  });
}

export const renderLine = (l: RenderedLine): string => (l.kind === "speech" ? `${l.letter}: ${l.text}` : l.text);

/**
 * The best run of consecutive lines whose text is at most `cap` characters (newlines count). Scored on the number of voices (up to three),
 * on holding a stage direction when `wantDirection` (the beat's physical action is in one), and a little on length; ties go to the earlier,
 * then the longer, run. `speechOnly` ignores directions altogether. Undefined when no run holds a speech line within the cap, or the
 * best run is shorter than `minChars`.
 */
export function pickWindow(lines: readonly RenderedLine[], cap: number, opts: { wantDirection: boolean; speechOnly: boolean; minChars?: number }): string | undefined {
  const pool = opts.speechOnly ? lines.filter((l) => l.kind === "speech") : lines;
  let best: { score: number; start: number; end: number; text: string } | undefined;
  for (let start = 0; start < pool.length; start += 1) {
    let text = "";
    const voices = new Set<string>();
    let direction = false;
    for (let end = start; end < pool.length; end += 1) {
      const l = pool[end] as RenderedLine;
      const next = text === "" ? renderLine(l) : `${text}\n${renderLine(l)}`;
      if (next.length > cap) break;
      text = next;
      if (l.kind === "speech") voices.add(l.letter ?? "?");
      else direction = true;
      if (voices.size === 0) continue;
      const score = 10 * Math.min(voices.size, 3) + (opts.wantDirection && direction ? 8 : 0) + 5 * (text.length / cap);
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && start === best.start && end > best.end)) best = { score, start, end, text };
    }
  }
  return best && best.text.length >= (opts.minChars ?? 1) ? best.text : undefined;
}
