import { describe, expect, it } from "vitest";
import {
  CLIMAX_DEADLINE_S,
  escalationShape,
  fallbackNorms,
  findClimax,
  initiativeSwaps,
  loadRunBundle,
  climaxInvariant,
  risingTurns,
  scoreArc,
  tensionSeries,
  beatsOf,
} from "../cinematic/index.js";
import { CAST, flatScene, goodScene, writeRun, type FxSpec } from "./cinematic-fixtures.js";

const norms = fallbackNorms();
const load = (spec: FxSpec) => loadRunBundle(writeRun(spec));
const reading = (g: { readings: Array<{ metric: string; value: number | null; score: number | null }> }, m: string) => g.readings.find((r) => r.metric === m)!;

describe("arc: the climax invariant", () => {
  const slapAt = (tS: number): FxSpec => ({ durationS: 400, acts: [{ tS, verb: "slap", actor: "p1", target: "p2" }] });

  it("passes at the deadline and fails a second after it", () => {
    expect(climaxInvariant(load(slapAt(CLIMAX_DEADLINE_S))).pass).toBe(true);
    const late = climaxInvariant(load(slapAt(CLIMAX_DEADLINE_S + 1)));
    expect(late.pass).toBe(false);
    expect(late.reason).toContain("after 240 s");
  });

  it("fails with a reason when nothing physical happened, and a glare or an insult is not physical", () => {
    const r = climaxInvariant(load({ durationS: 300, acts: [{ tS: 10, verb: "glare", actor: "p1", target: "p2" }, { tS: 20, verb: "insult", actor: "p2", target: "p1" }] }));
    expect(r).toMatchObject({ pass: false, atS: null, verb: null });
  });

  it("ignores an act that never played out (aborted, declined, timeout)", () => {
    for (const outcome of ["aborted", "declined", "timeout"]) {
      expect(climaxInvariant(load({ durationS: 300, acts: [{ tS: 30, verb: "punch", actor: "p1", target: "p2", outcome }] })).pass, outcome).toBe(false);
    }
    expect(climaxInvariant(load({ durationS: 300, acts: [{ tS: 30, verb: "punch", actor: "p1", target: "p2", outcome: "dodged" }] })).pass).toBe(true);
  });

  it("takes the earliest physical act within 80% of the strongest one as the climax", () => {
    const b = load({ durationS: 600, acts: [{ tS: 50, verb: "shove", actor: "p1", target: "p2" }, { tS: 120, verb: "slap", actor: "p1", target: "p2" }, { tS: 300, verb: "punch", actor: "p2", target: "p1" }] });
    // strongest is the punch (5); 80% is 4; the slap (4) is the earliest to reach it, the shove (3) is not
    expect(findClimax(b)).toMatchObject({ verb: "slap", atS: 120 });
  });
});

describe("arc: shape of the tension", () => {
  it("escalationShape is high for a climb, 0 for a peak at once, and 0 for a flat line", () => {
    expect(escalationShape([0, 1, 2, 3, 4, 5])).toBe(1);
    expect(escalationShape([5, 1, 1, 1])).toBe(0);
    expect(escalationShape([0, 0, 0, 0])).toBe(0);
    // up, down, up to the same height: the dip costs some pairs
    const s = escalationShape([0, 2, 1, 4]);
    expect(s).toBeGreaterThan(0.6);
    expect(s).toBeLessThan(1);
  });

  it("counts a rise after a lull as a reversal, and a smooth climb as none", () => {
    expect(risingTurns([0, 4, 5, 1, 0, 4, 6])).toBe(1);
    expect(risingTurns([0, 1, 2, 3, 4, 5, 6])).toBe(0);
    expect(risingTurns([0, 5, 0, 5, 0, 5])).toBe(2);
    expect(risingTurns([])).toBe(0);
    expect(risingTurns([2, 2, 2])).toBe(0);
  });

  it("counts a swap when the target of a hostile act hits back, and not a repeat by the same actor", () => {
    const hit = (tS: number, actor: string, target: string) => ({ tS, verb: "insult", actor, target });
    expect(initiativeSwaps(load({ durationS: 100, acts: [hit(10, "p1", "p2"), hit(20, "p2", "p1")] }))).toBe(1);
    expect(initiativeSwaps(load({ durationS: 100, acts: [hit(10, "p1", "p2"), hit(20, "p1", "p2")] }))).toBe(0);
    expect(initiativeSwaps(load({ durationS: 100, acts: [hit(10, "p1", "p2"), hit(20, "p2", "p1"), hit(30, "p1", "p2")] }))).toBe(2);
  });

  it("weights a line by the move it makes and an act by its rung", () => {
    const b = load({ durationS: 100, lines: [{ tS: 5, ref: "p1", text: "You lied to us all, Bruno." }, { tS: 9, ref: "p2", text: "Nice weather." }], acts: [{ tS: 20, verb: "punch", actor: "p1", target: "p2" }] });
    const beats = beatsOf(b);
    expect(beats.map((x) => [x.label, x.w])).toEqual([["accusation", 2.5], ["punch", 5]]);
    expect(tensionSeries(beats, 30)).toHaveLength(3);
  });
});

/** A heated exchange that ends in a punch at 2:20 (and, with `after`, five more lines to the end of the scene). Hostile words and the act give the corpus's reader a strong arc. */
const heated = (after: boolean): FxSpec => ({
  durationS: 300,
  lines: [
    { tS: 5, ref: "p1", text: "Good evening, how was the drive?" },
    { tS: 15, ref: "p2", text: "Long. Why did you ask me here?" },
    { tS: 30, ref: "p1", text: "You lied to me about the money." },
    { tS: 50, ref: "p2", text: "Careful, Ana. I will not hear that." },
    { tS: 70, ref: "p1", text: "Liar! Thief! I hate you!" },
    { tS: 90, ref: "p2", text: "Shut up! Get out of my house, you idiot!" },
    { tS: 110, ref: "p1", text: "I will kill you, you bastard!" },
    { tS: 130, ref: "p2", text: "Do it then, coward!" },
    ...(after
      ? [
          { tS: 155, ref: "p1", text: "Why did you do that to me?" },
          { tS: 175, ref: "p2", text: "I do not know. I am sorry." },
          { tS: 200, ref: "p1", text: "Get out." },
          { tS: 230, ref: "p2", text: "Fine." },
          { tS: 260, ref: "p1", text: "Close the door." },
        ]
      : []),
  ],
  acts: [{ tS: 140, verb: "punch", actor: "p1", target: "p2" }],
});

describe("arc: the group", () => {
  it("scores a built scene far above a flat one, and explains the weak parts", () => {
    const good = scoreArc(load(goodScene()), norms);
    const flat = scoreArc(load(flatScene()), norms);
    expect(good.score!).toBeGreaterThan(85);
    expect(flat.score!).toBeLessThan(30);
    // the corpus's reader finds no strong arc in a flat scene: its position readings are left out, not scored 0
    expect(reading(flat, "incitingPos")).toMatchObject({ value: null, score: null });
    expect(reading(flat, "timeToClimaxS").score).toBe(0);
    expect(good.detail["corpus"]).toMatchObject({ strongArc: true });
    expect(reading(good, "timeToClimaxS")).toMatchObject({ value: 180, score: 100 });
    expect(good.detail["incitingKind"]).toBe("accusation");
  });

  it("reads the aftermath off the corpus's reader: an abrupt end after the peak leaves almost none", () => {
    const abrupt = scoreArc(load(heated(false)), norms);
    expect(abrupt.detail["corpus"]).toMatchObject({ strongArc: true });
    expect(reading(abrupt, "aftermathShare").value!).toBeLessThan(0.05);
    expect(reading(abrupt, "aftermathShare").score!).toBeLessThan(10);
    const after = scoreArc(load(heated(true)), norms);
    // 0.47 of the scene follows the peak: inside the prior band's reach and inside the corpus band (0.10-0.59)
    expect(reading(after, "aftermathShare").value!).toBeGreaterThan(0.4);
    expect(reading(after, "incitingPos").score).toBe(100);
  });

  it("reads stakes as a rise of the peak over the opening plus memory intensity and tone", () => {
    const low = load({ durationS: 300, acts: [{ tS: 100, verb: "glare", actor: "p1", target: "p2" }] });
    const high = load({
      durationS: 300,
      acts: [{ tS: 250, verb: "punch", actor: "p1", target: "p2" }],
      memories: [{ tS: 10, intensity: 0.2, tone: "calm" }, { tS: 20, intensity: 0.2, tone: "calm" }, { tS: 280, intensity: 0.9, tone: "rage" }, { tS: 290, intensity: 0.9, tone: "rage" }],
    });
    expect(reading(scoreArc(high, norms), "stakesChange").value!).toBeGreaterThan(0.9);
    expect(reading(scoreArc(low, norms), "stakesChange").value!).toBeLessThan(0.3);
  });
});
