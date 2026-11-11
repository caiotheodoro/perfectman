import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENGAGEMENT_AXES,
  KAPPA_BAR,
  MIN_CLIPS,
  bestCut,
  cohenKappa,
  engagementAgreement,
  freezeThresholds,
  loadHumanGrades,
  parseHumanGrade,
  spearman,
  uncalibratedThresholds,
  type HumanGrade,
  type JudgedClip,
} from "../cinematic/index.js";
import { runCinematicCli } from "../cli/cinematic.js";
import { goodScene, flatScene, writeRun } from "./cinematic-fixtures.js";

/** SYNTHETIC grades, made up for the tests: no real human has graded anything yet. */
const grade = (clipId: string, scores: Partial<Record<(typeof ENGAGEMENT_AXES)[number], number>>, grader = "synthetic"): HumanGrade => ({ clipId, grader, scores, otherAxes: {} });
const all = (n: number) => Object.fromEntries(ENGAGEMENT_AXES.map((a) => [a, n])) as JudgedClip;

describe("E3's real export, through E3's importer, into E2's loader", () => {
  const IMPORTER = new URL("../../../../scripts/grading/import-grades.mjs", import.meta.url).pathname;
  const axes = { narrative_arc: 4, dialogue_naturalness: 3, physical_expressiveness: 2, emotion_action_fit: 3, cinematography_staging: 3, entertainment: 5 };
  const exported = {
    kind: "perfectman-human-grades",
    exported_at: "2026-01-01T00:00:00Z",
    grades: [
      { clip_id: "c03", run_id: 62, window_s: [300, 600], complete: true, scores: axes, climax_reached: "yes", climax_time_s: 390, updated_at: "2026-01-01T00:00:00Z", note: "synthetic" },
      { clip_id: "c05", run_id: 63, window_s: null, complete: true, scores: { ...axes, entertainment: 2 }, climax_reached: "no" },
      { clip_id: "c09", run_id: 58, window_s: null, complete: false, scores: {} },
    ],
  };

  it("loads every clip it wrote, ignores its index.json, reads the window and the entertainment axis, and keeps the other five aside", () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-e3-"));
    const input = join(dir, "export.json");
    const out = join(dir, "grades");
    writeFileSync(input, JSON.stringify(exported));
    execFileSync(process.execPath, [IMPORTER, "--in", input, "--out", out, "--labeler", "synthetic"]);
    const grades = loadHumanGrades(out);
    expect(grades.map((g) => g.clipId)).toEqual(["c03", "c05"]);
    const c03 = grades[0]!;
    expect(c03).toMatchObject({ grader: "synthetic", run: "62", fromS: 300, toS: 600, climax: { reached: "yes", timeS: 390 }, scores: { entertaining: 5 } });
    expect(c03.otherAxes).toEqual({ narrative_arc: 4, dialogue_naturalness: 3, physical_expressiveness: 2, emotion_action_fit: 3, cinematography_staging: 3 });
    expect(grades[1]).toMatchObject({ run: "63", climax: { reached: "no" }, scores: { entertaining: 2 } });
    expect(grades[1]).not.toHaveProperty("fromS");
  });
});

describe("importing human grades (E3 format)", () => {
  it("reads six axes including entertainment, as numbers or {score, note}, with aliases", () => {
    const g = parseHumanGrade({ clipId: "c1", grader: "owner", run: 62, fromS: 0, toS: 240, scores: { tension: 4, surprise: { score: 3, note: "x" }, payoff: 2, character_distinctiveness: 3, "Rewatch value": 3, entertainment: 5 }, grade: "b" });
    expect(g.scores).toEqual({ tension: 4, surprise: 3, payoff: 2, distinctiveness: 3, rewatchability: 3, entertaining: 5 });
    expect(g).toMatchObject({ run: "62", fromS: 0, toS: 240, letter: "B", grader: "owner" });
  });

  it("keeps an axis the judge does not score aside, and treats null as not graded", () => {
    const g = parseHumanGrade({ clipId: "c1", scores: { tension: 4, physical_expressiveness: 2, payoff: null } });
    expect(g.scores).toEqual({ tension: 4 });
    expect(g.otherAxes).toEqual({ physical_expressiveness: 2 });
  });

  it("rejects an out-of-range score, a fractional one, a missing clip id and a missing scores object", () => {
    expect(() => parseHumanGrade({ clipId: "c", scores: { tension: 6 } })).toThrow(/integer 1-5/);
    expect(() => parseHumanGrade({ clipId: "c", scores: { tension: 2.5 } })).toThrow(/integer 1-5/);
    expect(() => parseHumanGrade({ scores: {} })).toThrow(/no clipId/);
    expect(() => parseHumanGrade({ clipId: "c" })).toThrow(/no "scores"/);
  });

  it("loads a directory of one-per-clip files, an array file, {grades: []} and .jsonl; and refuses a duplicate", () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-grades-"));
    writeFileSync(join(dir, "a.json"), JSON.stringify({ clipId: "a", scores: { tension: 3 } }));
    writeFileSync(join(dir, "b.json"), JSON.stringify([{ clipId: "b", scores: { tension: 4 } }, { clipId: "c", scores: { tension: 2 } }]));
    writeFileSync(join(dir, "c.json"), JSON.stringify({ grades: [{ clipId: "d", scores: { tension: 5 } }] }));
    writeFileSync(join(dir, "d.jsonl"), `${JSON.stringify({ clipId: "e", scores: { tension: 1 } })}\n\n${JSON.stringify({ clipId: "f", scores: { tension: 2 } })}\n`);
    expect(loadHumanGrades(dir).map((g) => g.clipId)).toEqual(["a", "b", "c", "d", "e", "f"]);
    writeFileSync(join(dir, "z.json"), JSON.stringify({ clipId: "a", scores: { tension: 3 } }));
    expect(() => loadHumanGrades(dir)).toThrow(/duplicate grade for clip "a"/);
    expect(() => loadHumanGrades(join(dir, "nope"))).toThrow(/no such file/);
    const empty = mkdtempSync(join(tmpdir(), "pm-grades-"));
    expect(() => loadHumanGrades(empty)).toThrow(/no grade files/);
  });
});

describe("agreement between the judge and the human", () => {
  it("cohen and weighted kappa: 1 for identical, near 0 for chance, negative against the grain", () => {
    const h = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5];
    expect(cohenKappa(h, h)).toBe(1);
    expect(cohenKappa(h, [5, 4, 3, 2, 1, 5, 4, 3, 2, 1])).toBeLessThan(0);
  });

  it("passes only with enough clips, a good kappa on entertaining AND on the mean, and some variance", () => {
    const ids = Array.from({ length: 14 }, (_, i) => `c${i}`);
    const levels = ids.map((_, i) => (i % 5) + 1);
    const humans = ids.map((id, i) => grade(id, Object.fromEntries(ENGAGEMENT_AXES.map((a) => [a, levels[i]!]))));
    const same = new Map(ids.map((id, i) => [id, all(levels[i]!)]));
    const ok = engagementAgreement(humans, same);
    expect(ok.pass).toBe(true);
    expect(ok.clips).toBe(14);
    expect(ok.perAxis.entertaining).toMatchObject({ n: 14, weightedKappa: 1, exact: 1, bias: 0 });

    const against = new Map(ids.map((id, i) => [id, all(6 - levels[i]!)]));
    const bad = engagementAgreement(humans, against);
    expect(bad.pass).toBe(false);
    expect(bad.reasons.join(" ")).toContain(`entertaining kappa`);

    const few = engagementAgreement(humans.slice(0, 5), same);
    expect(few.pass).toBe(false);
    expect(few.reasons[0]).toContain(`need ${MIN_CLIPS}`);
  });

  it("a judge that gives every clip the same score is degenerate, not a pass", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const humans = ids.map((id, i) => grade(id, Object.fromEntries(ENGAGEMENT_AXES.map((a) => [a, (i % 5) + 1]))));
    const flat = engagementAgreement(humans, new Map(ids.map((id) => [id, all(3)])));
    expect(flat.perAxis.entertaining.degenerate).toBe(true);
    expect(flat.pass).toBe(false);
    expect(flat.reasons.join(" ")).toContain("same score");
  });

  it("reports the bias (judge minus human) and the clips only one side has", () => {
    const humans = [grade("a", { entertaining: 2 }), grade("b", { entertaining: 3 }), grade("only-human", { entertaining: 4 })];
    const judged = new Map<string, JudgedClip>([["a", { entertaining: 4 }], ["b", { entertaining: 5 }], ["only-judge", { entertaining: 1 }]]);
    const r = engagementAgreement(humans, judged);
    expect(r.perAxis.entertaining.bias).toBe(2);
    expect(r.perAxis.entertaining.withinOne).toBe(0);
    expect(r.unmatched).toEqual({ human: ["only-human"], judge: ["only-judge"] });
  });

  it("several graders on one clip each count as a pair", () => {
    const humans = [grade("a", { entertaining: 2 }, "g1"), grade("a", { entertaining: 4 }, "g2"), grade("b", { entertaining: 5 })];
    const r = engagementAgreement(humans, new Map([["a", { entertaining: 3 }], ["b", { entertaining: 5 }]]));
    expect(r.perAxis.entertaining.n).toBe(3);
  });

  it("spearman: 1 for a monotone relation, null when there is nothing to rank", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(spearman([1, 2], [1, 2])).toBeNull();
  });
});

describe("frozen thresholds", () => {
  it("bestCut finds the score that separates the grades, and gives up when a side is too small", () => {
    const pts = [10, 20, 30, 40, 70, 80, 90, 95].map((score) => ({ score, positive: score >= 70 }));
    expect(bestCut(pts)).toMatchObject({ cut: 70, youden: 1, positives: 4, negatives: 4 });
    expect(bestCut(pts.slice(0, 5))).toBeNull();
  });

  it("freezes only when the judge clears the bar and each cut has clips on both sides; otherwise it says why and stays unfrozen", () => {
    const ids = Array.from({ length: 15 }, (_, i) => `c${i}`);
    const ent = ids.map((_, i) => (i % 5) + 1);
    const humans = ids.map((id, i) => grade(id, Object.fromEntries(ENGAGEMENT_AXES.map((a) => [a, ent[i]!]))));
    const judged = new Map(ids.map((id, i) => [id, all(ent[i]!)]));
    const scores = new Map(ids.map((id, i) => [id, { overall: ent[i]! * 15 + i * 0.1, deterministic: ent[i]! * 12 }]));
    const frozen = freezeThresholds({ humans, judged, scores, judge: "synthetic/judge", normsOrigin: "fallback", now: new Date("2026-01-02T00:00:00Z") });
    expect(frozen).toMatchObject({ status: "frozen", frozenAt: "2026-01-02T00:00:00.000Z", clips: 15, judge: "synthetic/judge" });
    expect(frozen.reasons).toEqual([]);
    expect(frozen.thresholds!.b!.cut).toBeGreaterThan(frozen.thresholds!.c!.cut);
    expect(frozen.spearman!.overall).toBeGreaterThan(0.9);
    expect(frozen.inputsSha256).toMatch(/^[0-9a-f]{64}$/);

    const unfrozen = freezeThresholds({ humans, judged: new Map(ids.map((id) => [id, all(3)])), scores });
    expect(unfrozen.status).toBe("unfrozen");
    expect(unfrozen.frozenAt).toBeUndefined();
    expect(unfrozen.reasons.length).toBeGreaterThan(0);

    const tooFew = freezeThresholds({ humans: humans.slice(0, 4), judged, scores });
    expect(tooFew.status).toBe("unfrozen");
    expect(tooFew.reasons.join(" ")).toMatch(/need 12/);
  });

  it("the placeholder says uncalibrated, with no thresholds", () => {
    expect(uncalibratedThresholds()).toMatchObject({ status: "uncalibrated", thresholds: null, clips: 0 });
  });
});

describe("the calibrate CLI, end to end on synthetic runs and synthetic grades", () => {
  it("scores each graded clip's run (or window of it), judges it with the mock, and refuses to freeze on 2 clips", async () => {
    const root = mkdtempSync(join(tmpdir(), "pm-cal-"));
    writeRun({ ...goodScene(), run: 7 }, join(root, "7"));
    writeRun({ ...flatScene(), run: 8 }, join(root, "8"));
    const grades = join(root, "grades");
    mkdirSync(grades);
    writeFileSync(join(grades, "g1.json"), JSON.stringify({ clipId: "good", run: 7, fromS: 0, toS: 240, scores: { tension: 5, entertainment: 5 } }));
    writeFileSync(join(grades, "g2.json"), JSON.stringify({ clipId: "flat", run: "8", scores: { tension: 1, entertainment: 1 } }));
    const target = join(root, "thresholds.json");
    let out = "";
    let err = "";
    const code = await runCinematicCli(["--calibrate", "--grades", grades, "--runs-root", root, "--judge", "mock", "--freeze", target], { env: {}, out: (s) => (out += s), err: (s) => (err += s) });
    expect(code).toBe(1);
    expect(out).toContain("unfrozen");
    expect(err).toContain("mock judge measures nothing");
    const written = JSON.parse((await import("node:fs")).readFileSync(target, "utf8"));
    expect(written.status).toBe("unfrozen");
    expect(written.clips).toBe(2);
    expect(written.reasons.join(" ")).toContain("need 12");
  });

  it("needs a judge, a runs root and a run on every grade", async () => {
    const run = (a: string[]) => runCinematicCli(a, { env: {}, out: () => {}, err: () => {} });
    expect(await run(["--calibrate", "--grades", "x"])).toBe(2);
    expect(await run(["--calibrate", "--grades", "x", "--runs-root", "y"])).toBe(2);
    const dir = mkdtempSync(join(tmpdir(), "pm-cal-"));
    writeFileSync(join(dir, "g.json"), JSON.stringify({ clipId: "x", scores: { tension: 3 } }));
    expect(await run(["--calibrate", "--grades", dir, "--runs-root", dir, "--judge", "mock"])).toBe(2);
  });

  it("KAPPA_BAR is the plan's 0.6", () => {
    expect(KAPPA_BAR).toBe(0.6);
  });
});
