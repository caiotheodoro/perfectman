import { describe, it, expect } from "vitest";
import type { DramaEvent } from "../drama/index.js";
import { actRate, deadSpeech, ladderCompliance, verbDiversity, witnessCoverage } from "../probes/drama.js";
import { beat, death, done, humanDown, humanUp, input, reaction, revive, sceneCut, speech, started } from "./drama-probe-fixtures.js";

const S = 1000;
const act = (id: string, atMs: number, verb: string, scene: string, extra: Parameters<typeof started>[4] = {}) => started(id, atMs, "a", verb, { with: "b", scene, ...extra });

describe("ladder, spacing and kill count are per scene, not per room (LAD-1, LAD-3, LAD-4)", () => {
  it("restarts the ladder in a new scene of the same room: a slap that opens scene 7.3 is a skipped rung", () => {
    const events = [act("g", 0, "glare", "7.2"), act("i", 5 * S, "insult", "7.2"), act("sh", 25 * S, "shove", "7.2"), act("sl", 60 * S, "slap", "7.3")];
    expect(ladderCompliance(input(events)).offenders).toEqual([{ actId: "sl", reasons: ["rung_skip"] }]);
  });

  it("shares the ladder across rooms inside one scene", () => {
    const events = [started("g", 0, "a", "glare", { with: "b", scene: "7.2", room: "12" }), started("i", 5 * S, "a", "insult", { with: "b", scene: "7.2", room: "13" }), started("sh", 25 * S, "a", "shove", { with: "b", scene: "7.2", room: "14" })];
    expect(ladderCompliance(input(events))).toMatchObject({ measured: 1, offendingActIds: [] });
  });

  it("charges two physical beats less than 20 s apart in one scene, and not across a scene cut", () => {
    const sameScene = [act("g", 0, "glare", "7.2"), act("i", 1 * S, "insult", "7.2"), act("sh", 2 * S, "shove", "7.2"), act("sl", 2 * S + 19_999, "slap", "7.2")];
    expect(ladderCompliance(input(sameScene)).offenders).toEqual([{ actId: "sl", reasons: ["beat_budget"] }]);
    const cut = [act("g", 0, "glare", "7.2"), act("i", 1 * S, "insult", "7.2"), act("sh", 2 * S, "shove", "7.2"), act("g2", 15 * S, "glare", "7.3"), act("i2", 16 * S, "insult", "7.3"), act("sh2", 17 * S, "shove", "7.3")];
    expect(ladderCompliance(input(cut))).toMatchObject({ measured: 1, offendingActIds: [] });
  });

  it("lets a physical beat start at exactly 20 s after the last", () => {
    const events = [act("g", 0, "glare", "7.2"), act("i", 1 * S, "insult", "7.2"), act("sh", 2 * S, "shove", "7.2"), act("sl", 22 * S, "slap", "7.2")];
    expect(ladderCompliance(input(events)).offendingActIds).toEqual([]);
  });

  it("counts one kill per scene, whatever came of it, and a new scene starts the count again", () => {
    const two = [act("g", 0, "glare", "7.2"), act("k1", 1 * S, "kill", "7.2", { authoredSkip: true }), act("k2", 30 * S, "kill", "7.2")];
    expect(ladderCompliance(input(two)).offenders).toEqual([{ actId: "k2", reasons: ["kill_budget"] }]);
    const split = [act("g", 0, "glare", "7.2"), act("k1", 1 * S, "kill", "7.2", { authoredSkip: true }), act("g2", 20 * S, "glare", "7.3"), act("k2", 30 * S, "kill", "7.3", { authoredSkip: true })];
    expect(ladderCompliance(input(split)).offendingActIds).toEqual([]);
  });

  it("measures the spacing on the hotel's own `at` when both starts carry one", () => {
    const at = (id: string, t: number, hotelAt: number) => act(id, t, id === "sh" ? "shove" : id === "g" ? "glare" : id === "i" ? "insult" : "slap", "7.2", { hotelAt });
    const lateLog = [at("g", 0, 1_000), at("i", 1 * S, 2_000), at("sh", 2 * S, 3_000), at("sl", 40 * S, 3_000 + 19_000)];
    expect(ladderCompliance(input(lateLog)).offenders).toEqual([{ actId: "sl", reasons: ["beat_budget"] }]);
    const earlyLog = [at("g", 0, 1_000), at("i", 1 * S, 2_000), at("sh", 2 * S, 3_000), at("sl", 5 * S, 3_000 + 21_000)];
    expect(ladderCompliance(input(earlyLog)).offendingActIds).toEqual([]);
  });

  it("falls back to the room for a stream with no scene field", () => {
    const events = [started("g", 0, "a", "glare", { with: "b", room: "17" }), started("sh", 5 * S, "a", "shove", { with: "b", room: "17" })];
    expect(ladderCompliance(input(events)).offendingActIds).toEqual(["sh"]);
  });

  it("counts an aborted act, which started, and never a blocked one, which did not", () => {
    const aborted = [act("g", 0, "glare", "7.2"), act("i", 1 * S, "insult", "7.2"), act("sh", 2 * S, "shove", "7.2"), done("sh", 3 * S, "aborted", { reason: "calm_room" }), act("sl", 5 * S, "slap", "7.2")];
    expect(ladderCompliance(input(aborted)).offenders).toEqual([{ actId: "sl", reasons: ["beat_budget"] }]);
    const blocked = [act("g", 0, "glare", "7.2"), done("x", 1 * S, "blocked", { reason: "ladder", verb: "punch", actor: "a", with: "b" }), act("i", 2 * S, "insult", "7.2")];
    expect(ladderCompliance(input(blocked))).toMatchObject({ measured: 1, judged: 2 });
  });
});

describe("act-rate and verb-diversity count started acts only, per scene", () => {
  it("keeps a blocked act (an act_done with no act_started) out of the count and the diversity", () => {
    const blocked = Array.from({ length: 6 }, (_, i) => done(`b${i}`, i * S, "blocked", { reason: "cooldown", verb: "glare", actor: "a", with: "b" }));
    expect(actRate(input(blocked))).toMatchObject({ measured: 0, perScene: {} });
    expect(verbDiversity(input(blocked))).toMatchObject({ acts: 0, judged: false });
  });

  it("counts an aborted act: it started", () => {
    const events = [act("a1", 0, "shove", "7.2"), done("a1", 500, "aborted", { reason: "paused" })];
    expect(actRate(input(events, { durationMs: 60_000 })).perScene["7.2"]).toMatchObject({ acts: 1 });
  });

  it("reads the busiest scene, not the busiest room, and a scene cut gives the spam a fresh minute", () => {
    const burst = (scene: string, from: number) => Array.from({ length: 4 }, (_, i) => act(`${scene}-${i}`, from + i * 5 * S, "glare", scene));
    const r = actRate(input([...burst("7.2", 0), ...burst("7.3", 30 * S)], { durationMs: 60_000 }));
    expect(r.perScene["7.2"]).toMatchObject({ acts: 4 });
    expect(r.perScene["7.3"]).toMatchObject({ acts: 4 });
    expect(r.measured).toBe(4);
  });
});

describe("who is dead when: actor_death, actor_revive and the human down state (DEATH-1, DEATH-7)", () => {
  it("lets an actor speak again from its revive, and flags speech between the death and the revive", () => {
    const events = [death("b", 1_000), speech("b", 2_000, "still dead"), sceneCut(5_000, "7.3", ["b"]), revive("b", 5_000), speech("b", 5_000, "at the instant"), speech("b", 6_000, "back")];
    const r = deadSpeech(input(events));
    expect(r.offenders.map((o) => o.atMs)).toEqual([2_000]);
  });

  it("flags a second death after a revive", () => {
    const events = [death("b", 1_000), revive("b", 2_000), death("b", 3_000), speech("b", 4_000)];
    expect(deadSpeech(input(events)).offenders).toEqual([{ actor: "b", atMs: 4_000, diedAtMs: 3_000, via: "death" }]);
  });

  it("does not let a landed kill reopen a death the revive already closed", () => {
    const events = [act("k", 0, "kill", "7.2", { authoredSkip: true }), death("b", 175), done("k", 3_010), revive("b", 5_000), speech("b", 6_000)];
    expect(deadSpeech(input(events)).measured).toBe(0);
  });

  it("treats a landed kill with no actor_death as a death at its act_done, until the revive", () => {
    const events = [act("k", 0, "kill", "7.2", { authoredSkip: true }), done("k", 3_000), speech("b", 4_000), revive("b", 5_000), speech("b", 6_000)];
    expect(deadSpeech(input(events)).offenders.map((o) => [o.atMs, o.via])).toEqual([[4_000, "kill"]]);
  });

  it("reads a standalone die as a death, and ignores an actor_death recorded for a human", () => {
    expect(deadSpeech(input([{ ...death("b", 1_000), cause: "die" }, speech("b", 2_000)])).measured).toBe(1);
    expect(deadSpeech(input([death("h:9", 1_000), speech("h:9", 2_000)])).measured).toBe(0);
  });

  it("does not take a killed human for dead: a human who chats while down is no D4", () => {
    const events = [started("k", 0, "a", "kill", { with: "h:9", scene: "7.2", authoredSkip: true }), done("k", 3_000), humanDown("h:9", 175), speech("h:9", 4_000, "Ai."), humanUp("h:9", 5_175)];
    expect(deadSpeech(input(events)).measured).toBe(0);
  });

  it("asks a revived actor for a reaction again, and still asks nothing of one that is dead", () => {
    const owed = (events: DramaEvent[]) => witnessCoverage(input([...events, started("s", 9_000, "a", "slap", { with: "b" }), beat("s", 9_300, [["c", "witness"]])]));
    expect(owed([death("c", 100), revive("c", 500)])).toMatchObject({ judged: 1, uncovered: [{ actId: "s", missing: ["c"] }] });
    expect(owed([death("c", 100)])).toMatchObject({ judged: 0 });
  });
});
