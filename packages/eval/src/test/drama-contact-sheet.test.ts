import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  actMarksFromEvents,
  buildContactSheets,
  findFfmpeg,
  labelFilter,
  planLayout,
  selectFrameTimes,
  type ContactSheetResult,
  type DramaEvent,
} from "../drama/index.js";

const times = (plan: ReturnType<typeof selectFrameTimes>): number[] => plan.map((f) => f.tS);

describe("selectFrameTimes", () => {
  it("samples -0.5 s .. +2.5 s around an act at 4 fps and every 2 s elsewhere", () => {
    const plan = selectFrameTimes(30, [{ actId: "a1", atS: 10 }]);
    const dense = plan.filter((f) => f.reason === "act");
    expect(times(dense)).toEqual([9.5, 9.75, 10, 10.25, 10.5, 10.75, 11, 11.25, 11.5, 11.75, 12, 12.25, 12.5]);
    expect(dense.every((f) => f.actIds.join() === "a1")).toBe(true);
    // 10 s and 12 s fall inside the dense window, so the sparse grid skips them
    expect(times(plan.filter((f) => f.reason === "sparse"))).toEqual([0, 2, 4, 6, 8, 14, 16, 18, 20, 22, 24, 26, 28]);
    expect(times(plan)).toEqual([...times(plan)].sort((a, b) => a - b));
  });

  it("drops window frames that fall outside the clip instead of clamping them onto duplicates", () => {
    const plan = selectFrameTimes(3, [{ actId: "a1", atS: 0.2 }]);
    expect(times(plan.filter((f) => f.reason === "act"))).toEqual([0.2, 0.45, 0.7, 0.95, 1.2, 1.45, 1.7, 1.95, 2.2, 2.45, 2.7]);
  });

  it("merges overlapping act windows without duplicate frames and keeps both act ids on shared frames", () => {
    const plan = selectFrameTimes(20, [
      { actId: "a1", atS: 5 },
      { actId: "a2", atS: 6 },
    ]);
    const dense = plan.filter((f) => f.reason === "act");
    expect(times(dense)).toEqual([4.5, 4.75, 5, 5.25, 5.5, 5.75, 6, 6.25, 6.5, 6.75, 7, 7.25, 7.5, 7.75, 8, 8.25, 8.5]);
    expect(dense.find((f) => f.tS === 5.5)?.actIds).toEqual(["a1", "a2"]);
    expect(dense.find((f) => f.tS === 4.5)?.actIds).toEqual(["a1"]);
  });

  it("with no acts is the sparse grid only", () => {
    const plan = selectFrameTimes(7, []);
    expect(plan).toEqual([0, 2, 4, 6].map((tS) => ({ tS, reason: "sparse", actIds: [] })));
  });

  it("caps the frame count by thinning sparse frames first, so every dense frame survives", () => {
    const acts = [
      { actId: "a1", atS: 10 },
      { actId: "a2", atS: 30 },
      { actId: "a3", atS: 50 },
    ];
    const plan = selectFrameTimes(60, acts, { maxFrames: 45 });
    expect(plan).toHaveLength(45);
    // 3 windows of 13 dense frames, so 39 stay and the 6 left over go to evenly spread sparse frames
    expect(plan.filter((f) => f.reason === "act")).toHaveLength(39);
    expect(plan.filter((f) => f.reason === "sparse")).toHaveLength(6);
    expect(times(plan)).toEqual([...times(plan)].sort((a, b) => a - b));
    expect(selectFrameTimes(60, acts, { maxFrames: 45 })).toEqual(plan);
  });

  it("when the dense windows alone exceed the cap, keeps the frames nearest each act", () => {
    const plan = selectFrameTimes(60, [{ actId: "a1", atS: 10 }], { maxFrames: 5 });
    expect(plan).toHaveLength(5);
    expect(times(plan)).toEqual([9.5, 9.75, 10, 10.25, 10.5]);
  });

  it("never plans more frames than the sheets can hold", () => {
    const plan = selectFrameTimes(600, [], { maxFrames: 500, cols: 4, rows: 3, maxSheets: 2 });
    expect(plan).toHaveLength(24);
  });

  it("rejects a clip with no duration", () => {
    expect(() => selectFrameTimes(0, [])).toThrow(/duration/);
  });
});

describe("planLayout", () => {
  it("fits a full sheet inside the pixel caps, with even tile sizes that keep the clip's aspect ratio", () => {
    const layout = planLayout({ width: 640, height: 480 }, 12, {});
    expect(layout.tile).toEqual({ width: 382, height: 286 });
    expect(layout.sheets).toEqual([{ cols: 4, rows: 3, frames: 12, width: 4 * 382 + 3 * 2, height: 3 * 286 + 2 * 2 }]);
  });

  it("shrinks tiles of a tall clip until the sheet height cap holds", () => {
    const layout = planLayout({ width: 360, height: 640 }, 12, { maxSheetHeight: 900 });
    const sheet = layout.sheets[0]!;
    expect(sheet.height).toBeLessThanOrEqual(900);
    expect(layout.tile.width % 2).toBe(0);
    expect(layout.tile.height % 2).toBe(0);
  });

  it("never upscales past the clip's own size", () => {
    expect(planLayout({ width: 160, height: 120 }, 4, {}).tile).toEqual({ width: 160, height: 120 });
  });

  it("splits frames across sheets and trims the last sheet to the rows it needs", () => {
    const layout = planLayout({ width: 640, height: 480 }, 30, {});
    expect(layout.sheets.map((s) => [s.frames, s.cols, s.rows])).toEqual([
      [12, 4, 3],
      [12, 4, 3],
      [6, 4, 2],
    ]);
  });

  it("uses fewer columns when a sheet holds fewer frames than a row", () => {
    expect(planLayout({ width: 640, height: 480 }, 3, {}).sheets).toEqual([expect.objectContaining({ cols: 3, rows: 1, frames: 3 })]);
  });
});

describe("labelFilter", () => {
  it("draws a black plate and white glyph pixels with drawbox only (stock ffmpeg has no drawtext)", () => {
    const filter = labelFilter("#07 1.25s", 2);
    expect(filter.startsWith("drawbox=x=0:y=0:")).toBe(true);
    expect(filter).toContain("color=black");
    expect(filter).toContain("color=white");
    expect(filter).not.toContain("drawtext");
  });

  it("is the same for the same text and differs for different text", () => {
    expect(labelFilter("#01 0.00s", 2)).toBe(labelFilter("#01 0.00s", 2));
    expect(labelFilter("#01 0.00s", 2)).not.toBe(labelFilter("#02 0.00s", 2));
  });

  it("refuses a character it has no glyph for", () => {
    expect(() => labelFilter("a1", 2)).toThrow(/glyph/);
  });
});

describe("actMarksFromEvents", () => {
  const started = (actId: string, atMs: number): DramaEvent => ({ kind: "act_started", atMs, actId, verb: "shove", actor: "duda", with: "rafa", intensity: 0.5 });
  const speech: DramaEvent = { kind: "speech", atMs: 1000, actor: "duda", mode: "say", text: "oi" };

  it("keeps act_started only, in seconds, relative to the clip start", () => {
    const marks = actMarksFromEvents([speech, started("a1", 12_000), started("a2", 15_500)], { clipStartMs: 10_000, durationS: 30 });
    expect(marks).toEqual([
      { actId: "a1", atS: 2 },
      { actId: "a2", atS: 5.5 },
    ]);
  });

  it("drops acts outside the clip", () => {
    const marks = actMarksFromEvents([started("early", 1000), started("in", 11_000), started("late", 99_000)], { clipStartMs: 10_000, durationS: 5 });
    expect(marks.map((m) => m.actId)).toEqual(["in"]);
  });
});

const ffmpeg = findFfmpeg();

describe.runIf(ffmpeg !== undefined)("buildContactSheets (real ffmpeg, no network)", () => {
  let dir: string;
  let clip: string;
  let result: ContactSheetResult;
  let plain: ContactSheetResult;

  const run = (args: string[]): Buffer => {
    const r = spawnSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.toString()}`);
    return r.stdout;
  };

  /** Gray values (0-255) of a crop of a sheet, row-major. */
  const pixels = (png: string, w: number, h: number, x: number, y: number): Uint8Array =>
    new Uint8Array(run(["-i", png, "-vf", `crop=${w}:${h}:${x}:${y},format=gray`, "-f", "rawvideo", "-frames:v", "1", "-"]));

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "drama-sheet-"));
    clip = join(dir, "clip.mp4");
    // solid red during seconds 0-1, 2-3, 4-5; solid blue otherwise: a frame's colour says which second it came from
    run([
      "-f", "lavfi", "-i", "color=c=blue:s=160x120:r=10:d=6",
      "-vf", "format=rgb24,geq=r='255*lt(mod(T,2),1)':g=0:b='255*gte(mod(T,2),1)',format=yuv420p",
      "-pix_fmt", "yuv420p", clip,
    ]);
    result = buildContactSheets({ clipPath: clip, outDir: join(dir, "out"), acts: [{ actId: "a1", atS: 2 }] });
    plain = buildContactSheets({ clipPath: clip, outDir: join(dir, "plain"), acts: [{ actId: "a1", atS: 2 }], burnLabels: false });
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes PNG sheets and a frame index map that points at real tiles", () => {
    expect(result.sheets.length).toBeGreaterThan(0);
    for (const sheet of result.sheets) {
      expect(existsSync(sheet.path)).toBe(true);
      expect(readFileSync(sheet.path).subarray(1, 4).toString("ascii")).toBe("PNG");
    }
    // act at 2 s: 13 dense frames (1.5 .. 4.5), plus sparse frames at 0 and 6? 6 is past the end, so only 0
    expect(result.frames.map((f) => f.tS)).toEqual([0, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4, 4.25, 4.5]);
    expect(result.frames.map((f) => f.index)).toEqual(result.frames.map((_, i) => i + 1));
    expect(result.frames.find((f) => f.tS === 2)).toMatchObject({ reason: "act", actIds: ["a1"] });
    expect(result.frames[0]).toMatchObject({ reason: "sparse", actIds: [] });
    expect(result.durationS).toBeCloseTo(6, 1);
  });

  it("stays inside the frame, image and pixel caps", () => {
    const total = result.sheets.reduce((n, s) => n + s.frameIndices.length, 0);
    expect(total).toBe(result.frames.length);
    expect(result.sheets.length).toBeLessThanOrEqual(4);
    for (const sheet of result.sheets) {
      expect(sheet.width).toBeLessThanOrEqual(1536);
      expect(sheet.height).toBeLessThanOrEqual(1152);
    }
  });

  it("reports the pixel size the PNG really has", () => {
    for (const sheet of result.sheets) {
      const header = readFileSync(sheet.path);
      expect([header.readUInt32BE(16), header.readUInt32BE(20)]).toEqual([sheet.width, sheet.height]);
    }
  });

  it("places each frame at the row and column its index map entry names, with content from that second", () => {
    const sheet = result.sheets[0]!;
    const sample = (index: number): number => {
      const f = result.frames.find((x) => x.index === index)!;
      const tileW = (sheet.width - (sheet.cols - 1) * 2) / sheet.cols;
      const tileH = (sheet.height - (sheet.rows - 1) * 2) / sheet.rows;
      const x = (f.col - 1) * (tileW + 2) + tileW - 12;
      const y = (f.row - 1) * (tileH + 2) + tileH - 12;
      return pixels(sheet.path, 4, 4, x, y)[0]!;
    };
    const at = (tS: number): number => sample(result.frames.find((f) => f.tS === tS)!.index);
    // red in gray is bright-ish (about 76), blue is dark (about 29): red at 2.25 s (second 2), blue at 1.5 s (second 1)
    expect(at(2.25)).toBeGreaterThan(at(1.5) + 20);
    expect(at(0)).toBeGreaterThan(at(1.75) + 20);
    expect(at(3.25)).toBeLessThan(at(2.5));
  });

  it("burns a label into every tile: the same sheet without labels has none of those black and white pixels", () => {
    const labelled = pixels(result.sheets[0]!.path, 80, 16, 2, 2);
    const bare = pixels(plain.sheets[0]!.path, 80, 16, 2, 2);
    const count = (px: Uint8Array, test: (v: number) => boolean): number => px.filter(test).length;
    expect(count(labelled, (v) => v > 240)).toBeGreaterThan(20);
    expect(count(labelled, (v) => v < 20)).toBeGreaterThan(20);
    expect(count(bare, (v) => v > 240)).toBe(0);
    expect(count(bare, (v) => v < 20)).toBe(0);
  });

  it("reports an unreadable clip clearly", () => {
    expect(() => buildContactSheets({ clipPath: join(dir, "missing.mp4"), outDir: join(dir, "x") })).toThrow(/missing\.mp4/);
  });
});

describe.runIf(ffmpeg === undefined)("buildContactSheets without ffmpeg", () => {
  it("says why the real-ffmpeg contact sheet tests did not run", () => {
    console.warn("ffmpeg not found (set FFMPEG_PATH or install /opt/homebrew/bin/ffmpeg): contact sheet integration tests are not running");
    expect(findFfmpeg()).toBeUndefined();
  });
});
