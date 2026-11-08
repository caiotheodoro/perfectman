import { describe, it, expect } from "vitest";
import type { ActStartedEvent } from "../drama/index.js";
import { actRate, bodyActRate, verbDiversity } from "../probes/drama.js";
import { PROBE_BANDS } from "../probes/types.js";
import { bodyAct, input, started, ROOM } from "./drama-probe-fixtures.js";

describe("bands", () => {
  it("seeds the drama probes in PROBE_BANDS", () => {
    expect(PROBE_BANDS["act-rate"]).toEqual([0, 3]);
    expect(PROBE_BANDS["reaction-latency-p90-target"]).toEqual([0, 1500]);
    expect(PROBE_BANDS["reaction-latency-p90-witness"]).toEqual([0, 3000]);
    expect(PROBE_BANDS["witness-coverage"]).toEqual([0.8, 1]);
    expect(PROBE_BANDS["ladder-compliance"]).toEqual([1, 1]);
    expect(PROBE_BANDS["dead-speech"]).toEqual([0, 0]);
    expect(PROBE_BANDS["consent-violation"]).toEqual([0, 0]);
    // informational: nothing can fail them
    expect(PROBE_BANDS["body-act-rate"]![0]).toBe(0);
    expect(PROBE_BANDS["body-act-rate"]![1]).toBeGreaterThan(1e6);
    expect(PROBE_BANDS["verb-diversity"]).toEqual([0, 1]);
  });
});

describe("body-act-rate", () => {
  it("counts gestures, expressions, pairs and appearance changes per actor-minute", () => {
    const events = [
      bodyAct("a", 1000, "gesture", "wave"),
      bodyAct("a", 2000, "expression", "smile"),
      bodyAct("b", 3000, "pair", "kiss"),
      bodyAct("c", 4000, "appearance", "sparkle"),
      bodyAct("d", 5000, "gesture", "laugh"),
      bodyAct("d", 6000, "gesture", "wave"),
      bodyAct("d", 7000, "gesture", "thumbs"),
      bodyAct("d", 8000, "gesture", "blow"),
    ];
    // 8 acts / (4 actors x 2 minutes)
    expect(bodyActRate(input(events, { durationMs: 120_000 }))).toMatchObject({ measured: 1, bodyActs: 8, actorMinutes: 8 });
  });

  it("does not count a pair's reaction, standing still, humans, or actors outside the list", () => {
    const events = [
      bodyAct("a", 1000, "pair_reaction", "kiss"),
      bodyAct("a", 2000, "gesture", "stand"),
      bodyAct("a", 3000, "gesture", "idle"),
      bodyAct("a", 4000, "gesture", "stop"),
      bodyAct("h:9", 5000, "gesture", "wave"),
      bodyAct("stranger", 6000, "gesture", "wave"),
      bodyAct("b", 7000, "gesture", "wave"),
    ];
    expect(bodyActRate(input(events, { durationMs: 60_000 }))).toMatchObject({ bodyActs: 1, measured: 0.25 });
  });

  it("reads the minutes off the events' span when no duration is given", () => {
    const events = [bodyAct("a", 0), bodyAct("a", 60_000), bodyAct("b", 120_000)];
    expect(bodyActRate(input(events, { actorIds: ["a", "b"] })).measured).toBe(3 / (2 * 2));
  });

  it("is zero for no events, no actors, or no time", () => {
    expect(bodyActRate(input([])).measured).toBe(0);
    expect(bodyActRate(input([bodyAct("a", 1000)], { actorIds: [], durationMs: 60_000 })).measured).toBe(0);
    expect(bodyActRate(input([bodyAct("a", 1000)])).measured).toBe(0); // a single instant has no span
  });
});

describe("act-rate (D6 spam guard)", () => {
  const burst = (n: number, spacingMs: number, room = ROOM): ActStartedEvent[] =>
    Array.from({ length: n }, (_, i) => started(`${room}-${i}`, i * spacingMs, "a", "glare", { room }));

  it("passes exactly at the ceiling of 3 per scene-minute", () => {
    const r = actRate(input(burst(3, 20_000), { durationMs: 60_000 }));
    expect(r.measured).toBe(3);
    expect(r.measured).toBeLessThanOrEqual(PROBE_BANDS["act-rate"]![1]);
  });

  it("goes over the ceiling when acts bunch up, never extrapolating a scene shorter than a minute", () => {
    const r = actRate(input(burst(4, 2_000)));
    expect(r.measured).toBe(4); // 4 acts in a 6 s scene count as a minute, not as 40 per minute
    expect(r.measured).toBeGreaterThan(PROBE_BANDS["act-rate"]![1]);
  });

  it("is judged on the busiest scene, so a spammed room is not diluted by a quiet one", () => {
    const events = [...burst(5, 5_000, "17"), started("q1", 0, "b", "glare", { room: "18" })];
    const r = actRate(input(events, { durationMs: 120_000 }));
    expect(r.perScene["17"]).toEqual({ acts: 5, minutes: 2, perMinute: 2.5 });
    expect(r.perScene["18"]).toEqual({ acts: 1, minutes: 2, perMinute: 0.5 });
    expect(r.measured).toBe(2.5);
    expect(r.worstScene).toBe("17");
  });

  it("uses each scene's own span when no duration is given", () => {
    const events = [...burst(2, 120_000), ...burst(1, 0, "18")];
    const r = actRate(input(events));
    expect(r.perScene["17"]!.minutes).toBe(2);
    expect(r.perScene["18"]!.minutes).toBe(1);
  });

  it("counts an act once however many times its start was logged", () => {
    const e = started("dup", 0, "a", "glare");
    expect(actRate(input([e, e, e], { durationMs: 60_000 })).measured).toBe(1);
  });

  it("is zero with no acts", () => {
    expect(actRate(input([bodyAct("a", 0)])).measured).toBe(0);
    expect(actRate(input([])).perScene).toEqual({});
  });
});

describe("verb-diversity", () => {
  const acts = (verbs: string[]): ActStartedEvent[] => verbs.map((v, i) => started(`a${i}`, i * 1000, "a", v));

  it("is distinct verbs over acts once there are 5 acts", () => {
    expect(verbDiversity(input(acts(["glare", "insult", "shove", "slap", "punch"])))).toMatchObject({ measured: 1, judged: true, acts: 5, distinct: 5 });
    expect(verbDiversity(input(acts(["slap", "slap", "slap", "shove", "shove", "shove"])))).toMatchObject({ measured: 2 / 6, judged: true });
  });

  it("is not judged below 5 acts and reads 1 then", () => {
    expect(verbDiversity(input(acts(["slap", "slap", "slap", "slap"])))).toMatchObject({ measured: 1, judged: false, acts: 4 });
    expect(verbDiversity(input([]))).toMatchObject({ measured: 1, judged: false, acts: 0 });
  });

  it("counts a duplicated act_started once", () => {
    const e = acts(["slap"])[0]!;
    expect(verbDiversity(input([e, e, e, e, e])).acts).toBe(1);
  });
});
