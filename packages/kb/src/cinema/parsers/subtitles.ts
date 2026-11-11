import type { CineEvent, CineScene } from "../types.js";

export type SubtitleCue = { t0: number; t1: number; lines: string[] };

const ts = (v: string): number => {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(v);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000 : NaN;
};
const unent = (s: string): string => s.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" })[m] ?? m);
const CREDIT = /(?:legenda|tradu[cç]|sincroniza|revis[aã]o|opensubtitles|subtitle|sync(?:ed)?\b|www\.|\.com\b|\.org\b|caption|ripped|encoded|resync|subs\b|transcri)/i;

/** OPUS OpenSubtitles raw XML (<s> blocks with <time id="TnS|TnE" value="hh:mm:ss,mmm"/> markers) to timed cues. */
export function parseOpusXml(xml: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const re = /<time id="T(\d+)([SE])" value="([^"]+)"\s*\/>|<\/s>|<s [^>]*>|([^<]+)/g;
  let open: { t0: number; lines: string[] } | null = null;
  let lineBuf = "";
  const endLine = (): void => { const t = lineBuf.replace(/\s+/g, " ").trim(); if (open && t) open.lines.push(t); lineBuf = ""; };
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[2] === "S") { endLine(); if (open && open.lines.length) { /* an unterminated cue: close at the next start */ cues.push({ t0: open.t0, t1: ts(m[3]!), lines: open.lines }); } open = { t0: ts(m[3]!), lines: [] }; }
    else if (m[2] === "E") { endLine(); if (open) { if (open.lines.length) cues.push({ t0: open.t0, t1: ts(m[3]!), lines: open.lines }); open = null; } }
    else if (m[4] !== undefined) {
      if (m[4].startsWith("<?xml")) continue;
      m[4].split(/\n\s*(?=[-–—]\s*\S)/).forEach((part, k) => { if (k > 0) endLine(); lineBuf += unent(part); });
    }
    else { endLine(); }
  }
  return cues.filter((c) => Number.isFinite(c.t0) && Number.isFinite(c.t1) && c.t1 > c.t0);
}

const clean = (s: string): string =>
  s.replace(/<[^>]+>/g, "").replace(/\{[^}]*\}/g, "").replace(/â™ª|[♪♫#]+/g, " ").replace(/^\s*[-–—]?\s*[\p{Lu}][\p{Lu} .'’]{1,18}:\s+/u, "").replace(/\s+/g, " ").trim();

/**
 * Cues to scenes. Each dash-led line, or each cue, is one spoken turn (subtitles do not name speakers). A cue that continues the previous sentence is joined to it.
 * A silence of `gapSec` or more between cues starts a new scene. Sound cues in brackets are dropped (SDH files are rare and inconsistent).
 */
export function cuesToScenes(cues: readonly SubtitleCue[], sourceId: string, gapSec = 12, maxTurns = 100): CineScene[] {
  const scenes: CineScene[] = [];
  let cur: CineEvent[] = [];
  let sceneStart = 0;
  let lastEnd = -Infinity;
  const flush = (): void => {
    const speech = cur.filter((e) => e.kind === "speech");
    if (speech.length) for (const part of splitLong(cur, maxTurns)) scenes.push({ sourceId, index: scenes.length, events: part, durationSec: spanOf(part) });
    cur = [];
  };
  let prevText = "";
  cues.forEach((cue, ci) => {
    if (CREDIT.test(cue.lines.join(" ")) && (ci < 6 || ci > cues.length - 6)) return;
    if (cue.t0 - lastEnd >= gapSec) { flush(); sceneStart = cue.t0; prevText = ""; }
    const lines = cue.lines.map(clean).filter((l) => l !== "" && !/^[[(].*[\])]$/.test(l) && /\p{L}/u.test(l));
    if (lines.length === 0) { lastEnd = Math.max(lastEnd, cue.t1); return; }
    const dashFirst = /^[-–—]/.test(lines[0]!);
    // split into turns: a line that starts with a dash opens a turn, other lines continue the turn above
    const turns: string[] = [];
    for (const l of lines) {
      if (/^[-–—]\s*/.test(l)) turns.push(l.replace(/^[-–—]\s*/, ""));
      else if (turns.length) turns[turns.length - 1] += ` ${l}`;
      else turns.push(l);
    }
    // time shares: turns of one cue split the cue's time by length
    const total = turns.reduce((a, t) => a + t.length, 0) || 1;
    let at = cue.t0;
    turns.forEach((t, k) => {
      const t1 = k === turns.length - 1 ? cue.t1 : at + ((cue.t1 - cue.t0) * t.length) / total;
      const last = cur[cur.length - 1];
      const cont = k === 0 && !dashFirst && last && last.kind === "speech" && last.t1 !== undefined && cue.t0 - last.t1 < 0.8 && !/[.!?…"”\]]\s*$/.test(prevText);
      if (cont && last && last.kind === "speech") { last.text += ` ${t}`; last.t1 = t1; }
      else cur.push({ kind: "speech", speaker: null, text: t, t0: at, t1 });
      prevText = t;
      at = t1;
    });
    lastEnd = Math.max(lastEnd, cue.t1);
  });
  flush();
  return scenes.map((s, i) => ({ ...s, index: i }));
}

/** Is the file usable? Spaces eaten by OCR ("Washingtonlançouum") and tiny files are refused. */
export function subtitleQuality(cues: readonly SubtitleCue[]): { ok: boolean; reason?: string; spanSec: number } {
  if (cues.length < 250) return { ok: false, reason: "few cues", spanSec: 0 };
  const text = cues.flatMap((c) => c.lines).join(" ");
  const toks = text.split(/\s+/).filter(Boolean);
  const long = toks.filter((t) => t.replace(/[^\p{L}]/gu, "").length > 17).length / Math.max(1, toks.length);
  const spanSec = cues[cues.length - 1]!.t1 - cues[0]!.t0;
  if (long > 0.02) return { ok: false, reason: "glued words", spanSec };
  return { ok: true, spanSec };
}

const spanOf = (evs: readonly CineEvent[]): number => {
  const sp = evs.filter((e): e is Extract<CineEvent, { kind: "speech" }> => e.kind === "speech" && e.t0 !== undefined && e.t1 !== undefined);
  return sp.length ? sp[sp.length - 1]!.t1! - sp[0]!.t0! : 0;
};

/** A continuous stretch with more than `maxTurns` turns is cut, recursively, at the longest silence in its middle half (a conversation that long is several scenes). */
export function splitLong(evs: CineEvent[], maxTurns: number): CineEvent[][] {
  if (evs.length <= maxTurns) return [evs];
  const lo = Math.floor(evs.length * 0.25), hi = Math.ceil(evs.length * 0.75);
  let best = -1, bestGap = -1;
  for (let i = Math.max(1, lo); i < Math.min(evs.length, hi); i++) {
    const a = evs[i - 1]!, b = evs[i]!;
    if (a.kind !== "speech" || b.kind !== "speech" || a.t1 === undefined || b.t0 === undefined) continue;
    const g = b.t0 - a.t1;
    if (g > bestGap) { bestGap = g; best = i; }
  }
  if (best < 0) return [evs];
  return [...splitLong(evs.slice(0, best), maxTurns), ...splitLong(evs.slice(best), maxTurns)];
}
