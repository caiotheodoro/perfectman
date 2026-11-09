import { describe, it, expect } from "vitest";
import type { DramaEvent } from "../drama/index.js";
import { UNREACTED_MS, reactionLatencyP90, witnessCoverage } from "../probes/drama.js";
import type { PositionLookup } from "../probes/embodiment.js";
import { PROBE_BANDS } from "../probes/types.js";
import { death, done, input, plan, reaction, started } from "./drama-probe-fixtures.js";

describe("reaction-latency-p90 (D1)", () => {
  /** n acts by "a" on "b", the target reacting after each latency in turn. */
  const targeted = (latencies: Array<number | undefined>): DramaEvent[] =>
    latencies.flatMap((ms, i) => [started(`t${i}`, i * 10_000, "a", "slap", { with: "b" }), ...(ms === undefined ? [] : [reaction(`t${i}`, i * 10_000 + ms, "b", "target")])]);

  it("reads the 90th percentile (nearest rank) of target latencies, passing exactly at 1500 ms", () => {
    const events = targeted([100, 200, 300, 400, 500, 600, 700, 800, 1500, 9000]);
    const r = reactionLatencyP90(input(events));
    expect(r.target).toMatchObject({ p90: 1500, samples: 10, unreactedActIds: [] });
    expect(r.target.p90).toBeLessThanOrEqual(PROBE_BANDS["reaction-latency-p90-target"]![1]);
  });

  it("fails when more than one act in ten is slow", () => {
    const r = reactionLatencyP90(input(targeted([100, 100, 100, 100, 100, 100, 100, 100, 1501, 1501])));
    expect(r.target.p90).toBe(1501);
    expect(r.target.p90).toBeGreaterThan(PROBE_BANDS["reaction-latency-p90-target"]![1]);
  });

  it("counts a target that never reacted as the worst latency and names the act (D1)", () => {
    const r = reactionLatencyP90(input(targeted([100, undefined])));
    expect(r.target.unreactedActIds).toEqual(["t1"]);
    expect(r.target.p90).toBe(UNREACTED_MS);
    expect(r.target.p90).toBeGreaterThan(PROBE_BANDS["reaction-latency-p90-target"]![1]);
  });

  it("takes each target's first reaction, and ignores one that came before the act or belongs to nobody's act", () => {
    const events = [
      started("x", 5_000, "a", "slap", { with: "b" }),
      reaction("x", 4_000, "b", "target"),
      reaction("x", 6_200, "b", "target"),
      reaction("x", 6_900, "b", "target"),
      reaction("ghost", 6_000, "b", "target"),
    ];
    const r = reactionLatencyP90(input(events));
    expect(r.target).toMatchObject({ p90: 1200, samples: 1 });
  });

  it("does not judge acts with no target, a human target, or a target already dead", () => {
    const events = [
      started("n", 0, "a", "glare"),
      started("h", 1_000, "a", "slap", { with: "h:9" }),
      death("b", 1_500),
      started("d", 2_000, "a", "slap", { with: "b" }),
    ];
    const r = reactionLatencyP90(input(events));
    expect(r.target).toMatchObject({ p90: 0, samples: 0, unreactedActIds: [] });
  });

  it("reads witnesses' latencies separately, from witnesses that reacted, excluding the actor and the target", () => {
    const events = [
      started("w", 0, "a", "slap", { with: "b" }),
      reaction("w", 500, "b", "target"),
      reaction("w", 1_000, "c"),
      reaction("w", 2_000, "d"),
      reaction("w", 2_500, "a"), // the actor reacting to their own act is not a witness
    ];
    const r = reactionLatencyP90(input(events));
    expect(r.witness).toMatchObject({ p90: 2_000, samples: 2 });
    expect(r.witness.p90).toBeLessThanOrEqual(PROBE_BANDS["reaction-latency-p90-witness"]![1]);
    expect(r.target.p90).toBe(500);
  });

  it("lists acts that drew no reaction at all as D1 cases, but only when they had a target", () => {
    const events = [
      started("silent", 0, "a", "slap", { with: "b" }),
      started("targetless", 1_000, "a", "glare"),
      started("seen", 2_000, "a", "slap", { with: "b" }),
      reaction("seen", 2_300, "c"),
    ];
    expect(reactionLatencyP90(input(events)).d1ActIds).toEqual(["silent"]);
  });

  it("is zero with nothing to judge", () => {
    expect(reactionLatencyP90(input([]))).toMatchObject({ target: { p90: 0, samples: 0 }, witness: { p90: 0, samples: 0 }, d1ActIds: [] });
  });
});

describe("witness-coverage (D1)", () => {
  // a acts on b; c is close, d is far.
  const tiles: Record<string, [number, number]> = { a: [0, 0], b: [1, 0], c: [3, 3], d: [20, 20] };
  const cov = (events: DramaEvent[], positionOf: PositionLookup | null = plan(tiles)) => witnessCoverage({ ...input(events), ...(positionOf !== null ? { positionOf } : {}) });
  const slap = started("s1", 1_000, "a", "slap", { with: "b" });

  it("is 1 when every actor within earshot reacted", () => {
    expect(cov([slap, reaction("s1", 1_800, "c")])).toMatchObject({ measured: 1, judged: 1, covered: 1, uncovered: [] });
  });

  it("is 0 when someone within earshot stayed blank, naming the act and who", () => {
    expect(cov([slap])).toMatchObject({ measured: 0, judged: 1, uncovered: [{ actId: "s1", missing: ["c"] }] });
  });

  it("asks nothing of the actor, the target, or someone out of earshot", () => {
    expect(cov([slap]).uncovered[0]!.missing).toEqual(["c"]);
    expect(cov([slap, reaction("s1", 1_500, "c")]).measured).toBe(1); // d never needed to react
  });

  it("puts the earshot edge at the say radius: 6 tiles is in, 7 is out", () => {
    const at6 = plan({ ...tiles, c: [6, 0] });
    const at7 = plan({ ...tiles, c: [7, 0] });
    expect(cov([slap], at6).uncovered[0]!.missing).toEqual(["c"]);
    expect(cov([slap], at7)).toMatchObject({ judged: 0, unjudgedActIds: ["s1"] });
  });

  it("leaves an act with no one in earshot out of the fraction, and reads 1 when nothing was judged", () => {
    const alone = plan({ a: [0, 0], b: [1, 0], c: [20, 20], d: [20, 21] });
    expect(cov([slap], alone)).toMatchObject({ measured: 1, judged: 0, unjudgedActIds: ["s1"] });
    expect(cov([])).toMatchObject({ measured: 1, judged: 0 });
  });

  it("does not ask a dead actor to react, whether it died by an event or a landed kill", () => {
    const byEvent = [death("c", 500), slap];
    expect(cov(byEvent)).toMatchObject({ judged: 0 });
    const byKill = [started("k", 100, "d", "kill", { with: "c" }), done("k", 400, "landed"), slap];
    expect(cov(byKill)).toMatchObject({ judged: 0 });
    // died after the act: still a witness of it
    expect(cov([slap, death("c", 2_000)]).uncovered[0]!.missing).toEqual(["c"]);
    // a kill that did not land kills nobody
    const missed = [started("k", 100, "d", "kill", { with: "c" }), done("k", 400, "dodged"), slap];
    expect(cov(missed).uncovered[0]!.missing).toEqual(["c"]);
  });

  it("asks humans for nothing: only actors in the list owe a reaction", () => {
    const withHuman = plan({ ...tiles, "h:9": [2, 2] });
    expect(cov([slap, reaction("s1", 1_600, "c")], withHuman).measured).toBe(1);
  });

  it("does not count a reaction logged before the act started", () => {
    expect(cov([reaction("s1", 900, "c"), slap]).measured).toBe(0);
  });

  it("asks where everyone stood at the act's instant", () => {
    const moving = plan(tiles, { fromMs: 5_000, tiles: { c: [20, 20] } });
    const early = started("e", 1_000, "a", "slap", { with: "b" });
    const late = started("l", 6_000, "a", "slap", { with: "b" });
    expect(cov([early, late], moving)).toMatchObject({ judged: 1, uncovered: [{ actId: "e", missing: ["c"] }], unjudgedActIds: ["l"] });
  });

  it("leaves an act out when the actor's own position is unknown, and an actor with no known position unasked", () => {
    expect(cov([slap], plan({ b: [1, 0], c: [3, 3] }))).toMatchObject({ judged: 0, unjudgedActIds: ["s1"] });
    expect(cov([slap], plan({ a: [0, 0], b: [1, 0] }))).toMatchObject({ judged: 0 });
  });

  it("passes exactly at the 0.8 band and fails below it", () => {
    const acts = (nBlank: number): DramaEvent[] =>
      Array.from({ length: 5 }, (_, i) => i).flatMap((i) => [started(`z${i}`, i * 5_000, "a", "slap", { with: "b" }), ...(i < 5 - nBlank ? [reaction(`z${i}`, i * 5_000 + 400, "c")] : [])]);
    const atBand = cov(acts(1));
    expect(atBand.measured).toBeCloseTo(0.8, 10);
    expect(atBand.measured).toBeGreaterThanOrEqual(PROBE_BANDS["witness-coverage"]![0]);
    expect(cov(acts(2)).measured).toBeLessThan(PROBE_BANDS["witness-coverage"]![0]);
  });

  it("says so when it was given no positions, instead of reading a clean 1", () => {
    expect(cov([slap], null)).toMatchObject({ measured: 1, judged: 0, skipped: "no positions" });
  });
});
