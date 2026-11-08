import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { LADDER_RUNGS, type ActStartedEvent, type DramaEvent } from "../drama/index.js";
import { ladderCompliance } from "../probes/drama.js";
import { input, started } from "./drama-probe-fixtures.js";

describe("ladder-compliance (D3, D6)", () => {
  const seq = (...acts: Array<[string, number, string, Partial<ActStartedEvent>?]>): DramaEvent[] =>
    acts.map(([id, at, verb, extra]) => started(id, at, "a", verb, { with: "b", ...extra }));
  const S = 1000;

  it("is 1 for a conflict that climbs one rung at a time, with the budget spaced out", () => {
    const events = seq(["g", 0, "glare"], ["i", 5 * S, "insult"], ["sh", 10 * S, "shove"], ["sl", 30 * S, "slap"], ["p", 50 * S, "punch"], ["k", 70 * S, "kill"]);
    expect(ladderCompliance(input(events))).toMatchObject({ measured: 1, judged: 6, compliant: 6, offendingActIds: [] });
  });

  it("flags an act that jumps two or more rungs over the scene's highest (D3)", () => {
    const events = seq(["g", 0, "glare"], ["sl", 5 * S, "slap"], ["i", 10 * S, "insult"]);
    const r = ladderCompliance(input(events));
    expect(r.offendingActIds).toEqual(["sl"]);
    expect(r.offenders).toEqual([{ actId: "sl", reasons: ["rung_skip"] }]);
    expect(r.measured).toBeCloseTo(2 / 3, 10);
  });

  it("lets a scene open on glare or insult but not on a physical act", () => {
    expect(ladderCompliance(input(seq(["i", 0, "insult"]))).measured).toBe(1);
    expect(ladderCompliance(input(seq(["sh", 0, "shove"]))).offendingActIds).toEqual(["sh"]);
  });

  it("lets an authored skip jump, and measures the next act from the new height", () => {
    const events = seq(["g", 0, "glare"], ["p", 5 * S, "punch", { authoredSkip: true }], ["k", 30 * S, "kill"], ["sl", 60 * S, "slap"]);
    expect(ladderCompliance(input(events))).toMatchObject({ measured: 1, offendingActIds: [] });
    // an unauthored jump counts as seen too, so one jump is not charged again on the next rung up
    const unauthored = seq(["g", 0, "glare"], ["p", 5 * S, "punch"], ["k", 30 * S, "kill"]);
    expect(ladderCompliance(input(unauthored)).offendingActIds).toEqual(["p"]);
  });

  it("charges the scene's highest rung to everyone in it, not to a pair", () => {
    const events = [
      started("x1", 0, "a", "glare", { with: "b" }),
      started("x2", 5 * S, "a", "insult", { with: "b" }),
      started("x3", 10 * S, "a", "shove", { with: "b" }),
      started("y1", 30 * S, "c", "slap", { with: "d" }), // a different pair, +1 on the scene's highest
      started("y2", 60 * S, "c", "kill", { with: "d" }), // +2 on the scene's highest
    ];
    expect(ladderCompliance(input(events)).offendingActIds).toEqual(["y2"]);
  });

  it("keeps a separate ladder per scene", () => {
    const events = [
      started("r1", 0, "a", "glare", { room: "17" }),
      started("r2", 5 * S, "a", "insult", { room: "17" }),
      started("q1", 10 * S, "c", "slap", { room: "18" }), // room 18 is still calm
    ];
    expect(ladderCompliance(input(events)).offendingActIds).toEqual(["q1"]);
  });

  it("allows one physical beat per 20 s per scene: 20 s apart passes, 19.999 s fails (D6)", () => {
    const ok = seq(["g", 0, "glare"], ["i", 1 * S, "insult"], ["sh", 2 * S, "shove"], ["sl", 22 * S, "slap"]);
    expect(ladderCompliance(input(ok)).measured).toBe(1);
    const tight = seq(["g", 0, "glare"], ["i", 1 * S, "insult"], ["sh", 2 * S, "shove"], ["sl", 21_999, "slap"]);
    expect(ladderCompliance(input(tight)).offenders).toEqual([{ actId: "sl", reasons: ["beat_budget"] }]);
  });

  it("allows at most one kill per scene, however far apart (D6)", () => {
    const events = seq(["g", 0, "glare"], ["i", S, "insult"], ["sh", 2 * S, "shove"], ["sl", 30 * S, "slap"], ["p", 60 * S, "punch"], ["k1", 90 * S, "kill"], ["k2", 150 * S, "kill"]);
    expect(ladderCompliance(input(events)).offenders).toEqual([{ actId: "k2", reasons: ["kill_budget"] }]);
  });

  it("does not excuse a budget breach with an authored skip", () => {
    const events = seq(["g", 0, "glare"], ["sh", 2 * S, "shove", { authoredSkip: true }], ["p", 5 * S, "punch", { authoredSkip: true }]);
    expect(ladderCompliance(input(events)).offenders).toEqual([{ actId: "p", reasons: ["beat_budget"] }]);
  });

  it("names every reason an act breaks, in rung, beat, kill order", () => {
    const both = seq(["g", 0, "glare"], ["i", S, "insult"], ["sh", 2 * S, "shove"], ["k", 5 * S, "kill"]);
    expect(ladderCompliance(input(both)).offenders).toEqual([{ actId: "k", reasons: ["rung_skip", "beat_budget"] }]);
  });

  it("does not judge verbs that are not on the ladder, and reads 1 with nothing to judge", () => {
    expect(ladderCompliance(input(seq(["h", 0, "hug"], ["w", S, "wave"])))).toMatchObject({ measured: 1, judged: 0 });
    expect(ladderCompliance(input([]))).toMatchObject({ measured: 1, judged: 0, offendingActIds: [] });
  });

  it("reads acts in time order whatever order they were logged in", () => {
    const events = seq(["i", 5 * S, "insult"], ["g", 0, "glare"]);
    expect(ladderCompliance(input(events)).measured).toBe(1);
  });

  it("maps what it found to D3 (a skipped rung) and D6 (the budget)", () => {
    const skip = ladderCompliance(input(seq(["sl", 0, "slap"])));
    expect(skip.codes).toEqual(["D3"]);
    const budget = ladderCompliance(input(seq(["g", 0, "glare"], ["i", S, "insult"], ["sh", 2 * S, "shove"], ["sl", 3 * S, "slap"])));
    expect(budget.codes).toEqual(["D6"]);
    expect(ladderCompliance(input([])).codes).toEqual([]);
  });

  describe("properties", () => {
    // climbs by 0 or 1 from glare or insult and stops at the first kill; the acts sit 20 s apart or more
    const climb = fc
      .record({ start: fc.constantFrom(0, 1), steps: fc.array(fc.constantFrom(0, 1), { maxLength: 12 }) })
      .map(({ start, steps }) => {
        const rungs: number[] = [start];
        for (const step of steps) rungs.push(Math.min(rungs[rungs.length - 1]! + step, 5));
        const firstKill = rungs.indexOf(5);
        return firstKill === -1 ? rungs : rungs.slice(0, firstKill + 1);
      })
      .chain((rungs) => fc.array(fc.integer({ min: 20_000, max: 90_000 }), { minLength: rungs.length, maxLength: rungs.length }).map((gaps) => ({ rungs, gaps })));

    const build = (rungs: number[], gaps: number[], skipAt?: number): DramaEvent[] => {
      let at = 0;
      return rungs.map((r, i) => {
        at += gaps[i]!;
        return started(`p${i}`, at, "a", LADDER_RUNGS[r]!, { with: "b", ...(skipAt === i ? { authoredSkip: true } : {}) });
      });
    };

    it("is 1.0 for any sequence that climbs one rung at a time within the budget", () => {
      fc.assert(
        fc.property(climb, ({ rungs, gaps }) => {
          const r = ladderCompliance(input(build(rungs, gaps)));
          expect(r.measured).toBe(1);
          expect(r.offendingActIds).toEqual([]);
        }),
        { numRuns: 300 },
      );
    });

    it("names the act that jumps two rungs, and forgives it with an authored skip", () => {
      const jump = fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 20_000, max: 90_000 })).map(([top, gap]) => ({ top, gap }));
      fc.assert(
        fc.property(jump, ({ top, gap }) => {
          const rungs = [...Array.from({ length: top + 1 }, (_, i) => i), top + 2];
          const gaps = [...rungs.map(() => 30_000)];
          gaps[gaps.length - 1] = gap;
          const last = rungs.length - 1;
          expect(ladderCompliance(input(build(rungs, gaps))).offendingActIds).toEqual([`p${last}`]);
          expect(ladderCompliance(input(build(rungs, gaps, last))).offendingActIds).toEqual([]);
        }),
        { numRuns: 100 },
      );
    });
  });
});
