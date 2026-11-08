import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import type { BodyFrame } from "@perfectman/shared";
import { LADDER_RUNGS, extractDramaEvents } from "../drama/index.js";
import { normalizeFrame } from "../hotel/index.js";
import type {
  ActDoneEvent,
  ActorDeathEvent,
  ActOutcome,
  ActReactionEvent,
  ActStartedEvent,
  BodyActEvent,
  ConsentChipAnsweredEvent,
  DramaEvent,
  SpeechEvent,
} from "../drama/index.js";
import { UNREACTED_MS, actRate, bodyActRate, consentViolation, deadSpeech, ladderCompliance, reactionLatencyP90, runDramaProbes, verbDiversity, witnessCoverage } from "../probes/drama.js";
import type { PositionLookup } from "../probes/embodiment.js";
import { PROBE_BANDS } from "../probes/types.js";

const ROOM = "17";
const ACTORS = ["a", "b", "c", "d"];

const started = (actId: string, atMs: number, actor: string, verb: string, extra: Partial<ActStartedEvent> = {}): ActStartedEvent => ({
  kind: "act_started",
  atMs,
  room: ROOM,
  actId,
  verb,
  actor,
  intensity: 0.5,
  ...extra,
});
const reaction = (actId: string, atMs: number, who: string, role: "target" | "witness" = "witness"): ActReactionEvent => ({
  kind: "act_reaction",
  atMs,
  room: ROOM,
  actId,
  who,
  role,
  reaction: "gasp",
});
const done = (actId: string, atMs: number, outcome: ActOutcome = "landed"): ActDoneEvent => ({ kind: "act_done", atMs, room: ROOM, actId, outcome });
const death = (actor: string, atMs: number): ActorDeathEvent => ({ kind: "actor_death", atMs, room: ROOM, actor });
const speech = (actor: string, atMs: number, text = "hi", mode = "say"): SpeechEvent => ({ kind: "speech", atMs, room: ROOM, actor, mode, text });
const bodyAct = (actor: string, atMs: number, act: BodyActEvent["act"] = "gesture", name = "wave"): BodyActEvent => ({ kind: "body_act", atMs, room: ROOM, actor, act, name });
const take = (actId: string, atMs: number, actor = "h:9", withRef = "a"): ConsentChipAnsweredEvent => ({
  kind: "consent_chip",
  phase: "answered",
  atMs,
  room: ROOM,
  pairId: actId,
  actId,
  actor,
  with: withRef,
  answer: "take",
});

const input = (events: DramaEvent[], extra: { durationMs?: number; actorIds?: string[] } = {}) => ({ events, actorIds: extra.actorIds ?? ACTORS, ...(extra.durationMs !== undefined ? { durationMs: extra.durationMs } : {}) });

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

/** A fixed floor plan: ref -> tile, all in the scene's room. `moves` swaps in other tiles from a given instant on. */
const plan = (tiles: Record<string, [number, number]>, moves: { fromMs: number; tiles: Record<string, [number, number]> } | undefined = undefined): PositionLookup =>
  (ref, atMs) => {
    const tile = (moves !== undefined && atMs >= moves.fromMs ? moves.tiles[ref] : undefined) ?? tiles[ref];
    return tile === undefined ? undefined : { room: ROOM, tile };
  };

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

describe("dead-speech (D4)", () => {
  it("counts speech by an actor after its death, naming who and when", () => {
    const events = [speech("b", 500), death("b", 1_000), speech("b", 2_000, "I am fine"), speech("c", 2_500), speech("b", 3_000, "hello?", "thought")];
    const r = deadSpeech(input(events));
    expect(r.measured).toBe(2);
    expect(r.offenders).toEqual([
      { actor: "b", atMs: 2_000, diedAtMs: 1_000, via: "death" },
      { actor: "b", atMs: 3_000, diedAtMs: 1_000, via: "death" },
    ]);
    expect(r.codes).toEqual(["D4"]);
  });

  it("is 0 for speech before the death and at the very instant of it", () => {
    expect(deadSpeech(input([speech("b", 999), death("b", 1_000), speech("b", 1_000)])).measured).toBe(0);
  });

  it("treats a landed kill as a death at its act_done, and a kill that did not land as nothing", () => {
    const kill = (outcome: ActOutcome): DramaEvent[] => [started("k", 0, "a", "kill", { with: "b" }), done("k", 1_000, outcome), speech("b", 1_500)];
    expect(deadSpeech(input(kill("landed")))).toMatchObject({ measured: 1, offenders: [{ actor: "b", atMs: 1_500, diedAtMs: 1_000, via: "kill" }] });
    for (const outcome of ["dodged", "blocked", "declined", "timeout"] as const) expect(deadSpeech(input(kill(outcome))).measured).toBe(0);
  });

  it("does not kill the target of a landed slap", () => {
    expect(deadSpeech(input([started("s", 0, "a", "slap", { with: "b" }), done("s", 1_000), speech("b", 1_500)])).measured).toBe(0);
  });

  it("goes by the earliest death when an actor dies twice", () => {
    const events = [death("b", 5_000), death("b", 1_000), speech("b", 2_000)];
    expect(deadSpeech(input(events)).offenders[0]!.diedAtMs).toBe(1_000);
  });

  it("is 0 for no speech, no deaths, or nothing", () => {
    expect(deadSpeech(input([death("b", 0)])).measured).toBe(0);
    expect(deadSpeech(input([speech("b", 0)])).measured).toBe(0);
    expect(deadSpeech(input([]))).toMatchObject({ measured: 0, offenders: [], codes: [] });
  });
});

describe("consent-violation (D7)", () => {
  const onHuman = (verb: string, extra: Partial<ActStartedEvent> = {}): ActStartedEvent => started("v", 1_000, "a", verb, { with: "h:9", ...extra });

  it("flags a landed violent act on a human with no take chip", () => {
    const r = consentViolation(input([onHuman("shove"), done("v", 2_000)]));
    expect(r).toMatchObject({ measured: 1, offendingActIds: ["v"], codes: ["D7"] });
  });

  it("passes when the human took it", () => {
    expect(consentViolation(input([onHuman("punch"), take("v", 1_500, "h:9"), done("v", 2_000)])).measured).toBe(0);
  });

  it("is not satisfied by a chip that was declined, timed out, was for another act, or came after the act landed", () => {
    const answer = (answer: "decline" | "timeout"): ConsentChipAnsweredEvent => ({ ...take("v", 1_500), answer });
    expect(consentViolation(input([onHuman("slap"), answer("decline"), done("v", 2_000)])).measured).toBe(1);
    expect(consentViolation(input([onHuman("slap"), answer("timeout"), done("v", 2_000)])).measured).toBe(1);
    expect(consentViolation(input([onHuman("slap"), take("other", 1_500), done("v", 2_000)])).measured).toBe(1);
    expect(consentViolation(input([onHuman("slap"), take("v", 2_001), done("v", 2_000)])).measured).toBe(1);
    expect(consentViolation(input([onHuman("slap"), take("v", 2_000), done("v", 2_000)])).measured).toBe(0); // at the instant is in time
  });

  it("does not flag an act that did not land: dodged, blocked, declined, timed out", () => {
    for (const outcome of ["dodged", "blocked", "declined", "timeout"] as const) expect(consentViolation(input([onHuman("kill"), done("v", 2_000, outcome)])).measured).toBe(0);
  });

  it("lists an act that never finished as unresolved rather than a violation", () => {
    expect(consentViolation(input([onHuman("punch")]))).toMatchObject({ measured: 0, unresolvedActIds: ["v"] });
  });

  it("only judges violent acts: glare and insult need no consent, shove and above do", () => {
    for (const verb of ["glare", "insult"]) expect(consentViolation(input([onHuman(verb), done("v", 2_000)])).measured).toBe(0);
    for (const verb of ["shove", "slap", "punch", "kill"]) expect(consentViolation(input([onHuman(verb), done("v", 2_000)])).measured).toBe(1);
  });

  it("only judges acts on humans: an actor target or no target is not a D7 case", () => {
    expect(consentViolation(input([started("v", 0, "a", "slap", { with: "b" }), done("v", 1_000)])).measured).toBe(0);
    expect(consentViolation(input([started("v", 0, "a", "slap"), done("v", 1_000)])).measured).toBe(0);
  });

  it("knows humans by name too, not only by the h: prefix", () => {
    const events = [started("v", 0, "a", "slap", { with: "guest" }), done("v", 1_000)];
    expect(consentViolation(input(events)).measured).toBe(0);
    expect(consentViolation({ ...input(events), humanIds: ["guest"] }).measured).toBe(1);
  });

  it("requires the opt-in flag when the act carries it: a take chip is not enough for someone who has not opted in", () => {
    const run = (targetOptIn: boolean | undefined) =>
      consentViolation(input([onHuman("slap", targetOptIn === undefined ? {} : { targetOptIn }), take("v", 1_500, "h:9"), done("v", 2_000)])).measured;
    expect(run(true)).toBe(0);
    expect(run(undefined)).toBe(0);
    expect(run(false)).toBe(1);
  });

  it("counts each offending act once and lists them all", () => {
    const events = [
      started("v1", 1_000, "a", "shove", { with: "h:9" }),
      done("v1", 2_000),
      started("v2", 30_000, "a", "slap", { with: "h:9" }),
      done("v2", 31_000),
      started("v3", 60_000, "a", "punch", { with: "h:9" }),
      take("v3", 60_500),
      done("v3", 61_000),
    ];
    expect(consentViolation(input(events))).toMatchObject({ measured: 2, offendingActIds: ["v1", "v2"] });
  });

  it("is 0 with nothing to judge", () => {
    expect(consentViolation(input([]))).toMatchObject({ measured: 0, offendingActIds: [], unresolvedActIds: [], codes: [] });
  });
});

describe("runDramaProbes", () => {
  const tiles: Record<string, [number, number]> = { a: [0, 0], b: [1, 0], c: [3, 3], d: [20, 20] };
  const clean: DramaEvent[] = [
    started("g", 0, "a", "glare", { with: "b" }),
    reaction("g", 400, "b", "target"),
    reaction("g", 900, "c"),
    started("i", 10_000, "a", "insult", { with: "b" }),
    reaction("i", 10_500, "b", "target"),
    reaction("i", 11_000, "c"),
    bodyAct("c", 12_000),
    done("i", 12_500),
  ];
  const names = ["body-act-rate", "act-rate", "reaction-latency-p90-target", "reaction-latency-p90-witness", "witness-coverage", "verb-diversity", "ladder-compliance", "dead-speech", "consent-violation"];

  it("returns one ProbeResult per probe, banded from PROBE_BANDS, passing a clean scene", () => {
    const results = runDramaProbes({ ...input(clean, { durationMs: 60_000 }), positionOf: plan(tiles) });
    expect(results.map((r) => r.probe)).toEqual(names);
    for (const r of results) {
      expect(r.bound).toEqual(PROBE_BANDS[r.probe]);
      expect(r.passed).toBe(true);
      expect(r.codes).toEqual([]);
    }
  });

  it("leaves witness-coverage out when it was given no positions", () => {
    expect(runDramaProbes(input(clean)).map((r) => r.probe)).toEqual(names.filter((n) => n !== "witness-coverage"));
  });

  it("fails the probes a bad scene breaks and attaches evidence and D-codes", () => {
    const bad: DramaEvent[] = [
      started("s", 0, "a", "slap", { with: "h:9" }),
      done("s", 1_000),
      death("b", 2_000),
      speech("b", 3_000),
    ];
    const results = new Map(runDramaProbes({ ...input(bad), positionOf: plan(tiles) }).map((r) => [r.probe, r]));
    expect(results.get("ladder-compliance")).toMatchObject({ passed: false, codes: ["D3"], evidence: { offendingActIds: ["s"] } });
    expect(results.get("consent-violation")).toMatchObject({ passed: false, measured: 1, codes: ["D7"], evidence: { offendingActIds: ["s"] } });
    expect(results.get("dead-speech")).toMatchObject({ passed: false, measured: 1, codes: ["D4"] });
    expect(results.get("reaction-latency-p90-target")).toMatchObject({ passed: true }); // a human target is not judged for latency
    expect(results.get("witness-coverage")).toMatchObject({ passed: false, codes: ["D1"] });
    expect(results.get("act-rate")).toMatchObject({ passed: true });
  });

  it("names D1 when a target never reacted, and D6 when acts are spammed", () => {
    const spam = Array.from({ length: 5 }, (_, i) => started(`s${i}`, i * 1_000, "a", "glare", { with: "b" }));
    const results = new Map(runDramaProbes(input(spam)).map((r) => [r.probe, r]));
    expect(results.get("reaction-latency-p90-target")).toMatchObject({ passed: false, codes: ["D1"], evidence: { target: { unreactedActIds: spam.map((a) => a.actId) } } });
    expect(results.get("act-rate")).toMatchObject({ passed: false, codes: ["D6"] });
    expect(results.get("verb-diversity")).toMatchObject({ passed: true, measured: 0.2 });
  });
});

describe("real run 7 frames", () => {
  const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../drama/__fixtures__/run7-wrapper-excerpt.jsonl");
  const frames: BodyFrame[] = readFileSync(FIXTURE, "utf8")
    .trim()
    .split("\n")
    .map((l) => normalizeFrame(JSON.parse(l) as Record<string, unknown>)!);
  const events = extractDramaEvents(frames);

  it("reads a sane, non-zero body-act-rate per actor-minute", () => {
    const actorIds = [...new Set(events.filter((e): e is BodyActEvent => e.kind === "body_act" && !e.actor.startsWith("h:")).map((e) => e.actor))];
    const durationMs = Math.max(...frames.map((f) => f.atMs)) - Math.min(...frames.map((f) => f.atMs));
    const r = bodyActRate({ events, actorIds, durationMs });
    expect(r.bodyActs).toBeGreaterThan(0);
    expect(r.measured).toBeGreaterThan(0);
    expect(r.measured).toBeLessThan(10); // the 17 baseline runs average 0.86; anything near the hotel's rate limit would be a bug
  });

  it("finds no acts, violence or dead speech in a run from before acts existed", () => {
    const actorIds = ["person-1", "person-2", "person-3", "person-4"];
    const r = new Map(runDramaProbes({ events, actorIds }).map((x) => [x.probe, x]));
    expect(r.get("act-rate")!.measured).toBe(0);
    expect(r.get("ladder-compliance")!.measured).toBe(1);
    expect(r.get("dead-speech")!.measured).toBe(0);
    expect(r.get("consent-violation")!.measured).toBe(0);
  });
});
