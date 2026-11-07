import type { BodyHandleMap, BodyIntent } from "@perfectman/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CMD_BUDGET } from "../embodiment/constants.js";
import { chooseSpeechMode, noteExchange, plan, planFacing, updateMemory } from "../embodiment/plan.js";
import type { PlanInput, PlannedCommand } from "../embodiment/types.js";
import { NOW, agentState, person, sofa, space } from "../testing/fixtures.js";
import type { SpaceOpts } from "../testing/fixtures.js";
import { seededRng } from "../util/stats.js";

function run(o: SpaceOpts, over: Partial<PlanInput> = {}): PlannedCommand[] {
  return plan({ space: space(o), agentState: agentState(), committedEvents: [], now: NOW, rng: seededRng(7), ...over });
}

const intent = (b: Partial<BodyIntent>): BodyIntent => ({ order: "move_then_speak", ...b });
const handles: BodyHandleMap = { p1: { kind: "person", ref: "h:9" }, z1: { kind: "zone", roomId: "12", zoneId: "z1" } };

describe("embodiment planner", () => {
  it("issues nothing in a stale or degraded room", () => {
    const stale = run({ stale: true, others: [person("h:9", [5, 4], { lastSpokeAt: NOW - 500 })] });
    expect(stale).toEqual([]);
  });

  it("faces a speaker within 6 tiles, and not when already within 45 degrees", () => {
    const speaker = person("h:9", [6, 4], { lastSpokeAt: NOW - 500 });
    expect(run({ self: { dir: 6 }, others: [speaker] })).toEqual([{ agentId: "duda", cmd: "face", targetTile: [6, 4] }]);
    expect(run({ self: { dir: 2 }, others: [person("h:9", [6, 5], { lastSpokeAt: NOW - 500 })] })).toEqual([]);
  });

  it("approaches a distant interlocutor, but stays put inside the dead band (hysteresis)", () => {
    const far = run({ others: [person("h:9", [9, 4], { lastSpokeAt: NOW - 500 })] }, { agentState: agentState({ rel: { "h:9": { desireForCloseness: 0.8 } } }) });
    expect(far.some((c) => c.cmd === "walk")).toBe(true);
    const mid = run({ self: { dir: 2 }, others: [person("h:9", [7, 4], { lastSpokeAt: NOW - 500 })] });
    expect(mid.some((c) => c.cmd === "walk")).toBe(false);
  });

  it("steps back from a threatening person inside the personal band", () => {
    const cmds = run({ others: [person("h:9", [5, 4])] }, { agentState: agentState({ rel: { "h:9": { threat: 0.8 } } }) });
    const walk = cmds.find((c) => c.cmd === "walk");
    expect(walk && walk.cmd === "walk" ? Math.max(Math.abs(walk.to[0] - 5), Math.abs(walk.to[1] - 4)) : 0).toBeGreaterThanOrEqual(2);
  });

  it("never exceeds 4 commands per 5 s, and keeps moves when it must drop", () => {
    const body = { dwell: { postureSince: 0, placeSince: 0, lastGestureAt: {} }, budget: { cmdTimes: [NOW - 1000, NOW - 2000, NOW - 3000] } };
    const cmds = run(
      { body, others: [person("h:9", [9, 4], { lastSpokeAt: NOW - 500 })] },
      { agentState: agentState({ mood: { valence: 0.8 }, social: { affection: 0.9 }, rel: { "h:9": { desireForCloseness: 0.9 } } }), rng: () => 0.1 },
    );
    expect(cmds.length).toBeLessThanOrEqual(CMD_BUDGET.count - 3);
    expect(cmds.every((c) => c.cmd === "walk")).toBe(true);
    expect(run({ body: { dwell: body.dwell, budget: { cmdTimes: [NOW - 1, NOW - 2, NOW - 3, NOW - 4] } } })).toEqual([]);
  });

  it("holds a gesture to its 15 s cooldown and never repeats the last kind", () => {
    const g = intent({ gesture: { kind: "wave" } });
    expect(run({}, { bodyIntent: g })).toEqual([{ agentId: "duda", cmd: "gesture", a: "wave" }]);
    const cooling = { dwell: { postureSince: 0, placeSince: 0, lastGestureAt: { wave: NOW - 5000 } }, budget: { cmdTimes: [] } };
    expect(run({ body: cooling }, { bodyIntent: g })).toEqual([]);
    expect(run({}, { bodyIntent: g, memory: { lastGesture: { a: "wave", at: NOW - 20_000 } } })).toEqual([]);
  });

  it("resolves handles: go_to a zone, approach a person, sit on a free seat", () => {
    const z = space({ furni: [sofa(1, [8, 2])] }).room?.zones.find((x) => x.kind === "seating");
    const h: BodyHandleMap = { ...handles, z1: { kind: "zone", roomId: "12", zoneId: z?.id ?? "" }, f1: { kind: "furni", roomId: "12", furniId: 1 } };
    const go = run({ furni: [sofa(1, [8, 2])] }, { bodyIntent: intent({ move: { kind: "go_to", place: "z1" } }), handles: h });
    expect(go).toHaveLength(1);
    expect(go[0]).toMatchObject({ cmd: "walk" });
    const sit = run({ furni: [sofa(1, [8, 2])] }, { bodyIntent: intent({ posture: { pose: "sit", at: "f1" } }), handles: h });
    expect(sit).toEqual([{ agentId: "duda", cmd: "sit", furniId: 1 }]);
    const unknown = run({}, { bodyIntent: intent({ move: { kind: "approach", target: "p9", band: "personal" } }), handles });
    expect(unknown).toEqual([]);
  });

  it("turns a kiss toward a person into the pair choreography, human targets free", () => {
    const cmds = run({ others: [person("h:9", [5, 4])] }, { bodyIntent: intent({ gesture: { kind: "kiss", toward: "p1" } }), handles });
    expect(cmds[0]).toMatchObject({ cmd: "pair", kind: "kiss", with: "h:9" });
    const refusedActor = run({ others: [person("rafa", [5, 4])] }, { bodyIntent: intent({ gesture: { kind: "kiss", toward: "p1" } }), handles: { p1: { kind: "person", ref: "rafa" } } });
    expect(refusedActor.some((c) => c.cmd === "pair")).toBe(false);
  });

  it("fidgets after a no_op streak at most once per 45 s, and sits when a seat is close", () => {
    const base = { others: [], furni: [sofa(1, [5, 4])] } satisfies SpaceOpts;
    const first = run(base, { noOpStreak: 3 });
    expect(first).toEqual([{ agentId: "duda", cmd: "sit", furniId: 1, fidget: true }]);
    expect(run(base, { noOpStreak: 3, memory: { lastFidgetAt: NOW - 10_000 } })).toEqual([]);
    expect(run(base, { noOpStreak: 2 })).toEqual([]);
  });

  it("does not reverse direction inside the zone dwell window", () => {
    const sp = { others: [person("h:9", [9, 4], { lastSpokeAt: NOW - 500 })] };
    const st = agentState({ rel: { "h:9": { desireForCloseness: 0.9 } } });
    expect(run(sp, { agentState: st }).some((c) => c.cmd === "walk")).toBe(true);
    const away = { lastMove: { at: NOW - 5000, dx: -3, dy: 0 } };
    expect(run(sp, { agentState: st, memory: away }).some((c) => c.cmd === "walk")).toBe(false);
  });

  it("is deterministic for a given rng, and stays inside the budget for any mood", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), fc.integer({ min: 0, max: 5 }), fc.integer({ min: 1, max: 8 }), (energy, valence, streak, used) => {
        const cmdTimes = Array.from({ length: used }, (_, i) => NOW - 100 * (i + 1));
        const mk = (): PlannedCommand[] =>
          run(
            { body: { dwell: { postureSince: 0, placeSince: 0, lastGestureAt: {} }, budget: { cmdTimes } }, furni: [sofa(1, [8, 2])], others: [person("h:9", [9, 4], { lastSpokeAt: NOW - 500 })] },
            { agentState: agentState({ mood: { energy, valence }, social: { affection: 0.9, shame: 0.9 } }), noOpStreak: streak, rng: seededRng(3) },
          );
        const a = mk();
        expect(a).toEqual(mk());
        expect(a.length).toBeLessThanOrEqual(Math.max(0, CMD_BUDGET.count - Math.min(used, CMD_BUDGET.count)));
      }),
    );
  });
});

describe("planner memory and speech mode", () => {
  it("records walk vectors, gestures, expressions and fidgets", () => {
    const mem = updateMemory({}, [
      { agentId: "duda", cmd: "walk", to: [7, 4] },
      { agentId: "duda", cmd: "gesture", a: "laugh" },
      { agentId: "duda", cmd: "expression", face: "smile" },
      { agentId: "duda", cmd: "face", targetTile: [1, 1], fidget: true },
    ], NOW, [4, 4]);
    expect(mem).toEqual({ lastMove: { at: NOW, dx: 3, dy: 0 }, lastGesture: { a: "laugh", at: NOW }, lastLaughAt: NOW, lastExpression: "smile", lastFidgetAt: NOW });
  });

  it("shouts only on high arousal with shout-worthy text, once per 60 s", () => {
    expect(chooseSpeechMode(0.9, "NAO ACREDITO NISSO", {}, NOW, "say").mode).toBe("shout");
    expect(chooseSpeechMode(0.9, "ok, entendi", {}, NOW, "say").mode).toBe("say");
    expect(chooseSpeechMode(0.5, "NAO ACREDITO NISSO", {}, NOW, "say").mode).toBe("say");
    expect(chooseSpeechMode(0.9, "NAO ACREDITO NISSO", { lastShoutAt: NOW - 30_000 }, NOW, "say").mode).toBe("say");
    expect(chooseSpeechMode(0.9, "psiu", {}, NOW, "whisper").mode).toBe("whisper");
  });
});

describe("pair and approach etiquette around a human", () => {
  const kiss = intent({ gesture: { kind: "kiss", toward: "p1" } });
  const approach = intent({ move: { kind: "approach", target: "p1", band: "personal" } });

  it("leaves a human alone for 60 s after they dodged or pushed away a pair act", () => {
    const others = [person("h:9", [5, 4])];
    const fresh = { pairRefusedAt: { "h:9": NOW - 20_000 } };
    expect(run({ others }, { bodyIntent: kiss, handles, memory: fresh }).some((c) => c.cmd === "pair")).toBe(false);
    const old = { pairRefusedAt: { "h:9": NOW - 61_000 } };
    expect(run({ others }, { bodyIntent: kiss, handles, memory: old })[0]).toMatchObject({ cmd: "pair", with: "h:9" });
  });

  it("never walks up to a human who refused recently on its own (automatic approach)", () => {
    const others = [person("h:9", [9, 4], { lastSpokeAt: NOW - 500 })];
    const rel = agentState({ rel: { "h:9": { desireForCloseness: 0.8 } } });
    expect(run({ others }, { agentState: rel }).some((c) => c.cmd === "walk")).toBe(true);
    expect(run({ others }, { agentState: rel, memory: { pairRefusedAt: { "h:9": NOW - 5_000 } } }).some((c) => c.cmd === "walk")).toBe(false);
  });

  it("does not add a third actor to the two already heading for the same human", () => {
    const human = person("h:9", [8, 4]);
    const heading = (ref: string, goal: [number, number]) => person(ref, [2, 8], { state: "walk", walkGoal: goal });
    const two = [human, heading("rafa", [7, 4]), heading("gabi", [7, 5])];
    expect(run({ others: two }, { bodyIntent: approach, handles }).some((c) => c.cmd === "walk")).toBe(false);
    const one = [human, heading("rafa", [7, 4])];
    expect(run({ others: one }, { bodyIntent: approach, handles }).some((c) => c.cmd === "walk")).toBe(true);
  });

  it("picks a tile no other actor is walking to", () => {
    const human = person("h:9", [8, 4]);
    const goal: [number, number] = [6, 4];
    const others = [human, person("rafa", [2, 8], { state: "walk", walkGoal: goal })];
    for (let seed = 1; seed <= 20; seed++) {
      const walk = run({ others }, { bodyIntent: approach, handles, rng: seededRng(seed) }).find((c) => c.cmd === "walk");
      expect(walk && walk.cmd === "walk" ? walk.to : undefined).not.toEqual(goal);
    }
  });

  describe("facing the interlocutor", () => {
    const other = person("h:9", [6, 4]);

    it("planFacing turns to the person right away, once, and not when already facing them or mid-walk", () => {
      expect(planFacing({ space: space({ self: { dir: 6 }, others: [other] }), now: NOW }, "h:9")).toEqual([{ agentId: "duda", cmd: "face", targetTile: [6, 4] }]);
      expect(planFacing({ space: space({ self: { dir: 2 }, others: [other] }), now: NOW }, "h:9")).toEqual([]);
      expect(planFacing({ space: space({ self: { dir: 6, state: "walk" }, others: [other] }), now: NOW }, "h:9")).toEqual([]);
    });

    it("planFacing stays inside conversation range, the command budget and a live room", () => {
      expect(planFacing({ space: space({ self: { dir: 6 }, others: [person("h:9", [12, 4])] }), now: NOW }, "h:9")).toEqual([]);
      const full = { dwell: { postureSince: 0, placeSince: 0, lastGestureAt: {} }, budget: { cmdTimes: [NOW - 1, NOW - 2, NOW - 3, NOW - 4] } };
      expect(planFacing({ space: space({ self: { dir: 6 }, others: [other], body: full }), now: NOW }, "h:9")).toEqual([]);
      expect(planFacing({ space: space({ self: { dir: 6 }, others: [other], stale: true }), now: NOW }, "h:9")).toEqual([]);
      expect(planFacing({ space: space({ self: { dir: 6 }, others: [other] }), now: NOW }, "nobody")).toEqual([]);
    });

    it("keeps facing the interlocutor on later pulses while the exchange lasts, even after they stop talking", () => {
      const quiet = person("h:9", [6, 4]);
      const memory = noteExchange({}, "h:9", NOW - 10_000);
      expect(run({ self: { dir: 6 }, others: [quiet] }, { memory })).toEqual([{ agentId: "duda", cmd: "face", targetTile: [6, 4] }]);
      expect(run({ self: { dir: 6 }, others: [quiet] }, { memory: noteExchange({}, "h:9", NOW - 40_000) })).toEqual([]);
    });
  });
});
