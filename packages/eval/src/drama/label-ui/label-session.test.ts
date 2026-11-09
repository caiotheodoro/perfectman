import { describe, expect, it } from "vitest";
import { DRAMA_AXES } from "../axes.js";
import type { ClipLabel } from "../label.js";
import {
  AXIS_QUESTIONS,
  isSafeClipId,
  mergeClipsWithStatuses,
  normalizeLabel,
  parseByteRange,
  parseLabelCliArgs,
  parseManifest,
  statusForLabel,
  summarizeProgress,
  toClipListItem,
} from "./label-session.js";

function label(over: Partial<ClipLabel> = {}): ClipLabel {
  return {
    clipId: "a",
    labeler: "caio",
    labeledAt: "2026-11-08T22:00:00.000Z",
    scores: Object.fromEntries(DRAMA_AXES.map((a) => [a, { score: 3 }])) as ClipLabel["scores"],
    failureCodes: [],
    pass: true,
    ...over,
  };
}

describe("isSafeClipId", () => {
  it.each(["01-default-walk-in-and-talk", "a", "clip_1.v2", "01b-dente"])("accepts %s", (id) => {
    expect(isSafeClipId(id)).toBe(true);
  });
  it.each(["", "..", "../x", "a/b", "a\\b", ".hidden", "a..b", "a b", "a\0b", "x".repeat(200), "%2e%2e"])("rejects %j", (id) => {
    expect(isSafeClipId(id)).toBe(false);
  });
});

describe("AXIS_QUESTIONS", () => {
  it("has a non-empty one-line question for every drama axis", () => {
    for (const axis of DRAMA_AXES) {
      expect(AXIS_QUESTIONS[axis].length).toBeGreaterThan(10);
      expect(AXIS_QUESTIONS[axis]).not.toContain("\n");
    }
  });
});

describe("parseManifest", () => {
  const manifest = {
    clips: 2,
    entries: [
      {
        clip: "01-a.mp4",
        path: "/evidence/01-a.mp4",
        symlink: "/baseline/clips/01-a.mp4",
        contact_sheet: "/baseline/contacts/01-a.png",
        duration_s: 12.5,
        scene: "bar",
        scene_name: "Bar scene",
        scores: [{ source: "judge.json", scores: { in_character: 1 } }],
      },
      { clip: "02-b.mp4", path: "rel/02-b.mp4", contact_sheet: null },
    ],
  };

  it("maps entries to clips, preferring the symlink and resolving relative paths against the manifest dir", () => {
    const clips = parseManifest(manifest, "/base");
    expect(clips).toEqual([
      { id: "01-a", title: "Bar scene", durationSec: 12.5, scene: "bar", videoPath: "/baseline/clips/01-a.mp4", contactPath: "/baseline/contacts/01-a.png" },
      { id: "02-b", title: "02-b", durationSec: null, scene: null, videoPath: "/base/rel/02-b.mp4", contactPath: null },
    ]);
  });

  it("never carries judge scores into the clip list shown to the labeler (blind mode)", () => {
    const items = parseManifest(manifest, "/base").map(toClipListItem);
    expect(JSON.stringify(items)).not.toMatch(/score|judge|in_character/i);
  });

  it("rejects duplicate ids, unsafe ids, entries without a video path and a missing entries array", () => {
    expect(() => parseManifest({ entries: [{ clip: "a.mp4", path: "/x" }, { clip: "a.mp4", path: "/y" }] }, "/")).toThrow(/duplicate/);
    expect(() => parseManifest({ entries: [{ clip: "../a.mp4", path: "/x" }] }, "/")).toThrow(/unsafe/);
    expect(() => parseManifest({ entries: [{ clip: "a.mp4" }] }, "/")).toThrow(/neither/);
    expect(() => parseManifest({ entries: [{ nope: 1 }] }, "/")).toThrow(/entry 0 is invalid/);
    expect(() => parseManifest({}, "/")).toThrow();
  });
});

describe("label status and progress", () => {
  const clips = parseManifest({ entries: ["a", "b", "c"].map((c) => ({ clip: `${c}.mp4`, path: `/v/${c}.mp4` })) }, "/");

  it("counts only parsed labels as labelled", () => {
    const statuses = [statusForLabel("a", label()), statusForLabel("b", null, true), statusForLabel("c", null)];
    expect(statuses[0]).toEqual({ id: "a", labeled: true, invalid: false, labeler: "caio", labeledAt: "2026-11-08T22:00:00.000Z", pass: true });
    expect(statuses[1]).toMatchObject({ labeled: false, invalid: true });
    expect(summarizeProgress(statuses)).toEqual({ labeled: 1, total: 3 });
  });

  it("merges clips with statuses in manifest order, treating a missing status as unlabelled", () => {
    const merged = mergeClipsWithStatuses(clips, [statusForLabel("c", label({ clipId: "c" }))]);
    expect(merged.map((m) => [m.id, m.labeled])).toEqual([["a", false], ["b", false], ["c", true]]);
  });
});

describe("normalizeLabel", () => {
  it("dedupes and sorts failure codes numerically within a family, and drops blank notes", () => {
    const out = normalizeLabel(label({ failureCodes: ["T3", "D10", "D2", "D2", "E1", "D1"], notes: "   " }));
    expect(out.failureCodes).toEqual(["D1", "D2", "D10", "E1", "T3"]);
    expect(out).not.toHaveProperty("notes");
  });
  it("trims notes", () => {
    expect(normalizeLabel(label({ notes: "  slap had no cause\n" })).notes).toBe("slap had no cause");
  });
});

describe("parseByteRange", () => {
  it("returns null for absent, malformed and multi-range headers so the whole file is served", () => {
    expect(parseByteRange(undefined, 100)).toBeNull();
    expect(parseByteRange("bytes=abc", 100)).toBeNull();
    expect(parseByteRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseByteRange("items=0-1", 100)).toBeNull();
    expect(parseByteRange("bytes=-", 100)).toBeNull();
    expect(parseByteRange("bytes=9-3", 100)).toBeNull();
  });
  it("parses closed, open-ended and suffix ranges and clamps the end to the file size", () => {
    expect(parseByteRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=95-500", 100)).toEqual({ start: 95, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
  });
  it("flags ranges outside the file as unsatisfiable", () => {
    expect(parseByteRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=0-1", 0)).toBe("unsatisfiable");
  });
});

describe("parseLabelCliArgs", () => {
  it("parses flags, defaults the port, and ignores the bare -- pnpm passes through", () => {
    expect(parseLabelCliArgs(["--", "--manifest", "m.json", "--labels", "out", "--labeler", " caio "])).toEqual({
      manifest: "m.json",
      labels: "out",
      port: 4777,
      labeler: "caio",
    });
    expect(parseLabelCliArgs(["--manifest=m.json", "--labels=out", "--port=0"]).port).toBe(0);
  });
  it("fails loudly on missing, unknown and invalid arguments", () => {
    expect(() => parseLabelCliArgs(["--labels", "out"])).toThrow(/--manifest is required/);
    expect(() => parseLabelCliArgs(["--manifest", "m"])).toThrow(/--labels is required/);
    expect(() => parseLabelCliArgs(["--manifest", "m", "--labels", "o", "--port", "99999"])).toThrow(/--port/);
    expect(() => parseLabelCliArgs(["--manifest", "m", "--labels", "o", "--wat", "1"])).toThrow(/unknown argument/);
    expect(() => parseLabelCliArgs(["--manifest", "--labels", "o"])).toThrow(/needs a value/);
  });
});
