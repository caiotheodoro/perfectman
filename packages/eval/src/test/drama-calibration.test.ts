import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CALIBRATION_THRESHOLD,
  DRAMA_AXES,
  DramaJudgeReplyError,
  JudgeSeparationError,
  axisVerdict,
  formatDramaCalibration,
  loadClipsManifest,
  loadHumanLabels,
  parseClipLabel,
  runDramaCalibration,
  serializeClipLabel,
  type ClipLabel,
  type DramaAxis,
} from "../drama/index.js";

type Scores = Record<DramaAxis, number | null>;

const label = (clipId: string, labeler: string, scores: Scores): ClipLabel => ({
  clipId,
  labeler,
  labeledAt: "2026-11-08T22:00:00.000Z",
  scores: Object.fromEntries(DRAMA_AXES.map((a) => [a, { score: scores[a] }])) as ClipLabel["scores"],
  failureCodes: [],
  pass: true,
});

/** One row per clip c1..c4, written down by hand; the expected kappas below were worked out on paper. */
const column = (values: Array<number | null>): Array<number | null> => values;
const HUMAN_COLS: Record<DramaAxis, Array<number | null>> = {
  physical_expressiveness: column([1, 2, 3, 4]),
  action_legibility: column([1, 5, 1, 5]),
  emotion_action_fit: column([3, 4, 2, null]),
  reaction_integrity: column([1, 3, 5, 3]),
  escalation_arc: column([null, null, null, null]),
  restraint: column([1, 2, 3, 4]),
};
const JUDGE_COLS: Record<DramaAxis, Array<number | null>> = {
  physical_expressiveness: column([1, 2, 3, 5]),
  action_legibility: column([5, 1, 5, 1]),
  emotion_action_fit: column([3, 4, null, null]),
  reaction_integrity: column([2, 3, 4, 3]),
  escalation_arc: column([null, null, null, null]),
  restraint: column([2, 3, 4, 5]),
};
const CLIP_IDS = ["c1", "c2", "c3", "c4"];

const rowOf = (cols: Record<DramaAxis, Array<number | null>>, i: number): Scores => Object.fromEntries(DRAMA_AXES.map((a) => [a, cols[a][i]!])) as Scores;
const humanLabels = (): ClipLabel[] => CLIP_IDS.map((id, i) => label(id, "human:caio", rowOf(HUMAN_COLS, i)));
const judgeLabelFor = (id: string): ClipLabel => label(id, "judge:acme/vision-1", rowOf(JUDGE_COLS, CLIP_IDS.indexOf(id)));

let dir: string;
let labelsDir: string;
let manifestPath: string;
let judgeOut: string;

function writeManifest(ids: readonly string[], extra: Record<string, unknown> = {}): void {
  writeFileSync(manifestPath, JSON.stringify({ ...extra, clips: ids.map((clipId) => ({ clipId, clip: `clips/${clipId}.mp4`, run: `runs/${clipId}` })) }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "drama-calib-"));
  labelsDir = join(dir, "human");
  judgeOut = join(dir, "judge");
  manifestPath = join(dir, "manifest.json");
  mkdirSync(labelsDir);
  // both on-disk formats: one label per .json file, and a .jsonl with one label per line
  const [c1, c2, c3, c4] = humanLabels();
  writeFileSync(join(labelsDir, "c1.json"), JSON.stringify(c1));
  writeFileSync(join(labelsDir, "c2.json"), JSON.stringify(c2));
  writeFileSync(join(labelsDir, "more.jsonl"), `${serializeClipLabel(c3!)}\n\n${serializeClipLabel(c4!)}\n`);
  writeManifest(CLIP_IDS);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const judgeByFixture = async (entry: { clipId: string }): Promise<ClipLabel> => judgeLabelFor(entry.clipId);

describe("axisVerdict", () => {
  it("passes at the 0.6 threshold itself, fails just under it, and has no verdict without a kappa", () => {
    expect(CALIBRATION_THRESHOLD).toBe(0.6);
    expect(axisVerdict(0.6, 0.6)).toBe("pass");
    expect(axisVerdict(0.5999, 0.6)).toBe("fail");
    expect(axisVerdict(-1, 0.6)).toBe("fail");
    expect(axisVerdict(null, 0.6)).toBe("no_data");
  });
});

describe("runDramaCalibration against fixture labels", () => {
  it("reports the hand-computed weighted kappa on every axis", async () => {
    const report = await runDramaCalibration({ manifestPath, labelsDir, judgeOutDir: judgeOut, judge: judgeByFixture });
    const k = (axis: DramaAxis): number | null => report.axes[axis].kappa;

    // [1,2,3,4] vs [1,2,3,5]: observed 0.984375, chance 0.78125, kappa 13/14
    expect(k("physical_expressiveness")).toBeCloseTo(13 / 14, 10);
    // extremes swapped: observed 0, chance 0.5, kappa -1
    expect(k("action_legibility")).toBeCloseTo(-1, 10);
    // only the two clips both sides scored count: (3,3) and (4,4)
    expect(k("emotion_action_fit")).toBeCloseTo(1, 10);
    // [1,3,5,3] vs [2,3,4,3]: observed 0.96875, chance 0.84375, kappa 0.8
    expect(k("reaction_integrity")).toBeCloseTo(0.8, 10);
    // every clip not applicable on both sides: nothing to correlate
    expect(k("escalation_arc")).toBeNull();
    // [1,2,3,4] vs [2,3,4,5]: observed 0.9375, chance 0.78125, kappa 5/7
    expect(k("restraint")).toBeCloseTo(5 / 7, 10);
  });

  it("counts not-applicable agreement and mismatch separately from the kappa", async () => {
    const report = await runDramaCalibration({ manifestPath, labelsDir, judgeOutDir: judgeOut, judge: judgeByFixture });
    expect(report.axes.emotion_action_fit).toMatchObject({ n: 2, bothNotApplicable: 1, notApplicableMismatch: 1 });
    expect(report.axes.escalation_arc).toMatchObject({ n: 0, bothNotApplicable: 4, notApplicableMismatch: 0 });
  });

  it("gives a pass/fail verdict per axis against 0.6 and an overall FAIL while any axis fails or has no data", async () => {
    const report = await runDramaCalibration({ manifestPath, labelsDir, judgeOutDir: judgeOut, judge: judgeByFixture });
    expect(Object.fromEntries(DRAMA_AXES.map((a) => [a, report.axes[a].verdict]))).toEqual({
      physical_expressiveness: "pass",
      action_legibility: "fail",
      emotion_action_fit: "pass",
      reaction_integrity: "pass",
      escalation_arc: "no_data",
      restraint: "pass",
    });
    expect(report.pass).toBe(false);
    // mean of the five kappas that exist: (13/14 - 1 + 1 + 0.8 + 5/7) / 5
    expect(report.meanKappa).toBeCloseTo((13 / 14 - 1 + 1 + 0.8 + 5 / 7) / 5, 10);
  });

  it("prints a line per axis and one closing PASS/FAIL line against the threshold", async () => {
    const report = await runDramaCalibration({ manifestPath, labelsDir, judgeOutDir: judgeOut, judge: judgeByFixture });
    const text = formatDramaCalibration(report);
    expect(text).toContain("drama judge calibration: judge:acme/vision-1");
    expect(text).toMatch(/physical_expressiveness\s+kappa\s+0\.929\s+n=4\s+PASS/);
    expect(text).toMatch(/action_legibility\s+kappa\s+-1\.000\s+n=4\s+FAIL/);
    expect(text).toMatch(/escalation_arc\s+kappa\s+n\/a\s+n=0\s+NO DATA/);
    expect(text).toContain("mean kappa 0.489");
    expect(text.trim().split("\n").pop()).toBe("FAIL: weighted kappa >= 0.6 is required on every axis; 4 of 6 axes pass, 1 fail, 1 without data");
  });

  it("passes overall when every axis has data and clears the threshold", async () => {
    const varied = CLIP_IDS.map((id, i) => label(id, "human:caio", Object.fromEntries(DRAMA_AXES.map((a) => [a, [1, 2, 4, 5][i]!])) as Scores));
    rmSync(labelsDir, { recursive: true });
    mkdirSync(labelsDir);
    for (const l of varied) writeFileSync(join(labelsDir, `${l.clipId}.json`), JSON.stringify(l));
    const judge = async (e: { clipId: string }): Promise<ClipLabel> => ({ ...varied.find((l) => l.clipId === e.clipId)!, labeler: "judge:acme/vision-1" });

    const report = await runDramaCalibration({ manifestPath, labelsDir, judgeOutDir: judgeOut, judge });
    expect(report.pass).toBe(true);
    expect(formatDramaCalibration(report).trim().split("\n").pop()).toBe("PASS: weighted kappa >= 0.6 on all 6 axes");
  });

  it("writes one judge label per clip and the agreement numbers into the judge output directory", async () => {
    await runDramaCalibration({ manifestPath, labelsDir, judgeOutDir: judgeOut, judge: judgeByFixture });
    expect(readdirSync(judgeOut).sort()).toEqual(["agreement.json", "c1.json", "c2.json", "c3.json", "c4.json"]);
    expect(parseClipLabel(readFileSync(join(judgeOut, "c3.json"), "utf8"))).toEqual(judgeLabelFor("c3"));
    const agreement = JSON.parse(readFileSync(join(judgeOut, "agreement.json"), "utf8")) as { threshold: number; pass: boolean; axes: Record<string, { kappa: number | null }> };
    expect(agreement.threshold).toBe(0.6);
    expect(agreement.pass).toBe(false);
    expect(agreement.axes["escalation_arc"]!.kappa).toBeNull();
  });

  it("judges only clips that have a human label, and reports the rest on both sides", async () => {
    writeManifest(["c1", "c2", "c3", "c4", "unlabeled"]);
    writeFileSync(join(labelsDir, "orphan.json"), JSON.stringify(label("orphan", "human:caio", rowOf(HUMAN_COLS, 0))));
    const judged: string[] = [];
    const report = await runDramaCalibration({
      manifestPath,
      labelsDir,
      judgeOutDir: judgeOut,
      judge: async (e) => {
        judged.push(e.clipId);
        return judgeLabelFor(e.clipId);
      },
    });
    expect(judged.sort()).toEqual(CLIP_IDS);
    expect(report.skippedNoHumanLabel).toEqual(["unlabeled"]);
    expect(report.labelsNotInManifest).toEqual(["orphan"]);
  });

  it("records a clip whose reply never validated as failed, keeps going, and fails the run", async () => {
    const report = await runDramaCalibration({
      manifestPath,
      labelsDir,
      judgeOutDir: judgeOut,
      judge: async (e) => {
        if (e.clipId === "c2") throw new DramaJudgeReplyError("no JSON object in the reply", 2, "blah");
        return judgeLabelFor(e.clipId);
      },
    });
    expect(report.failedClips).toEqual([{ clipId: "c2", error: expect.stringContaining("no JSON object") }]);
    expect(report.judged).toEqual(["c1", "c3", "c4"]);
    expect(report.pass).toBe(false);
    expect(formatDramaCalibration(report)).toContain("1 clip(s) could not be judged: c2");
  });

  it("stops the whole run on a separation violation instead of scoring around it", async () => {
    await expect(
      runDramaCalibration({
        manifestPath,
        labelsDir,
        judgeOutDir: judgeOut,
        judge: async () => {
          throw new JudgeSeparationError("acme/vision-1");
        },
      }),
    ).rejects.toBeInstanceOf(JudgeSeparationError);
  });

  it("hands the judge the clip's paths resolved against the manifest, with run, start time and actor models", async () => {
    writeFileSync(
      manifestPath,
      JSON.stringify({
        actorModels: ["actor/a"],
        clips: [{ clipId: "c1", clip: "clips/c1.mp4", run: "runs/c1", clipStartS: 12, emotionState: { duda: "angry" }, actorModels: ["actor/b"] }],
      }),
    );
    const seen: unknown[] = [];
    await runDramaCalibration({ manifestPath, labelsDir, judgeOutDir: judgeOut, judge: async (e) => (seen.push(e), judgeLabelFor(e.clipId)) });
    expect(seen).toEqual([
      {
        clipId: "c1",
        clipPath: join(dir, "clips/c1.mp4"),
        runDir: join(dir, "runs/c1"),
        clipStartS: 12,
        emotionState: { duda: "angry" },
        actorModels: ["actor/a", "actor/b"],
      },
    ]);
  });
});

describe("loadHumanLabels", () => {
  it("reads .json and .jsonl files in name order", () => {
    expect(loadHumanLabels(labelsDir).map((l) => l.clipId)).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("names the file and line of a label that does not validate", () => {
    writeFileSync(join(labelsDir, "bad.jsonl"), `${serializeClipLabel(humanLabels()[0]!)}\n{"clipId":"x"}\n`);
    expect(() => loadHumanLabels(labelsDir)).toThrow(/bad\.jsonl:2/);
  });

  it("refuses a directory with no labels", () => {
    const empty = join(dir, "empty");
    mkdirSync(empty);
    expect(() => loadHumanLabels(empty)).toThrow(/no label files/);
  });
});

describe("loadClipsManifest", () => {
  it("rejects a manifest with no clips or a clip missing its run", () => {
    writeFileSync(manifestPath, JSON.stringify({ clips: [] }));
    expect(() => loadClipsManifest(manifestPath)).toThrow(/clips/);
    writeFileSync(manifestPath, JSON.stringify({ clips: [{ clipId: "a", clip: "a.mp4" }] }));
    expect(() => loadClipsManifest(manifestPath)).toThrow(/run/);
  });
});
