import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CINEMA_NORMS, directionIntensity, measureScene, type CineEvent, type CinemaNorms as CorpusNorms } from "@perfectman/shared";
import { describe, expect, it } from "vitest";
import {
  ACT_TEXT,
  CLIMAX_CAP,
  HUMANLIKE_WEIGHT,
  METRIC_IDS,
  NORM_MAP,
  NORM_MAP_BY_METRIC,
  bandOfLadder,
  climaxInvariant,
  corpusNorms,
  fallbackNorms,
  loadRunBundle,
  measureRun,
  normsFromFile,
  parseHumanLikeReport,
  poolLadders,
  sceneOfBundle,
  scaleLadder,
  scoreArc,
  scoreBundle,
  scoreEmbodiment,
  shiftLadder,
  actionBuckets,
  structureBuckets,
  rhythmBuckets,
} from "../cinematic/index.js";
import { runCinematicCli } from "../cli/cinematic.js";
import { flatScene, goodScene, writeRun, type FxLine, type FxSpec } from "./cinematic-fixtures.js";

const load = (spec: FxSpec) => loadRunBundle(writeRun(spec));
const reading = (g: { readings: Array<{ metric: string; value: number | null; score: number | null; weight: number }> }, m: string) => g.readings.find((r) => r.metric === m)!;
const tmp = () => mkdtempSync(join(tmpdir(), "pm-cine-corpus-"));

/** A scene of `minutes` minutes: a line every 20 s that gets angrier until a punch at `punchAtS`, answered at once, then a calm tail. Invented text. */
function sixMinuteScene(punchAtS: number, minutes = 6): FxSpec {
  const angry = ["Good evening, did you sleep?", "Why did you ask me here?", "You lied to me about the money.", "I will not hear that, Ana.", "Stop. Enough. Be careful.", "You are a coward.", "You liar, you coward, get out.", "You bastard, I will kill you."];
  const calm = ["You hit me, you bastard, you coward!", "I do not know why I did that. I am sorry.", "Get out.", "Fine.", "Close the door.", "It is late.", "Go home, Bruno."];
  const lines: FxLine[] = [];
  const firstAfter = Math.ceil((punchAtS - 10) / 20);
  for (let i = 0; i < minutes * 3; i++) {
    const tS = 10 + i * 20;
    const text = tS < punchAtS ? angry[Math.min(angry.length - 1, Math.floor((i / firstAfter) * angry.length))]! : calm[(i - firstAfter) % calm.length]!;
    lines.push({ tS, ref: i % 2 === 0 ? "p1" : "p2", text });
  }
  return { durationS: minutes * 60, lines, acts: [{ tS: punchAtS, verb: "punch", actor: "p1", target: "p2" }] };
}

describe("the map from our metric ids to E1's norm ids", () => {
  it("has exactly one entry per metric, and the entry's status is the band's status in the corpus norms", () => {
    expect(NORM_MAP.map((e) => e.metric).sort()).toEqual([...METRIC_IDS].sort());
    const n = corpusNorms({ lang: "pt" });
    for (const m of METRIC_IDS) {
      expect(n.normSources[m], m).toBe(NORM_MAP_BY_METRIC[m].status);
      expect(n.bands[m].source, m).toBe(NORM_MAP_BY_METRIC[m].status);
    }
    const measured = NORM_MAP.filter((e) => e.status === "cinema-norms").map((e) => e.metric).sort();
    expect(measured).toEqual(["actsPerMin", "aftermathShare", "climaxPos", "hardActs", "incitingPos", "interruptionShare", "reversals", "shortReplyShare", "silenceShare", "turnsPerMin"]);
    expect(NORM_MAP.filter((e) => e.status === "product").map((e) => e.metric)).toEqual(["timeToClimaxS"]);
    // every measured metric names where in the corpus it came from
    for (const m of measured) expect(n.refs?.[m], m).toMatch(/^(pt|en)\/(film|series)\/(subtitle|screenplay|transcript)/);
  });

  it("the camera, the engine's body vocabulary, reply adherence and subtext stay priors: the corpus has no counterpart", () => {
    const n = corpusNorms({ lang: "pt" });
    for (const m of ["shotsPerMin", "distinctShots", "shotOnSpeaker", "staleDropRate", "distinctVerbs", "ladderSpan", "reactionIntegrity", "replyAdherence", "subtext", "escalationShape", "stakesChange", "deadAirShare", "pauseBeatsPerMin"] as const) {
      expect(n.normSources[m], m).toBe("prior");
      expect(n.bands[m]).toEqual(fallbackNorms().bands[m]);
    }
  });

  it("a corpus without the buckets keeps every prior (a smaller build still works)", () => {
    const empty: CorpusNorms = { ...CINEMA_NORMS, buckets: {} };
    const n = corpusNorms({ lang: "pt", corpus: empty });
    expect(n.normSources).toEqual(fallbackNorms().normSources);
    expect(n.bands).toEqual(fallbackNorms().bands);
  });
});

describe("bands built from E1's ladders", () => {
  it("pools ladders pointwise, shifts, scales and bounds them", () => {
    const a = { n: 10, p5: 1, p10: 2, p25: 3, p50: 4, p75: 5, p90: 6, p95: 7 };
    const b = { n: 30, p5: 3, p10: 4, p25: 5, p50: 6, p75: 7, p90: 8, p95: 9 };
    expect(poolLadders([a, b])).toEqual({ n: 40, p5: 2, p10: 3, p25: 4, p50: 5, p75: 6, p90: 7, p95: 8 });
    expect(shiftLadder(a, -2, 0, 1).p95).toBe(1);
    expect(shiftLadder(a, -2, 0, 1).p5).toBe(0);
    expect(scaleLadder(a, 0.5).p50).toBe(2);
    // [p25, p75] = [3, 5]; p5 = 1 is 2 below p25 so zero marks at 3 - 4 = -1, kept at 0; p95 = 7 is 2 above p75 so zero marks at 5 + 4 = 9
    expect(bandOfLadder(a, "p25", "p75")).toEqual({ lo: 3, hi: 5, floor: 0, ceil: 9, source: "cinema-norms" });
    // a ladder that is all zeros gives a band of one point, not NaN
    const zero = { n: 1, p5: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, p95: 0 };
    expect(bandOfLadder(zero, "p10", "p90")).toEqual({ lo: 0, hi: 0, floor: 0, ceil: 0, source: "cinema-norms" });
    // never below the range's start, never above its end
    expect(bandOfLadder(a, "p10", "p90", [5, 6])).toMatchObject({ lo: 5, hi: 6 });
  });

  it("position bands are the strong-arc ladders of film screenplays and series transcripts, pooled", () => {
    const n = corpusNorms({ lang: "pt" });
    const film = CINEMA_NORMS.buckets["en/film/screenplay"]!.strongArc!.ladders;
    const series = CINEMA_NORMS.buckets["en/series/transcript"]!.strongArc!.ladders;
    expect(n.bands.climaxPos.lo).toBeCloseTo((film["tClimax"]!.p25 + series["tClimax"]!.p25) / 2, 9);
    expect(n.bands.climaxPos.hi).toBeCloseTo((film["tClimax"]!.p75 + series["tClimax"]!.p75) / 2, 9);
    expect(n.bands.incitingPos.lo).toBeCloseTo((film["tInciting"]!.p25 + series["tInciting"]!.p25) / 2, 9);
    expect(n.bands.aftermathShare.hi).toBeCloseTo((film["aftermathShare"]!.p75 + series["aftermathShare"]!.p75) / 2, 9);
    // a 6 minute scene with the climax at 3.5 minutes (0.583 of it) is inside the corpus's band
    expect(n.bands.climaxPos.lo).toBeLessThan(210 / 360);
    expect(n.bands.climaxPos.hi!).toBeGreaterThan(210 / 360);
  });

  it("rhythm bands are the subtitle buckets of the run's language; short replies are shifted by the cue-length bias E1 measured", () => {
    const pt = corpusNorms({ lang: "pt" });
    expect(pt.origin).toContain("pt/film/subtitle + pt/series/subtitle");
    const film = CINEMA_NORMS.buckets["pt/film/subtitle"]!.ladders;
    const series = CINEMA_NORMS.buckets["pt/series/subtitle"]!.ladders;
    expect(pt.bands.silenceShare.lo).toBeCloseTo((film["silenceShare"]!.p10 + series["silenceShare"]!.p10) / 2, 9);
    expect(pt.bands.silenceShare.hi!).toBeCloseTo((film["silenceShare"]!.p90 + series["silenceShare"]!.p90) / 2, 9);
    const dFilm = CINEMA_NORMS.calibration["ptAdjusted.film.shortShare"]! - film["shortShare"]!.p50;
    const dSeries = CINEMA_NORMS.calibration["ptAdjusted.series.shortShare"]! - series["shortShare"]!.p50;
    expect(dFilm).toBeLessThan(-0.05);
    expect(pt.bands.shortReplyShare.lo).toBeCloseTo((film["shortShare"]!.p10 + dFilm + series["shortShare"]!.p10 + dSeries) / 2, 9);
    // the English runs get no pt adjustment
    const en = corpusNorms({ lang: "en" });
    expect(en.origin).toContain("en/film/subtitle + en/series/subtitle");
    expect(en.bands.shortReplyShare.lo).toBeCloseTo((CINEMA_NORMS.buckets["en/film/subtitle"]!.ladders["shortShare"]!.p10 + CINEMA_NORMS.buckets["en/series/subtitle"]!.ladders["shortShare"]!.p10) / 2, 9);
  });

  it("turns per minute is scaled down by the screenplay-to-subtitle ratio: a cue is not a turn", () => {
    const raw = (CINEMA_NORMS.buckets["pt/film/subtitle"]!.ladders["turnsPerMin"]!.p10 + CINEMA_NORMS.buckets["pt/series/subtitle"]!.ladders["turnsPerMin"]!.p10) / 2;
    const n = corpusNorms({ lang: "pt" });
    expect(raw).toBeGreaterThan(12);
    expect(n.bands.turnsPerMin.lo).toBeLessThan(raw * 0.75);
    expect(n.bands.turnsPerMin.lo).toBeGreaterThan(raw * 0.5);
  });

  it("counts by scene size: the same number of reversals is worth more in a short scene than in a long one", () => {
    const n = corpusNorms({ lang: "en" });
    const short = n.sized!.reversals!.t8_19!;
    const long = n.sized!.reversals!.t40_plus!;
    expect(short.lo).toBeGreaterThanOrEqual(1);
    expect(long.lo).toBeGreaterThan(short.lo);
    expect(n.sized!.hardActs!.t20_39!.lo).toBe(1);
  });

  it("--genre melodrama reads the soap-opera transcripts for structure, and leaves the rhythm buckets alone", () => {
    const mel = corpusNorms({ lang: "pt", genre: "melodrama" });
    expect(structureBuckets(CINEMA_NORMS, "melodrama").map((b) => b.key)).toEqual(["en/series/transcript/melodrama"]);
    expect(structureBuckets(CINEMA_NORMS).map((b) => b.key)).toEqual(["en/film/screenplay", "en/series/transcript"]);
    expect(rhythmBuckets(CINEMA_NORMS, "pt", "melodrama").map((b) => b.key)).toEqual(["pt/film/subtitle", "pt/series/subtitle"]);
    expect(mel.origin).toContain("genre melodrama");
    // action lines come from screenplays only, and a genre with no screenplay bucket falls back to the all-genre one
    expect(actionBuckets(CINEMA_NORMS, "melodrama").map((b) => b.key)).toEqual(["en/film/screenplay"]);
    expect(actionBuckets(CINEMA_NORMS, "drama").map((b) => b.key)).toEqual(["en/film/screenplay/drama"]);
    expect(mel.bands.actsPerMin).toEqual(corpusNorms({ lang: "pt" }).bands.actsPerMin);
    expect(mel.bands.actsPerMin.lo).toBeGreaterThan(0.5);
    expect(mel.bands.climaxPos.lo).toBeCloseTo(CINEMA_NORMS.buckets["en/series/transcript/melodrama"]!.strongArc!.ladders["tClimax"]!.p25, 9);
    expect(mel.bands.silenceShare).toEqual(corpusNorms({ lang: "pt" }).bands.silenceShare);
  });

  it("a norms file still overrides a corpus-measured metric, and is then counted as such", () => {
    const { norms } = normsFromFile({ metrics: { climaxPos: { lo: 0.1, hi: 0.2, floor: 0, ceil: 1 } } }, "x.json");
    expect(norms.bands.climaxPos).toMatchObject({ lo: 0.1, source: "cinema-norms" });
    expect(norms.normSources.timeToClimaxS).toBe("product");
  });
});

describe("a run, measured the way the corpus was", () => {
  it("every act verb the engine has is rendered into the lexicon class it belongs to, in both languages", () => {
    const hard = ["shove", "slap", "punch", "kill", "die", "faint", "restrain", "hug", "kiss"];
    for (const [verb, text] of Object.entries(ACT_TEXT)) {
      for (const lang of ["en", "pt"] as const) {
        const d = directionIntensity(text[lang], lang);
        if (hard.includes(verb)) expect(d.hard, `${verb} ${lang}`).toBeGreaterThan(0);
        else expect([d.hard, d.soft > 0], `${verb} ${lang}`).toEqual([0, true]);
      }
    }
    // violence is conflict, tenderness is a physical beat that is not
    expect(directionIntensity(ACT_TEXT["punch"]!.en, "en").v).toBeGreaterThan(0.8);
    expect(directionIntensity(ACT_TEXT["kiss"]!.en, "en").v).toBeLessThan(0.5);
  });

  it("builds the scene from the lines and the acts that reached the screen, on the clock, and measures it with measureScene itself", () => {
    const b = load({ durationS: 100, lines: [{ tS: 5, ref: "p1", text: "You lied to me." }, { tS: 20, ref: "p2", text: "I did not." }, { tS: 40, ref: "p1", text: "Liar!" }, { tS: 60, ref: "p2", text: "Get out!" }], acts: [{ tS: 50, verb: "slap", actor: "p1", target: "p2" }, { tS: 55, verb: "punch", actor: "p1", target: "p2", outcome: "aborted" }] });
    const { scene, info } = sceneOfBundle(b);
    expect(info.timeSource).toBe("clock");
    expect(scene.events.map((e) => [e.kind, e.t0])).toEqual([["speech", 5], ["speech", 20], ["speech", 40], ["direction", 50], ["speech", 60]]);
    const direct = measureScene(scene, info, { durSec: 100 });
    expect(measureRun(b).features).toEqual(direct);
    expect(direct!.hardActs).toBe(1);
    expect(measureRun(b)).toBe(measureRun(b));
    // the same words and acts typed into a scene by hand give the same features
    const hand: CineEvent[] = [
      { kind: "speech", speaker: "Ana", text: "You lied to me.", t0: 5 },
      { kind: "speech", speaker: "Bruno", text: "I did not.", t0: 20 },
      { kind: "speech", speaker: "Ana", text: "Liar!", t0: 40 },
      { kind: "direction", text: "slaps", t0: 50 },
      { kind: "speech", speaker: "Bruno", text: "Get out!", t0: 60 },
    ];
    expect(measureScene({ sourceId: "x", index: 0, events: hand }, info, { durSec: 100 })!.turnsPerMin).toBeCloseTo(direct!.turnsPerMin, 9);
  });

  it("reads inciting, climax, aftermath and reversals only where the proxy finds a strong arc, and says why when it does not", () => {
    const n = fallbackNorms();
    const flat = scoreArc(load(flatScene()), n);
    for (const m of ["incitingPos", "reversals", "climaxPos", "aftermathShare"]) {
      expect(reading(flat, m), m).toMatchObject({ value: null, score: null });
    }
    expect(flat.readings.find((r) => r.metric === "incitingPos")!.note).toMatch(/near-blind to cold or afraid conflict/);
    const heated = scoreArc(load(sixMinuteScene(210)), n);
    expect(heated.detail["corpus"]).toMatchObject({ strongArc: true });
    expect(reading(heated, "climaxPos").value).not.toBeNull();
  });

  it("a 6 minute scene with the climax at 3.5 minutes matches the corpus median: the product line and the corpus agree", () => {
    const b = load(sixMinuteScene(210));
    const g = scoreArc(b, corpusNorms({ lang: "en" }));
    const pos = reading(g, "climaxPos");
    expect(pos.value!).toBeGreaterThan(0.45);
    expect(pos.value!).toBeLessThan(0.75);
    expect(pos.score).toBe(100);
    expect(reading(g, "timeToClimaxS")).toMatchObject({ value: 210, score: 100 });
    expect(climaxInvariant(b).pass).toBe(true);
  });
});

describe("rhythm and action readings", () => {
  const talk = (every: number, words: string | string[], n = 12): FxSpec => ({ durationS: every * n, lines: Array.from({ length: n }, (_, i) => ({ tS: 5 + i * every, ref: i % 2 === 0 ? "p1" : "p2", text: Array.isArray(words) ? words[i % words.length]! : words })) });
  const norms = corpusNorms({ lang: "en" });

  it("a quick back-and-forth of short lines is inside the corpus's rhythm; one slow, long line every 20 s is not", async () => {
    const { scoreDialogue } = await import("../cinematic/index.js");
    const quick = scoreDialogue(load(talk(6, ["Come on, then.", "I told you already, I am not going anywhere tonight."])), norms);
    const slow = scoreDialogue(load(talk(20, "I have been thinking for a long time about what you said to me last night and I do not know.")), norms);
    expect(reading(quick, "turnsPerMin").score).toBe(100);
    expect(reading(quick, "shortReplyShare").score).toBe(100);
    expect(reading(slow, "turnsPerMin").score).toBe(0);
    expect(reading(slow, "shortReplyShare").score).toBe(0);
    expect(reading(quick, "turnsPerMin").value!).toBeGreaterThan(reading(slow, "turnsPerMin").value! * 3);
  });

  it("counts hard acts with the corpus's reader, against the band for the scene's size", () => {
    const none = scoreEmbodiment(load(talk(10, "Hello there, friend.", 12)), norms);
    expect(reading(none, "hardActs")).toMatchObject({ value: 0, score: 0 });
    const hit = scoreEmbodiment(load({ ...talk(10, "Hello there, friend.", 12), acts: [{ tS: 50, verb: "slap", actor: "p1", target: "p2" }] }), norms);
    expect(reading(hit, "hardActs")).toMatchObject({ value: 1, score: 100 });
    // a hug is a physical beat the corpus counts as a hard act; a glare is not
    const glare = scoreEmbodiment(load({ ...talk(10, "Hello there, friend.", 12), acts: [{ tS: 50, verb: "glare", actor: "p1", target: "p2" }] }), norms);
    expect(reading(glare, "hardActs").value).toBe(0);
    expect(reading(scoreEmbodiment(load({ ...talk(10, "Hello there, friend.", 12), acts: [{ tS: 50, verb: "hug", actor: "p1", target: "p2" }] }), norms), "hardActs").value).toBe(1);
  });
});

describe("the 4:00 climax is the owner's requirement, not a statistic", () => {
  it("the invariant, its cap and the product band do not move with the norms", async () => {
    // a scene that otherwise reads well, with its only physical act at 4:10
    const spec = { ...sixMinuteScene(250) };
    const dir = writeRun(spec);
    const variants = [
      corpusNorms({ lang: "en" }),
      corpusNorms({ lang: "en", genre: "melodrama" }),
      fallbackNorms(),
      // every band thrown wide open: whatever the norms say, the invariant must not care
      normsFromFile({ metrics: Object.fromEntries(METRIC_IDS.map((m) => [m, { lo: 0, hi: null, floor: -1000, ceil: null }])) }, "open.json").norms,
    ];
    for (const norms of variants) {
      const s = await scoreBundle(loadRunBundle(dir), { norms });
      expect(s.invariants.climaxByDeadline).toMatchObject({ pass: false, deadlineS: 240, atS: 250 });
      expect(s.score!).toBeLessThanOrEqual(CLIMAX_CAP);
      expect(s.deterministic!).toBeLessThanOrEqual(CLIMAX_CAP);
    }
    const open = await scoreBundle(loadRunBundle(dir), { norms: variants[3]! });
    expect(open.raw!).toBeGreaterThan(CLIMAX_CAP);
    expect(open).toMatchObject({ capped: true, score: CLIMAX_CAP });
    // and a climax inside the deadline is not capped
    const ok = await scoreBundle(load(sixMinuteScene(210)), { norms: variants[3]! });
    expect(ok.invariants.climaxByDeadline.pass).toBe(true);
    expect(ok.capped).toBe(false);
  });

  it("the product band is the only one whose source is `product`, in the corpus norms and in the priors", () => {
    for (const n of [corpusNorms({ lang: "pt" }), fallbackNorms()]) {
      expect(METRIC_IDS.filter((m) => n.bands[m].source === "product")).toEqual(["timeToClimaxS"]);
      expect(n.bands.timeToClimaxS).toMatchObject({ lo: 0, hi: 210, floor: 0, ceil: 300 });
    }
  });
});

describe("the human-likeness hook (agent B5's module, off by default)", () => {
  const report = { score0to100: 80, components: { gait: 90, idle: 70 } };

  it("validates a report and clamps the score", () => {
    expect(parseHumanLikeReport(report)).toEqual(report);
    expect(parseHumanLikeReport({ score0to100: 140, components: {} }).score0to100).toBe(100);
    expect(parseHumanLikeReport({ score0to100: -5, components: {} }).score0to100).toBe(0);
    expect(() => parseHumanLikeReport(null)).toThrow(/object/);
    expect(() => parseHumanLikeReport({ score0to100: "x", components: {} })).toThrow(/score0to100/);
    expect(() => parseHumanLikeReport({ score0to100: 1 })).toThrow(/components/);
    expect(() => parseHumanLikeReport({ score0to100: 1, components: { a: "b" } })).toThrow(/component "a"/);
  });

  it("is off without a report: no reading, the same score as before, and the detail says so", () => {
    const b = load(goodScene());
    const off = scoreEmbodiment(b, fallbackNorms());
    expect(off.readings.some((r) => r.metric === "humanLike")).toBe(false);
    expect(off.detail["humanLike"]).toBe("off");
    expect(scoreEmbodiment(b, fallbackNorms(), {}).score).toBe(off.score);
  });

  it("enters the embodiment group as one reading at its weight, and moves the group towards it", () => {
    const b = load(goodScene());
    const off = scoreEmbodiment(b, fallbackNorms());
    const low = scoreEmbodiment(b, fallbackNorms(), { humanlike: { score0to100: 10, components: { gait: 5 } } });
    const high = scoreEmbodiment(b, fallbackNorms(), { humanlike: { score0to100: 100, components: { gait: 100 } } });
    const r = reading(high, "humanLike");
    expect(r).toMatchObject({ value: 100, score: 100, weight: HUMANLIKE_WEIGHT });
    expect(low.score!).toBeLessThan(off.score!);
    expect(high.score!).toBeGreaterThanOrEqual(off.score!);
    expect(high.score!).toBeGreaterThan(low.score!);
    expect(high.detail["humanLike"]).toEqual({ score0to100: 100, components: { gait: 100 } });
    // the other readings are untouched
    expect(high.readings.filter((x) => x.metric !== "humanLike")).toEqual(off.readings);
  });

  it("scoreBundle and the CLI take it; a bad file is a usage error", async () => {
    const dir = writeRun(goodScene());
    const viaApi = await scoreBundle(loadRunBundle(dir), { humanlike: report });
    expect(viaApi.groups.embodiment.readings.some((r) => r.metric === "humanLike")).toBe(true);
    const file = join(tmp(), "hl.json");
    writeFileSync(file, JSON.stringify(report));
    let out = "";
    const code = await runCinematicCli(["--run", dir, "--json", "--humanlike", file], { env: {}, out: (s) => (out += s), err: () => {} });
    expect(code).toBe(0);
    expect(JSON.parse(out).groups.embodiment.detail.humanLike).toEqual(report);
    writeFileSync(file, "{}");
    let err = "";
    expect(await runCinematicCli(["--run", dir, "--humanlike", file], { env: {}, out: () => {}, err: (s) => (err += s) })).toBe(2);
    expect(err).toMatch(/score0to100/);
  });
});

describe("the CLI's norms", () => {
  const run = async (args: string[]) => {
    let out = "";
    let err = "";
    const code = await runCinematicCli(args, { env: {}, out: (s) => (out += s), err: (s) => (err += s) });
    return { code, out, err };
  };

  it("uses the corpus norms by default, all priors with --priors, and refuses --priors next to a norms file", async () => {
    const dir = writeRun(goodScene());
    const d = JSON.parse((await run(["--run", dir, "--json"])).out);
    expect(d.norms).toMatchObject({ fromCinemaNorms: 10, product: 1, priors: METRIC_IDS.length - 11 });
    expect(d.norms.origin).toContain("en/film/subtitle");
    const p = JSON.parse((await run(["--run", dir, "--json", "--priors"])).out);
    expect(p.norms).toMatchObject({ fromCinemaNorms: 0, product: 1 });
    const file = join(tmp(), "n.json");
    writeFileSync(file, JSON.stringify({ metrics: { shotsPerMin: { lo: 1, hi: 2, floor: 0, ceil: 3 } } }));
    expect((await run(["--run", dir, "--priors", "--norms", file])).code).toBe(2);
    const f = JSON.parse((await run(["--run", dir, "--json", "--norms", file])).out);
    expect(f.norms.fromCinemaNorms).toBe(1);
  });

  it("--genre is checked and changes the structure norms' origin", async () => {
    const dir = writeRun(goodScene());
    expect((await run(["--run", dir, "--genre", "opera"])).code).toBe(2);
    const m = JSON.parse((await run(["--run", dir, "--json", "--genre", "melodrama"])).out);
    expect(m.norms.origin).toContain("genre melodrama");
  });
});
