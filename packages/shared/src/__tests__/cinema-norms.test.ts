import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { measureScene, CINEMA_NORMS, cinemaBucketKey, cinemaLadder, cinemaSizeStratum, curveFit, formatCinemaNormsJson, formatCinemaNormsTs, inLadderBand, ladderRank, pickCinemaBucket, resampleCurve } from "../index.js";
import type { CinemaBucket, CinemaLadder, CinemaNorms } from "../index.js";

const L = (o: Partial<CinemaLadder> = {}): CinemaLadder => ({ n: 100, p5: 1, p10: 2, p25: 4, p50: 8, p75: 12, p90: 20, p95: 30, ...o });
const bucket = (confidence: CinemaBucket["confidence"] = "high"): CinemaBucket => ({
  n: { scenes: 500, sources: 40, turns: 9000 }, confidence, caveats: [], ladders: { turns: L(), reversals: L({ p50: 1 }) }, bySize: { t20_39: { reversals: L({ p50: 2 }) } },
  curves: null, turnLengthShares: [], turnWordsLadder: L(), perSource: {}, strongArc: null, arcShare: 0.5, roleFlipShare: null,
});
const fake = (): CinemaNorms => ({ ...CINEMA_NORMS, buckets: { "pt/film/subtitle": bucket("low"), "pt/stage/play": bucket("high"), "pt/film/subtitle/thriller": bucket("high") } });

describe("cinema norms helpers", () => {
  it("ranks a value on a ladder", () => {
    const l = L();
    expect(ladderRank(l, 8)).toBe(50);
    expect(ladderRank(l, 10)).toBeCloseTo(62.5, 5);
    expect(ladderRank(l, 0)).toBeLessThan(5);
    expect(ladderRank(l, 100)).toBeGreaterThan(95);
    expect(ladderRank(l, 100)).toBeLessThanOrEqual(100);
    expect(inLadderBand(l, 8)).toBe(true);
    expect(inLadderBand(l, 25)).toBe(false);
  });
  it("picks a bucket by form preference, genre first, honouring confidence", () => {
    const n = fake();
    expect(pickCinemaBucket(n, { lang: "pt", genre: "thriller" })?.key).toBe("pt/film/subtitle/thriller");
    expect(pickCinemaBucket(n, { lang: "pt" })?.key).toBe("pt/film/subtitle");
    expect(pickCinemaBucket(n, { lang: "pt", minConfidence: "high" })?.key).toBe("pt/stage/play");
    expect(pickCinemaBucket(n, { lang: "en" })).toBeNull();
    expect(cinemaBucketKey("en", "film", "screenplay", "comedy")).toBe("en/film/screenplay/comedy");
  });
  it("prefers the size stratum of a ladder", () => {
    const b = bucket();
    expect(cinemaLadder(b, "reversals", 25)?.p50).toBe(2);
    expect(cinemaLadder(b, "reversals", 10)?.p50).toBe(1);
    expect(cinemaLadder(b, "reversals")?.p50).toBe(1);
    expect(cinemaSizeStratum(7)).toBeNull();
    expect(cinemaSizeStratum(45)).toBe("t40_plus");
  });
  it("fits a curve to a band and resamples a series", () => {
    const band = { n: 9, mean: Array(10).fill(0.5), p25: Array(10).fill(0.4), p50: Array(10).fill(0.5), p75: Array(10).fill(0.6) };
    expect(curveFit(Array(10).fill(0.5), band)).toEqual({ meanAbsDist: 0, inBandShare: 1 });
    expect(curveFit(Array(10).fill(0.9), band).inBandShare).toBe(0);
    const r = resampleCurve([0, 0, 0, 0, 0, 1, 1, 1, 1, 1], 5);
    expect(r).toEqual([0, 0, 0.5, 1, 1].map((x, i) => (i === 2 ? 0.5 : x)));
  });
});

describe("the committed cinema norms", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cinema-norms");
  const file = path.join(dir, "cinema-norms.json");

  it("are the same numbers in the JSON and in the generated module", () => {
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(CINEMA_NORMS);
    expect(readFileSync(file, "utf8")).toBe(formatCinemaNormsJson(CINEMA_NORMS));
    expect(readFileSync(path.join(dir, "cinema-norms.generated.ts"), "utf8")).toBe(formatCinemaNormsTs(CINEMA_NORMS));
  });

  it("hold numbers and short labels only: no free text from any work", () => {
    const longest: string[] = [];
    const walk = (v: unknown, p: string): void => {
      if (typeof v === "string") {
        // allowed prose: our own definitions, caveats, notes, reliability notes and bucket labels
        const ok = /^(definitions|notes|reliability)\b|\.caveats\.\d+$/.test(p) || v.length <= 40;
        if (!ok) longest.push(`${p}: ${v.slice(0, 60)}`);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}.${i}`));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
    };
    walk(CINEMA_NORMS, "");
    expect(longest).toEqual([]);
  });

  it("has well-formed ladders: monotone percentiles, n behind each bucket, curves of 10 slices", () => {
    expect(Object.keys(CINEMA_NORMS.buckets).length).toBeGreaterThan(0);
    for (const [key, b] of Object.entries(CINEMA_NORMS.buckets)) {
      expect(b.n.scenes, key).toBeGreaterThan(0);
      for (const [m, l] of Object.entries(b.ladders)) {
        const seq = [l.p5, l.p10, l.p25, l.p50, l.p75, l.p90, l.p95];
        for (let i = 1; i < seq.length; i++) expect(seq[i]!, `${key} ${m}`).toBeGreaterThanOrEqual(seq[i - 1]!);
        expect(l.n, `${key} ${m}`).toBeGreaterThan(0);
      }
      if (b.curves) for (const c of [b.curves.abs, b.curves.shape]) expect(c.p50, key).toHaveLength(CINEMA_NORMS.curveBins);
    }
  });
});

describe("measureScene on a clock-timed run (the scorer's use)", () => {
  it("reads silence, pace and the arc from real timestamps and keeps the direction figures", () => {
    const ev = [
      { kind: "speech" as const, speaker: "A", text: "Where were you last night?", t0: 0, t1: 2 },
      { kind: "speech" as const, speaker: "B", text: "Out.", t0: 9, t1: 9.5 },
      { kind: "direction" as const, text: "A slams the glass on the table.", t0: 12 },
      { kind: "speech" as const, speaker: "A", text: "You liar! Get out!", t0: 13, t1: 15 },
      { kind: "speech" as const, speaker: "B", text: "Fine.", t0: 16, t1: 17 },
      { kind: "speech" as const, speaker: "A", text: "Go.", t0: 25, t1: 26 },
    ];
    const f = measureScene({ sourceId: "run/63", index: 0, events: ev }, { id: "run/63", title: "run", lang: "en", medium: "stage", genre: "drama", era: "modern", form: "play", timeSource: "clock" }, { durSec: 0 })!;
    expect(f.turns).toBe(5);
    expect(f.hasDirections).toBe(true);
    expect(f.hardActs).toBe(1);
    expect(f.durSec).toBeGreaterThan(20);
    expect(f.silenceShare!).toBeGreaterThan(0.3);
    expect(f.gapsOver2sPerMin!).toBeGreaterThan(0);
    expect(f.curve).toHaveLength(10);
  });
});
