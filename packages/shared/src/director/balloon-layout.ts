/**
 * Where balloons go and how big they are.
 *
 * Pure given a text measurer, so the browser player (canvas) and the video
 * renderer (a headless browser's canvas) lay out identically. A balloon is
 * placed once, stays put, follows the camera, and never sits on a face or on
 * another balloon that is on screen at the same time. Long lines page by the
 * reading instead of being cut.
 */
import { personaSignature, type LetteringStyle } from "./persona-signature.js";
import { sampleTimeline } from "./sample.js";
import type { Timeline } from "./timeline.js";
import type { Balloon, BalloonKind, BalloonPage } from "./types.js";

export type BalloonFont = { family: string; size: number; weight: number; lineHeight: number };
/** Width in stage pixels of one line of text set in a font. */
export type TextMeasurer = (text: string, font: BalloonFont) => number;

/** A renderer may swap the families; the sizes and rhythm are what the layout needs. */
export const LETTERING: Record<LetteringStyle, BalloonFont> = {
  typewriter: { family: "Special Elite", size: 15, weight: 400, lineHeight: 1.24 },
  casual: { family: "Shantell Sans Variable", size: 16, weight: 400, lineHeight: 1.2 },
  tidy: { family: "Patrick Hand", size: 20, weight: 400, lineHeight: 1.12 },
  formal: { family: "Kalam", size: 18, weight: 400, lineHeight: 1.16 },
  house: { family: "Shantell Sans Variable", size: 16, weight: 400, lineHeight: 1.2 },
};
export const SHOUT_FONT: BalloonFont = { family: "Londrina Solid", size: 27, weight: 400, lineHeight: 1.0 };
export const THOUGHT_FONT: BalloonFont = { family: "Caveat", size: 21, weight: 400, lineHeight: 1.02 };

const CJK = /[぀-ヿ一-鿿]/;
const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));
const tokensOf = (line: string): string[] => (CJK.test(line) ? [...line] : line.split(" ").filter(Boolean));

export type LayoutContext = { archetype: (id: string) => string; measure: TextMeasurer };

export function fontFor(kind: BalloonKind, archetype: string, arousal: number): BalloonFont {
  if (kind === "shout") return SHOUT_FONT;
  if (kind === "thought") return THOUGHT_FONT;
  const base = LETTERING[personaSignature({ archetype }).lettering];
  if (kind === "whisper") return { ...base, size: Math.round(base.size * 0.9) };
  return { ...base, size: Math.round(base.size * (0.94 + clamp(arousal, 0.2, 0.8) * 0.3)) };
}

function wrap(text: string, font: BalloonFont, maxW: number, measure: TextMeasurer): string[] {
  const cjk = CJK.test(text);
  const words = cjk ? [...text] : text.split(/\s+/).filter(Boolean);
  const sep = cjk ? "" : " ";
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + sep + w : w;
    if (measure(t, font) <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

type Fit = { lines: string[]; W: number; H: number };

/** A pleasant width near 2.3:1 for up to four lines; longer text becomes pages of four lines. */
export function fitText(text: string, font: BalloonFont, kind: BalloonKind, measure: TextMeasurer): Fit[] {
  const padX = kind === "shout" ? 48 : kind === "thought" ? 42 : 20;
  const padY = kind === "shout" ? 36 : kind === "thought" ? 30 : 14;
  const lineH = font.size * font.lineHeight;
  const widest = (lines: string[]): number => Math.max(...lines.map((l) => measure(l, font))) * 1.06 + 4;
  let best: (Fit & { score: number }) | null = null;
  for (let w = 150; w <= 330; w += 15) {
    const lines = wrap(text, font, w, measure);
    if (lines.length > 4) continue;
    const W = widest(lines) + padX * 2, H = lines.length * lineH + padY * 2;
    const score = Math.abs(W / H - 2.3) + lines.length * 0.03;
    if (!best || score < best.score) best = { lines, W, H, score };
  }
  if (best) return [{ lines: best.lines, W: best.W, H: best.H }];
  const lines = wrap(text, font, 300, measure), pages: Fit[] = [];
  for (let i = 0; i < lines.length; i += 4) {
    const L = lines.slice(i, i + 4);
    pages.push({ lines: L, W: widest(L) + padX * 2, H: L.length * lineH + padY * 2 });
  }
  return pages;
}

const displayText = (b: { kind: BalloonKind; text: string }): string => (b.kind === "shout" ? b.text.toUpperCase() : b.text);

/** Words on each page of a balloon, for pacing paged lines by the reading. */
export function makePageWords(ctx: LayoutContext) {
  return (line: { kind: BalloonKind; actor: string; text: string; arousal: number }): number[] => {
    const pages = fitText(displayText(line), fontFor(line.kind, ctx.archetype(line.actor), line.arousal), line.kind, ctx.measure);
    return pages.map((p) => p.lines.reduce((n, l) => n + tokensOf(l).length, 0));
  };
}

type Box = { x0: number; x1: number; y0: number; y1: number };
type Body = Box & { id: string; sx: number; sy: number; hw: number; h: number };
type Cand = { cx: number; cy: number; tip: { x: number; y: number } };

const overlap = (a: Box, c: Box): number => Math.max(0, Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0)) * Math.max(0, Math.min(a.y1, c.y1) - Math.max(a.y0, c.y0));

function candidates(me: Body, pg: { W: number; H: number }): Cand[] {
  const topY = me.sy - 0.97 * me.h, out: Cand[] = [];
  const up = (dx: number, gap: number): void => {
    out.push({ cx: me.sx + dx, cy: topY - pg.H / 2 - gap, tip: { x: me.sx + clamp(dx * 0.4, -me.hw * 0.45, me.hw * 0.45), y: topY + me.h * 0.12 } });
  };
  for (const k of [0, -0.5, 0.5, -0.95, 0.95, -1.4, 1.4, -1.9, 1.9]) for (const gap of [14, 40, 80, 130]) up(k * pg.W * 0.6, gap);
  for (const sd of [-1, 1]) for (const hy of [0.45, 0.7]) {
    out.push({ cx: me.sx + sd * (me.hw + pg.W / 2 + 26), cy: me.sy - hy * me.h, tip: { x: me.sx + sd * me.hw * 0.55, y: me.sy - 0.62 * me.h } });
  }
  return out;
}

type Placed = { t0: number; t1: number; box: Box };

function choose(b: Balloon, pg: { W: number; H: number }, bodies: Body[], placed: Placed[], cands: Cand[]): { c: Cand; box: Box } {
  let best: { c: Cand; box: Box; pen: number } | null = null;
  for (const c of cands) {
    const box = { x0: c.cx - pg.W / 2, x1: c.cx + pg.W / 2, y0: c.cy - pg.H / 2, y1: c.cy + pg.H / 2 };
    let pen = 0;
    for (const o of bodies) pen += overlap(box, o) * (o.id === b.actor ? 1.6 : 1);
    const sharing = (p: Placed): boolean => Math.min(p.t1, b.t1) - Math.max(p.t0, b.t0) > 0.25;
    for (const p of placed) if (sharing(p)) pen += overlap(box, p.box) * 8;
    const out = (Math.max(0, 12 - box.x0) + Math.max(0, box.x1 - 1188)) * pg.H + (Math.max(0, 12 - box.y0) + Math.max(0, box.y1 - 588)) * pg.W;
    pen += out * 3 + Math.hypot(c.tip.x - c.cx, c.tip.y - c.cy) * 3.2 + Math.abs(c.cx - 600) * 0.02;
    // A tail must not cross another balloon or somebody else's face.
    for (let u = 0.3; u < 1; u += 0.1) {
      const px = c.cx + (c.tip.x - c.cx) * u, py = c.cy + (c.tip.y - c.cy) * u;
      for (const p of placed) if (sharing(p) && px > p.box.x0 && px < p.box.x1 && py > p.box.y0 && py < p.box.y1) pen += 900;
      for (const o of bodies) if (o.id !== b.actor && px > o.x0 && px < o.x1 && py > o.y0 && py < o.y1) pen += 700;
    }
    if (!best || pen < best.pen) best = { c, box, pen };
  }
  return best!;
}

/** Sets `pages`, `slot` and `world` on every balloon. Thoughts are cut to their first sentence. */
export function planBalloons(T: Timeline, ctx: LayoutContext): void {
  const placed: Placed[] = [];
  for (const b of [...T.balloons].sort((a, c) => a.t0 - c.t0)) {
    if (b.kind === "thought" && b.pages === undefined) {
      let t = b.text.split(/(?<=[.;—])\s/)[0] ?? b.text;
      if (t.length > 112) t = t.slice(0, 112).replace(/\s+\S*$/, "") + "…";
      b.text = t;
    }
    const font = fontFor(b.kind, ctx.archetype(b.actor), b.arousal);
    const fits = fitText(displayText(b), font, b.kind, ctx.measure);
    const scene = T.scenes[b.sceneIndex];
    const tS = Math.min(b.s1 - 0.05, Math.max(b.t0, (scene?.t0 ?? 0) + 1.4) + 0.1);
    const S = sampleTimeline(T, Math.max(tS, b.t0));
    const cam = S.cam;
    const bodies: Body[] = T.agents.map((id) => {
      const v = S.chars[id]!.v, h = v.w * 0.99, sx = (v.x - cam.cx) * cam.z + 600, sy = (v.y - cam.cy) * cam.z + 300;
      return { id, sx, sy, hw: 0.5 * v.w * cam.z, h: h * cam.z, x0: sx - 0.5 * v.w * cam.z - 6, x1: sx + 0.5 * v.w * cam.z + 6, y0: sy - 0.97 * h * cam.z - 6, y1: sy + 4 };
    });
    const me = bodies.find((x) => x.id === b.actor)!;
    const first = fits[0]!;
    const best = choose(b, first, bodies, placed, candidates(me, first));
    const toW = (x: number, y: number) => ({ x: (x - 600) / cam.z + cam.cx, y: (y - 300) / cam.z + cam.cy });
    b.slot = { cx: best.c.cx, cy: best.c.cy, tip: best.c.tip };
    b.world = { c: toW(best.c.cx, best.c.cy), tip: toW(best.c.tip.x, best.c.tip.y), z: cam.z };
    placed.push({ t0: b.t0, t1: b.t1, box: best.box });

    // Each page appears when its first word lands and gives way when the next page's first word lands.
    let k = 0;
    const pages: BalloonPage[] = fits.map((f) => {
      const n = f.lines.reduce((s, l) => s + tokensOf(l).length, 0);
      const page = { ...f, w0: k, n, t0: 0, t1: 0 };
      k += n;
      return page;
    });
    pages.forEach((p, i) => {
      const firstWord = b.words[p.w0]?.t ?? b.s0;
      p.t0 = i === 0 ? b.t0 : firstWord - 0.12;
      const next = pages[i + 1];
      const nextFirst = next ? b.words[next.w0]?.t : undefined;
      p.t1 = next ? (nextFirst !== undefined ? nextFirst + 0.18 : b.t1) : b.t1;
    });
    b.pages = pages;
  }
}
