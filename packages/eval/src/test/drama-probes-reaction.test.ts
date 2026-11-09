import { describe, it, expect } from "vitest";
import type { DramaEvent, OwedRole } from "../drama/index.js";
import { UNREACTED_MS, reactionLatencyP90, witnessCoverage } from "../probes/drama.js";
import { PROBE_BANDS } from "../probes/types.js";
import { beat, death, done, input, reaction, started } from "./drama-probe-fixtures.js";

/**
 * Reaction deadlines run from the contact (`act_beat`), and what is owed is `act_beat.owed` alone (act contract
 * section 4, REA-1, REA-2 and 12): an act with no beat is not judged, and a debt that is not listed is not owed.
 */
describe("reaction-latency-p90 (D1)", () => {
  /** n acts by "a" on "b", each started 300 ms before its contact, the target reacting after each latency in turn. */
  const targeted = (latencies: Array<number | undefined>): DramaEvent[] =>
    latencies.flatMap((ms, i) => {
      const t0 = i * 10_000;
      return [started(`t${i}`, t0, "a", "slap", { with: "b" }), beat(`t${i}`, t0 + 300, [["b", "target"]]), ...(ms === undefined ? [] : [reaction(`t${i}`, t0 + 300 + ms, "b", "target")])];
    });

  it("reads the 90th percentile (nearest rank) of target latencies from contact, passing exactly at 1500 ms", () => {
    const r = reactionLatencyP90(input(targeted([100, 200, 300, 400, 500, 600, 700, 800, 1500, 9000])));
    expect(r.target).toMatchObject({ p90: 1500, samples: 10, unreactedActIds: [] });
    expect(r.target.p90).toBeLessThanOrEqual(PROBE_BANDS["reaction-latency-p90-target"]![1]);
  });

  it("fails when more than one act in ten is slow", () => {
    const r = reactionLatencyP90(input(targeted([100, 100, 100, 100, 100, 100, 100, 100, 1501, 1501])));
    expect(r.target.p90).toBe(1501);
    expect(r.target.p90).toBeGreaterThan(PROBE_BANDS["reaction-latency-p90-target"]![1]);
  });

  it("does not charge the wind-up or the chip wait to the reaction: the clock starts at the beat", () => {
    const events = [started("c", 0, "a", "slap", { with: "b", chip: true }), beat("c", 3_900, [["b", "target"]]), reaction("c", 4_400, "b", "target")];
    expect(reactionLatencyP90(input(events)).target.p90).toBe(500);
  });

  it("counts a target that never reacted as the worst latency and names the act (D1)", () => {
    const r = reactionLatencyP90(input(targeted([100, undefined])));
    expect(r.target.unreactedActIds).toEqual(["t1"]);
    expect(r.target.p90).toBe(UNREACTED_MS);
    expect(r.target.p90).toBeGreaterThan(PROBE_BANDS["reaction-latency-p90-target"]![1]);
    expect(r.codes).toEqual(["D1"]);
  });

  it("takes each owed target's first reaction at or after contact, and ignores one before it or belonging to nobody's act", () => {
    const events = [
      started("x", 5_000, "a", "slap", { with: "b" }),
      beat("x", 5_300, [["b", "target"]]),
      reaction("x", 5_100, "b", "target"),
      reaction("x", 6_200, "b", "target"),
      reaction("x", 6_900, "b", "target"),
      reaction("ghost", 6_000, "b", "target"),
    ];
    const r = reactionLatencyP90(input(events));
    expect(r.target).toMatchObject({ p90: 900, samples: 1 });
    expect(r.beforeContact).toEqual([{ actId: "x", who: "b" }]);
  });

  it("reports a target whose only reaction came before the contact as unreacted (REA-7)", () => {
    const events = [started("x", 5_000, "a", "slap", { with: "b" }), beat("x", 5_300, [["b", "target"]]), reaction("x", 5_100, "b", "target")];
    expect(reactionLatencyP90(input(events)).target).toMatchObject({ p90: UNREACTED_MS, unreactedActIds: ["x"] });
  });

  it("judges only acts that have a contact beat: aborted, blocked and beat-less acts are not judged", () => {
    const events = [
      started("aborted", 0, "a", "slap", { with: "b" }),
      done("aborted", 800, "aborted", { reason: "calm_room" }),
      done("blocked", 900, "blocked", { reason: "cooldown", verb: "slap", actor: "a", with: "b" }),
      started("noBeat", 2_000, "a", "slap", { with: "b" }),
    ];
    expect(reactionLatencyP90(input(events))).toMatchObject({ judged: 0, target: { p90: 0, samples: 0, unreactedActIds: [] }, d1ActIds: [] });
  });

  it("owes nothing it was not told: a human target, a solo verb, and a witness the hotel did not list are never asked", () => {
    const events = [
      started("h", 0, "a", "slap", { with: "h:9" }),
      beat("h", 300, [["c", "witness"]], { witnesses: ["c", "h:9", "h:11"] }),
      reaction("h", 900, "c"),
      started("solo", 10_000, "a", "cry"),
      beat("solo", 10_000, []),
      started("silent", 20_000, "a", "slap", { with: "b" }),
      beat("silent", 20_300, [["b", "target"]]),
      reaction("silent", 20_800, "b", "target"),
    ];
    const r = reactionLatencyP90(input(events));
    expect(r.target).toMatchObject({ p90: 500, samples: 1, unreactedActIds: [] });
    expect(r.witness).toMatchObject({ p90: 600, samples: 1 });
    expect(r.d1ActIds).toEqual([]);
  });

  it("drops a target that died before its deadline: the hotel dropped it from its ledger too (REA-10)", () => {
    const events = [started("d", 0, "a", "kill", { with: "b" }), beat("d", 500, [["b", "target"]]), death("b", 675)];
    expect(reactionLatencyP90(input(events)).target).toMatchObject({ samples: 0, unreactedActIds: [] });
  });

  it("reads witnesses' latencies separately, only from owed witnesses that reacted, not the actor or an unlisted bystander", () => {
    const owed: Array<[string, OwedRole]> = [["b", "target"], ["c", "witness"], ["d", "witness"]];
    const events = [
      started("w", 0, "a", "slap", { with: "b" }),
      beat("w", 300, owed),
      reaction("w", 800, "b", "target"),
      reaction("w", 1_300, "c"),
      reaction("w", 2_300, "d"),
      reaction("w", 2_800, "a"), // the actor reacting to their own act owes and counts for nothing
      reaction("w", 2_900, "e"), // nobody listed e
    ];
    const r = reactionLatencyP90(input(events));
    expect(r.witness).toMatchObject({ p90: 2_000, samples: 2 });
    expect(r.witness.p90).toBeLessThanOrEqual(PROBE_BANDS["reaction-latency-p90-witness"]![1]);
    expect(r.target.p90).toBe(500);
  });

  it("counts a planner reaction like a table one", () => {
    const events = [started("p", 0, "a", "slap", { with: "b" }), beat("p", 300, [["b", "target"]]), reaction("p", 700, "b", "target", { source: "planner", reaction: "cmd:face" })];
    expect(reactionLatencyP90(input(events)).target).toMatchObject({ p90: 400, samples: 1 });
  });

  it("lists contacts that owed someone and drew a reaction from nobody as D1 cases, never one that owed nothing", () => {
    const events = [
      started("silent", 0, "a", "slap", { with: "b" }),
      beat("silent", 300, [["b", "target"], ["c", "witness"]]),
      started("owesNothing", 1_000, "a", "glare", { with: "h:9" }),
      beat("owesNothing", 1_000, []),
      started("seen", 2_000, "a", "slap", { with: "b" }),
      beat("seen", 2_300, [["b", "target"], ["c", "witness"]]),
      reaction("seen", 2_900, "c"),
    ];
    expect(reactionLatencyP90(input(events)).d1ActIds).toEqual(["silent"]);
  });

  it("is zero with nothing to judge", () => {
    expect(reactionLatencyP90(input([]))).toMatchObject({ target: { p90: 0, samples: 0 }, witness: { p90: 0, samples: 0 }, d1ActIds: [], judged: 0, clock: "none" });
  });
});

describe("reaction-latency-p90: which clock", () => {
  const stamped = (hotelAt: number) => ({ hotelAt });
  const pair = (beatAt: number, reactAt: number, hotel?: { beat: number; react: number }): DramaEvent[] => [
    started("c", 0, "a", "slap", { with: "b" }),
    beat("c", beatAt, [["b", "target"]], hotel ? stamped(hotel.beat) : {}),
    reaction("c", reactAt, "b", "target", hotel ? stamped(hotel.react) : {}),
  ];

  it("measures on the hotel's own `at` when both frames carry one, however late the log stamped them", () => {
    const r = reactionLatencyP90(input(pair(1_000, 4_000, { beat: 1_730_000_124_010, react: 1_730_000_124_790 })));
    expect(r.target.p90).toBe(780);
    expect(r.clock).toBe("hotel_at");
  });

  it("falls back to the frame log's stamp when a frame has no `at`", () => {
    const r = reactionLatencyP90(input(pair(1_000, 1_900)));
    expect(r.target.p90).toBe(900);
    expect(r.clock).toBe("ts_ms");
  });

  it("says mixed when some readings used one clock and some the other", () => {
    const events = [...pair(1_000, 1_500, { beat: 5_000, react: 5_400 }), started("d", 20_000, "a", "slap", { with: "b" }), beat("d", 20_300, [["b", "target"]]), reaction("d", 20_900, "b", "target")];
    expect(reactionLatencyP90(input(events)).clock).toBe("mixed");
  });
});

describe("witness-coverage (D1)", () => {
  const slap = (extra: Array<[string, OwedRole]> = [["c", "witness"]]): DramaEvent[] => [started("s1", 1_000, "a", "slap", { with: "b" }), beat("s1", 1_300, [["b", "target"], ...extra])];

  it("is 1 when every owed witness reacted", () => {
    expect(witnessCoverage(input([...slap(), reaction("s1", 2_100, "c")]))).toMatchObject({ measured: 1, judged: 1, covered: 1, uncovered: [] });
  });

  it("is 0 when an owed witness stayed blank, naming the act and who", () => {
    expect(witnessCoverage(input(slap()))).toMatchObject({ measured: 0, judged: 1, uncovered: [{ actId: "s1", missing: ["c"] }] });
  });

  it("asks only the witnesses the hotel listed: not the target, the actor, a human or an actor it left out", () => {
    const r = witnessCoverage(input([...slap([["c", "witness"], ["d", "witness"]]), reaction("s1", 1_900, "c")]));
    expect(r.uncovered).toEqual([{ actId: "s1", missing: ["d"] }]);
    expect(witnessCoverage(input([...slap([]), reaction("s1", 1_900, "c")]))).toMatchObject({ judged: 0, unjudgedActIds: ["s1"] });
  });

  it("counts a planner reaction as a reaction", () => {
    expect(witnessCoverage(input([...slap(), reaction("s1", 1_900, "c", "witness", { source: "planner", reaction: "cmd:face" })])).measured).toBe(1);
  });

  it("leaves an act that owed no witness out of the fraction, and reads 1 when nothing was judged", () => {
    expect(witnessCoverage(input(slap([])))).toMatchObject({ measured: 1, judged: 0, unjudgedActIds: ["s1"] });
    expect(witnessCoverage(input([]))).toMatchObject({ measured: 1, judged: 0 });
  });

  it("does not judge an act that never made contact: aborted, or a blocked act with no start", () => {
    const events = [started("a1", 0, "a", "slap", { with: "b" }), done("a1", 500, "aborted", { reason: "target_moved" }), done("b1", 600, "blocked", { reason: "ladder" })];
    expect(witnessCoverage(input(events))).toMatchObject({ judged: 0, unjudgedActIds: ["a1"] });
  });

  it("drops an owed witness that died before its deadline, but not one that died after it", () => {
    expect(witnessCoverage(input([...slap(), death("c", 1_800)]))).toMatchObject({ judged: 0 });
    expect(witnessCoverage(input([...slap(), death("c", 5_000)])).uncovered[0]!.missing).toEqual(["c"]);
    const byKill = [started("k", 100, "d", "kill", { with: "c" }), done("k", 400, "landed"), ...slap()];
    expect(witnessCoverage(input(byKill))).toMatchObject({ judged: 0 });
  });

  it("does not count a reaction logged before the contact", () => {
    expect(witnessCoverage(input([reaction("s1", 1_100, "c"), ...slap()])).measured).toBe(0);
  });

  it("passes exactly at the 0.8 band and fails below it", () => {
    const acts = (nBlank: number): DramaEvent[] =>
      Array.from({ length: 5 }, (_, i) => i).flatMap((i) => [
        started(`z${i}`, i * 5_000, "a", "slap", { with: "b" }),
        beat(`z${i}`, i * 5_000 + 300, [["c", "witness"]]),
        ...(i < 5 - nBlank ? [reaction(`z${i}`, i * 5_000 + 700, "c")] : []),
      ]);
    const atBand = witnessCoverage(input(acts(1)));
    expect(atBand.measured).toBeCloseTo(0.8, 10);
    expect(atBand.measured).toBeGreaterThanOrEqual(PROBE_BANDS["witness-coverage"]![0]);
    expect(witnessCoverage(input(acts(2))).measured).toBeLessThan(PROBE_BANDS["witness-coverage"]![0]);
  });
});
