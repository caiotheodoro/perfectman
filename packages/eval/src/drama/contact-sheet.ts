/**
 * Contact sheets: an mp4 clip tiled into a few PNG grids a vision model can
 * read, sampled densely around acts and sparsely elsewhere, with a burned-in
 * timestamp on every tile.
 *
 * Planning (`selectFrameTimes`, `planLayout`) is pure; `buildContactSheets`
 * shells out to ffmpeg (no shell, argument arrays only). Stock ffmpeg builds
 * ship without `drawtext`, so the label is drawn with `drawbox` from a built-in
 * 5x7 bitmap font; the font covers exactly the characters a label uses.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DramaEvent } from "./events.js";

export const DEFAULT_FFMPEG_PATH = "/opt/homebrew/bin/ffmpeg";

/** Where an act starts, in seconds from the clip's start. */
export type ActMark = { actId: string; atS: number };

export type FrameReason = "act" | "sparse";

export type PlannedFrame = { tS: number; reason: FrameReason; actIds: string[] };

export type SamplingOptions = {
  /** Seconds before an act that are sampled densely. Default 0.5. */
  densePreS?: number;
  /** Seconds after an act that are sampled densely. Default 2.5. */
  densePostS?: number;
  /** Frames per second inside a dense window. Default 4. */
  denseFps?: number;
  /** Frames per second outside every dense window. Default 0.5 (one every 2 s). */
  sparseFps?: number;
  /** Hard cap on frames across all sheets. Default 48. */
  maxFrames?: number;
  cols?: number;
  rows?: number;
  maxSheets?: number;
};

export type LayoutOptions = {
  cols?: number;
  rows?: number;
  /** Wanted tile width in px; the sheet caps may shrink it. Default 384. */
  tileWidth?: number;
  /** Default 1536. */
  maxSheetWidth?: number;
  /** Default 1152. */
  maxSheetHeight?: number;
  /** Pixels between tiles. Default 2. */
  padding?: number;
};

export type SheetLayout = { cols: number; rows: number; frames: number; width: number; height: number };

export type Layout = { tile: { width: number; height: number }; sheets: SheetLayout[] };

export type ContactSheetOptions = SamplingOptions &
  LayoutOptions & {
    clipPath: string;
    outDir: string;
    acts?: readonly ActMark[];
    ffmpegPath?: string;
    /** Draw `#NN t.tts` on every tile. Default true. */
    burnLabels?: boolean;
  };

export type ContactSheet = {
  path: string;
  /** 1-based. */
  sheet: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  /** `FrameIndexEntry.index` of the tiles on this sheet, in reading order. */
  frameIndices: number[];
};

export type FrameIndexEntry = {
  /** 1-based, in time order; the number burned into the tile. */
  index: number;
  tS: number;
  /** 1-based sheet, row and column. */
  sheet: number;
  row: number;
  col: number;
  reason: FrameReason;
  actIds: string[];
};

export type ContactSheetResult = {
  sheets: ContactSheet[];
  frames: FrameIndexEntry[];
  durationS: number;
  video: { width: number; height: number };
  tile: { width: number; height: number };
};

const SAMPLING_DEFAULTS = { densePreS: 0.5, densePostS: 2.5, denseFps: 4, sparseFps: 0.5, maxFrames: 48, cols: 4, rows: 3, maxSheets: 4 } as const;
const LAYOUT_DEFAULTS = { tileWidth: 384, maxSheetWidth: 1536, maxSheetHeight: 1152, padding: 2 } as const;

/** The last second of a clip has no frame to grab exactly at its end. */
const END_MARGIN_S = 0.05;

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const even = (n: number): number => Math.floor(n / 2) * 2;

/** Which ffmpeg to use: `FFMPEG_PATH`, then the Homebrew path, then `ffmpeg` on PATH; undefined when none runs. */
export function findFfmpeg(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates = [env["FFMPEG_PATH"], DEFAULT_FFMPEG_PATH, "ffmpeg"].filter((c): c is string => c !== undefined && c !== "");
  return candidates.find((c) => spawnSync(c, ["-version"], { stdio: "ignore" }).status === 0);
}

type DenseSlot = { tS: number; actIds: string[]; dist: number; isAct: boolean };

/** Picks the timestamps to grab: dense around each act, sparse elsewhere, capped. Sorted by time. */
export function selectFrameTimes(durationS: number, acts: readonly ActMark[], options: SamplingOptions = {}): PlannedFrame[] {
  if (!(durationS > 0)) throw new Error(`clip has no duration (${durationS})`);
  const o = { ...SAMPLING_DEFAULTS, ...options };
  const cap = Math.min(o.maxFrames, o.cols * o.rows * o.maxSheets);
  const lastT = round3(durationS - END_MARGIN_S);

  const dense = new Map<number, DenseSlot>();
  const preSteps = Math.round(o.densePreS * o.denseFps);
  const postSteps = Math.round(o.densePostS * o.denseFps);
  for (const act of acts) {
    for (let k = -preSteps; k <= postSteps; k++) {
      const tS = round3(act.atS + k / o.denseFps);
      if (tS < 0 || tS > lastT) continue;
      const key = Math.round(tS * 1000);
      const slot = dense.get(key) ?? { tS, actIds: [], dist: Infinity, isAct: false };
      if (!slot.actIds.includes(act.actId)) slot.actIds.push(act.actId);
      slot.dist = Math.min(slot.dist, Math.abs(k) / o.denseFps);
      slot.isAct = slot.isAct || k === 0;
      dense.set(key, slot);
    }
  }

  const inWindow = (tS: number): boolean => acts.some((a) => tS >= a.atS - o.densePreS - 1e-9 && tS <= a.atS + o.densePostS + 1e-9);
  const sparse: number[] = [];
  for (let i = 0; ; i++) {
    const tS = round3(i / o.sparseFps);
    if (tS > lastT) break;
    if (!inWindow(tS)) sparse.push(tS);
  }

  let keptDense = [...dense.values()];
  let keptSparse = sparse;
  if (keptDense.length >= cap) {
    keptDense = [...keptDense].sort((a, b) => Number(b.isAct) - Number(a.isAct) || a.dist - b.dist || a.tS - b.tS).slice(0, cap);
    keptSparse = [];
  } else {
    const budget = cap - keptDense.length;
    if (sparse.length > budget) keptSparse = Array.from({ length: budget }, (_, i) => sparse[Math.floor((i * sparse.length) / budget)]!);
  }

  return [
    ...keptDense.map((s): PlannedFrame => ({ tS: s.tS, reason: "act", actIds: s.actIds })),
    ...keptSparse.map((tS): PlannedFrame => ({ tS, reason: "sparse", actIds: [] })),
  ].sort((a, b) => a.tS - b.tS);
}

/** Tile size and per-sheet grid for `nFrames` frames of a clip, inside the pixel caps. */
export function planLayout(video: { width: number; height: number }, nFrames: number, options: LayoutOptions = {}): Layout {
  const cols = options.cols ?? SAMPLING_DEFAULTS.cols;
  const rows = options.rows ?? SAMPLING_DEFAULTS.rows;
  const o = { ...LAYOUT_DEFAULTS, ...options };
  const maxTileW = Math.floor((o.maxSheetWidth - (cols - 1) * o.padding) / cols);
  const maxTileH = Math.floor((o.maxSheetHeight - (rows - 1) * o.padding) / rows);

  let tileW = even(Math.min(o.tileWidth, maxTileW, video.width));
  let tileH = even((tileW * video.height) / video.width);
  if (tileH > maxTileH) {
    tileH = even(maxTileH);
    tileW = even((tileH * video.width) / video.height);
    tileH = even((tileW * video.height) / video.width);
  }
  if (tileW < 2 || tileH < 2) throw new Error(`sheet caps leave no room for a tile (${o.maxSheetWidth}x${o.maxSheetHeight}, ${cols}x${rows})`);

  const sheets: SheetLayout[] = [];
  for (let remaining = nFrames; remaining > 0; remaining -= cols * rows) {
    const frames = Math.min(cols * rows, remaining);
    const c = Math.min(cols, frames);
    const r = Math.ceil(frames / c);
    sheets.push({ cols: c, rows: r, frames, width: c * tileW + (c - 1) * o.padding, height: r * tileH + (r - 1) * o.padding });
  }
  return { tile: { width: tileW, height: tileH }, sheets };
}

/** Act starts as clip-relative marks. `clipStartMs` is where the clip begins in run time (events are run-relative). */
export function actMarksFromEvents(events: readonly DramaEvent[], opts: { clipStartMs?: number; durationS?: number } = {}): ActMark[] {
  const start = opts.clipStartMs ?? 0;
  const marks: ActMark[] = [];
  for (const e of events) {
    if (e.kind !== "act_started") continue;
    const atS = round3((e.atMs - start) / 1000);
    if (atS < 0 || (opts.durationS !== undefined && atS > opts.durationS)) continue;
    marks.push({ actId: e.actId, atS });
  }
  return marks;
}

// ---------------------------------------------------------------------------
// Label: 5x7 bitmap glyphs drawn with drawbox
// ---------------------------------------------------------------------------

const GLYPH_COLS = 5;
const GLYPH_ROWS = 7;

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "#": ["01010", "01010", "11111", "01010", "11111", "01010", "01010"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  s: ["00000", "00000", "01111", "10000", "01110", "00001", "11110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

/** An ffmpeg filter chain that paints `text` on a black plate in the top-left corner. `scale` is pixels per glyph dot. */
export function labelFilter(text: string, scale: number): string {
  const pad = scale;
  const advance = (GLYPH_COLS + 1) * scale;
  const plateW = pad * 2 + text.length * advance - scale;
  const plateH = pad * 2 + GLYPH_ROWS * scale;
  const boxes = [`drawbox=x=0:y=0:w=${plateW}:h=${plateH}:color=black:t=fill`];
  [...text].forEach((ch, ci) => {
    const glyph = GLYPHS[ch];
    if (glyph === undefined) throw new Error(`no glyph for "${ch}" in the label font`);
    glyph.forEach((bits, row) => {
      for (let col = 0; col < GLYPH_COLS; col++) {
        if (bits[col] !== "1") continue;
        let end = col;
        while (end + 1 < GLYPH_COLS && bits[end + 1] === "1") end++;
        boxes.push(`drawbox=x=${pad + ci * advance + col * scale}:y=${pad + row * scale}:w=${(end - col + 1) * scale}:h=${scale}:color=white:t=fill`);
        col = end;
      }
    });
  });
  return boxes.join(",");
}

// ---------------------------------------------------------------------------
// ffmpeg
// ---------------------------------------------------------------------------

function runFfmpeg(ffmpeg: string, args: readonly string[]): void {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (r.error) throw new Error(`could not run ${ffmpeg}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}) on ${args.slice(-1)[0]}: ${r.stderr.trim().slice(0, 400)}`);
}

function probeClip(ffmpeg: string, clipPath: string): { durationS: number; width: number; height: number } {
  if (!existsSync(clipPath)) throw new Error(`clip not found: ${clipPath}`);
  const r = spawnSync(ffmpeg, ["-hide_banner", "-i", clipPath], { encoding: "utf8" });
  if (r.error) throw new Error(`could not run ${ffmpeg}: ${r.error.message}`);
  const text = r.stderr;
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  const size = /Video:[^\n]*?,\s*(\d{2,5})x(\d{2,5})\b/.exec(text);
  if (!dur || !size) throw new Error(`could not read duration and size of ${clipPath}: ${text.trim().slice(-300)}`);
  return { durationS: Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]), width: Number(size[1]), height: Number(size[2]) };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Grabs the sampled frames, labels them, and tiles them into one or more PNG sheets under `outDir`. */
export function buildContactSheets(options: ContactSheetOptions): ContactSheetResult {
  const ffmpeg = options.ffmpegPath ?? findFfmpeg();
  if (ffmpeg === undefined) throw new Error("ffmpeg not found (set FFMPEG_PATH or install it at /opt/homebrew/bin/ffmpeg)");
  const probe = probeClip(ffmpeg, options.clipPath);
  const plan = selectFrameTimes(probe.durationS, options.acts ?? [], options);
  const layout = planLayout({ width: probe.width, height: probe.height }, plan.length, options);
  const padding = options.padding ?? LAYOUT_DEFAULTS.padding;
  const burn = options.burnLabels ?? true;
  const labelScale = Math.max(2, Math.floor(layout.tile.width / 128));

  const framesDir = join(options.outDir, "frames-tmp");
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });

  try {
    plan.forEach((frame, i) => {
      const index = i + 1;
      const filters = [`scale=${layout.tile.width}:${layout.tile.height}`, "format=rgb24"];
      if (burn) filters.push(labelFilter(`#${pad2(index)} ${frame.tS.toFixed(2)}s`, labelScale));
      runFfmpeg(ffmpeg, ["-ss", String(frame.tS), "-i", options.clipPath, "-frames:v", "1", "-vf", filters.join(","), join(framesDir, `f_${String(index).padStart(3, "0")}.png`)]);
    });

    const sheets: ContactSheet[] = [];
    const frames: FrameIndexEntry[] = [];
    let next = 1;
    layout.sheets.forEach((sheetLayout, s) => {
      const path = join(options.outDir, `sheet_${s + 1}.png`);
      runFfmpeg(ffmpeg, [
        "-start_number", String(next),
        "-framerate", "1",
        "-i", join(framesDir, "f_%03d.png"),
        "-vf", `tile=${sheetLayout.cols}x${sheetLayout.rows}:padding=${padding}:margin=0:color=gray`,
        "-frames:v", "1",
        path,
      ]);
      const frameIndices: number[] = [];
      for (let k = 0; k < sheetLayout.frames; k++) {
        const index = next + k;
        const planned = plan[index - 1]!;
        frameIndices.push(index);
        frames.push({ index, tS: planned.tS, sheet: s + 1, row: Math.floor(k / sheetLayout.cols) + 1, col: (k % sheetLayout.cols) + 1, reason: planned.reason, actIds: planned.actIds });
      }
      next += sheetLayout.frames;
      sheets.push({ path, sheet: s + 1, cols: sheetLayout.cols, rows: sheetLayout.rows, width: sheetLayout.width, height: sheetLayout.height, frameIndices });
    });

    return { sheets, frames, durationS: probe.durationS, video: { width: probe.width, height: probe.height }, tile: layout.tile };
  } finally {
    rmSync(framesDir, { recursive: true, force: true });
  }
}
