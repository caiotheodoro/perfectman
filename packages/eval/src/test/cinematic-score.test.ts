import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLIMAX_CAP,
  FALLBACK_NORMS,
  fallbackNorms,
  GROUP_NAMES,
  GROUP_WEIGHTS,
  METRIC_IDS,
  bandFromEntry,
  bandScore,
  loadCinemaNorms,
  loadRunBundle,
  normsFromFile,
  scoreBundle,
  scoreRun,
  writeCinematicToReplay,
} from "../cinematic/index.js";
import { formatReport } from "../cli/cinematic.js";
import { flatScene, goodScene, writeRun } from "./cinematic-fixtures.js";

const tmp = () => mkdtempSync(join(tmpdir(), "pm-cine-score-"));

describe("norms: bands", () => {
  const band = { lo: 10, hi: 20, floor: 0, ceil: 40, source: "prior" as const };
  it("is 100 inside, linear to 0 at the floor and ceiling, 0 beyond", () => {
    expect(bandScore(10, band)).toBe(100);
    expect(bandScore(20, band)).toBe(100);
    expect(bandScore(5, band)).toBe(50);
    expect(bandScore(0, band)).toBe(0);
    expect(bandScore(-3, band)).toBe(0);
    expect(bandScore(30, band)).toBe(50);
    expect(bandScore(40, band)).toBe(0);
    expect(bandScore(99, band)).toBe(0);
  });
  it("a one-sided band never penalises more", () => {
    const more = { lo: 4, hi: null, floor: 1, ceil: null, source: "prior" as const };
    expect(bandScore(100, more)).toBe(100);
    expect(bandScore(1, more)).toBe(0);
    expect(bandScore(2.5, more)).toBe(50);
  });
  it("every metric the scorers read has a prior, and every prior is a sane band", () => {
    for (const m of METRIC_IDS) {
      const b = FALLBACK_NORMS[m];
      expect(b, m).toBeDefined();
      expect(b.floor, m).toBeLessThanOrEqual(b.lo);
      if (b.hi !== null) expect(b.hi, m).toBeGreaterThanOrEqual(b.lo);
      if (b.hi !== null && b.ceil !== null) expect(b.ceil, m).toBeGreaterThanOrEqual(b.hi);
    }
  });
});

describe("norms: the interface E1's file plugs into", () => {
  it("reads a band, or a percentile ladder (lo = p10, hi = p90, floor = p0, ceil = p100)", () => {
    expect(bandFromEntry({ lo: 1, hi: 2, floor: 0, ceil: 3 })).toMatchObject({ lo: 1, hi: 2, floor: 0, ceil: 3, source: "cinema-norms" });
    expect(bandFromEntry({ lo: 1, hi: null, floor: 0, ceil: null })).toMatchObject({ hi: null, ceil: null });
    const ladder = Array.from({ length: 15 }, (_, i) => i * 10);
    const b = bandFromEntry({ ladder })!;
    expect(b).toMatchObject({ floor: 0, ceil: 140, lo: 50, hi: 90 });
    expect(bandFromEntry(ladder.slice(0, 5))).toMatchObject({ source: "cinema-norms" });
    expect(bandFromEntry("nope")).toBeUndefined();
    expect(bandFromEntry({ hi: 3 })).toBeUndefined();
  });

  it("a file replaces only the metrics it names, records which, and lists what it ignored", () => {
    const { norms, ignored } = normsFromFile({ note: "n=300 scenes", metrics: { shotsPerMin: { lo: 8, hi: 20, floor: 2, ceil: 40 }, notAMetric: { lo: 1, floor: 0 } } }, "x.json");
    expect(norms.bands.shotsPerMin).toMatchObject({ lo: 8, hi: 20, source: "cinema-norms" });
    expect(norms.bands.incitingPos).toEqual(FALLBACK_NORMS.incitingPos);
    expect(norms.normSources.shotsPerMin).toBe("cinema-norms");
    expect(norms.normSources.incitingPos).toBe("prior");
    expect(norms.normSources.timeToClimaxS).toBe("product");
    expect(ignored).toEqual(["notAMetric"]);
    expect(norms.note).toBe("n=300 scenes");
  });

  it("rejects a file in another format instead of silently scoring against priors", () => {
    expect(() => normsFromFile({ foo: 1 }, "x.json")).toThrow(/no "metrics"/);
    expect(() => normsFromFile({ metrics: { other: { lo: 1, floor: 0 } } }, "x.json")).toThrow(/none of the/);
    expect(() => normsFromFile([], "x.json")).toThrow(/object/);
  });

  it("loads a named file (or CINEMA_NORMS_FILE), throws on a missing one, and falls back with no file anywhere", () => {
    const dir = tmp();
    const file = join(dir, "norms.json");
    writeFileSync(file, JSON.stringify({ metrics: { shotsPerMin: { lo: 8, hi: 20, floor: 2, ceil: 40 } } }));
    expect(loadCinemaNorms(file).bands.shotsPerMin.lo).toBe(8);
    expect(loadCinemaNorms(undefined, { CINEMA_NORMS_FILE: file }).bands.shotsPerMin.lo).toBe(8);
    expect(() => loadCinemaNorms(join(dir, "missing.json"))).toThrow(/not found/);
    writeFileSync(join(dir, "bad.json"), "{");
    expect(() => loadCinemaNorms(join(dir, "bad.json"))).toThrow(/not valid JSON/);
    expect(loadCinemaNorms(undefined, {}).origin).toMatch(/fallback|cinema-norms\.json/);
  });

  it("swapping the norms changes the score of the metric and nothing else", async () => {
    const dir = writeRun(goodScene());
    const base = await scoreRun(dir, { norms: fallbackNorms() });
    const { norms } = normsFromFile({ metrics: { shotsPerMin: { lo: 60, hi: 90, floor: 30, ceil: 120 } } }, "x.json");
    const swapped = await scoreRun(dir, { norms });
    const reading = (s: typeof base) => s.groups.camera.readings.find((r) => r.metric === "shotsPerMin")!;
    expect(reading(base).score).toBe(100);
    expect(reading(swapped).score).toBe(0);
    expect(swapped.groups.arc.score).toBe(base.groups.arc.score);
    expect(swapped.groups.embodiment.score).toBe(base.groups.embodiment.score);
    expect(swapped.norms.fromCinemaNorms).toBe(1);
    expect(base.norms.fromCinemaNorms).toBe(0);
    expect(base.norms.product).toBe(1);
  });
});

describe("the score", () => {
  it("weights: arc .30, dialogue .15, embodiment .20, camera .10, engagement .25, sum 1", () => {
    expect(GROUP_WEIGHTS).toEqual({ arc: 0.3, dialogue: 0.15, embodiment: 0.2, camera: 0.1, engagement: 0.25 });
    expect(GROUP_NAMES.reduce((a, n) => a + GROUP_WEIGHTS[n], 0)).toBeCloseTo(1, 10);
  });

  it("without the judge the overall is the renormalised mean of four groups, flagged partial", async () => {
    const s = await scoreRun(writeRun(goodScene()));
    expect(s.partial).toBe(true);
    expect(s.missing).toEqual(["engagement"]);
    expect(s.weights).toEqual({ arc: 40, dialogue: 20, embodiment: 26.7, camera: 13.3 });
    const g = s.groups;
    const expected = (g.arc.score! * 0.3 + g.dialogue.score! * 0.15 + g.embodiment.score! * 0.2 + g.camera.score! * 0.1) / 0.75;
    expect(s.raw!).toBeCloseTo(expected, 0);
    expect(s.score).toBe(s.raw);
    expect(s.deterministic).toBe(s.score);
  });

  it("with the judge the engagement group carries 25% and the overall is not partial", async () => {
    const { createMockEngagementProvider } = await import("../cinematic/index.js");
    const s = await scoreRun(writeRun(goodScene()), { judge: { provider: createMockEngagementProvider(5), mock: true } });
    expect(s.partial).toBe(false);
    expect(s.groups.engagement.score).toBe(100);
    expect(s.weights.engagement).toBe(25);
    expect(s.engagement).toMatchObject({ mock: true, mean: 5 });
    const g = s.groups;
    expect(s.raw!).toBeCloseTo(g.arc.score! * 0.3 + g.dialogue.score! * 0.15 + g.embodiment.score! * 0.2 + g.camera.score! * 0.1 + 25, 0);
    // deterministic is unchanged by the judge
    expect(s.deterministic).toBe((await scoreRun(writeRun(goodScene()))).deterministic);
  });

  it("a scene scored by every group but with no climax by 4:00 is capped below the passing line, whatever else it scores", async () => {
    const spec = goodScene();
    spec.acts = spec.acts!.filter((a) => a.verb !== "shove" && a.verb !== "slap");
    const s = await scoreRun(writeRun(spec), { judge: { provider: (await import("../cinematic/index.js")).createMockEngagementProvider(5), mock: true } });
    expect(s.invariants.climaxByDeadline.pass).toBe(false);
    expect(s.raw!).toBeGreaterThan(CLIMAX_CAP);
    expect(s.score).toBe(CLIMAX_CAP);
    expect(s.capped).toBe(true);
    expect(formatReport(s)).toContain(`capped from ${s.raw!.toFixed(1)}`);
  });

  it("ranks the built scene over the flat one on every deterministic group", async () => {
    const good = await scoreRun(writeRun(goodScene()));
    const flat = await scoreRun(writeRun(flatScene()));
    for (const n of ["arc", "dialogue", "embodiment", "camera"] as const) expect(good.groups[n].score!, n).toBeGreaterThan(flat.groups[n].score!);
    expect(good.score!).toBeGreaterThan(80);
    expect(flat.score!).toBeLessThan(35);
    expect(good.invariants.climaxByDeadline.pass).toBe(true);
    expect(flat.invariants.climaxByDeadline.pass).toBe(false);
  });

  it("every reading explains itself: a note, a weight, and a band or an explicit score", async () => {
    const s = await scoreRun(writeRun(goodScene()));
    for (const n of ["arc", "dialogue", "embodiment", "camera"] as const) {
      for (const r of s.groups[n].readings) {
        expect(r.note.length, `${n}.${r.metric}`).toBeGreaterThan(5);
        expect(r.weight).toBeGreaterThanOrEqual(0);
        if (r.score !== null) expect(r.score).toBeGreaterThanOrEqual(0);
        if (r.score !== null) expect(r.score).toBeLessThanOrEqual(100);
      }
    }
  });

  it("is deterministic: the same run scores the same twice", async () => {
    const dir = writeRun(goodScene());
    expect(await scoreRun(dir)).toEqual(await scoreRun(dir));
  });

  it("a window of a run is scored on its own times, not the whole run's files", async () => {
    const b = loadRunBundle(writeRun(goodScene()));
    const { sliceBundle } = await import("../cinematic/index.js");
    const w = sliceBundle(b, 140, 200);
    expect(w.dir).toBeUndefined();
    expect(w.durationS).toBe(60);
    expect(w.acts.map((a) => [a.verb, a.tS])).toEqual([["shove", 10], ["insult", 25], ["slap", 40], ["recoil", 46], ["cry", 60]]);
    const s = await scoreBundle(w);
    expect(s.invariants.climaxByDeadline).toMatchObject({ pass: true, atS: 40, verb: "slap" });
  });
});

describe("replay.json", () => {
  it("adds cinematic_score and keeps every other key, like script_likeness", async () => {
    const dir = writeRun(goodScene());
    const before = JSON.parse(readFileSync(join(dir, "replay.json"), "utf8"));
    writeFileSync(join(dir, "replay.json"), JSON.stringify({ ...before, script_likeness: { score: 25 }, counters: { llm_calls: 3 } }));
    const s = await scoreRun(dir);
    expect(writeCinematicToReplay(dir, s)).toBe(true);
    const after = JSON.parse(readFileSync(join(dir, "replay.json"), "utf8"));
    expect(after.script_likeness).toEqual({ score: 25 });
    expect(after.counters).toEqual({ llm_calls: 3 });
    expect(after.run).toBe(before.run);
    expect(after.cinematic_score).toMatchObject({ version: "cinematic-v1", partial: true, climax_by_deadline: { pass: true, verb: "slap", deadline_s: 240 } });
    expect(after.cinematic_score.groups.engagement).toBeNull();
    // idempotent
    writeCinematicToReplay(dir, s);
    expect(JSON.parse(readFileSync(join(dir, "replay.json"), "utf8"))).toEqual(after);
  });

  it("does nothing when there is no replay.json", async () => {
    const dir = writeRun(goodScene());
    const s = await scoreRun(dir);
    const other = tmp();
    expect(writeCinematicToReplay(other, s)).toBe(false);
  });
});
