import type { ActionEmotions, BodyIntent } from "@perfectman/shared";
import { describe, expect, it } from "vitest";
import { CMD_BUDGET } from "../embodiment/constants.js";
import { TURN_BACK_HOLD_MS } from "../embodiment/drama-readings.js";
import { plan, updateMemory } from "../embodiment/plan.js";
import type { DramaPlanInput, PlanInput, PlannedCommand } from "../embodiment/types.js";
import { NOW, agentState, person, space } from "../testing/fixtures.js";
import type { SpaceOpts } from "../testing/fixtures.js";
import { seededRng } from "../util/stats.js";

const ZERO_ACT: ActionEmotions = {
  defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0, resentfulColdness: 0, curiousApproach: 0, anxiousOverreach: 0, pridefulPerformance: 0,
  vulnerableRetreat: 0, contemptuousDismissal: 0, strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0, dominanceAssertion: 0, repairImpulse: 0,
};

function run(o: SpaceOpts, over: Partial<PlanInput> = {}, drama: Partial<DramaPlanInput> | null = {}): PlannedCommand[] {
  let n = 0;
  const d: DramaPlanInput = { noReward: false, fallen: new Map(), nextActId: () => `pb${++n}`, ...drama };
  return plan({ space: space(o), agentState: agentState(), committedEvents: [], now: NOW, rng: seededRng(7), actionEmotions: ZERO_ACT, ...(drama ? { drama: d } : {}), ...over });
}

const intent = (b: Partial<BodyIntent>): BodyIntent => ({ order: "move_then_speak", ...b });
const speaker = (ref = "rafa", tile: [number, number] = [6, 4]) => person(ref, tile, { lastSpokeAt: NOW - 500 });

describe("the act lock (REA-9, ACT-12)", () => {
  it("[REA-9] issues no body command while an act holds the actor, whoever is speaking to it, and nothing was wrong with the plan before", () => {
    const o = { self: { dir: 6 as const }, others: [speaker()] };
    expect(run(o).map((c) => c.cmd)).toEqual(["face"]);
    expect(run(o, {}, { lock: { actId: "a1", why: "owed" } })).toEqual([]);
    expect(run(o, {}, { lock: { actId: "a1", why: "initiator" } })).toEqual([]);
  });

  it("[ACT-12] the director's own busy act holds it too, even when the ledger has not caught up", () => {
    expect(run({ self: { dir: 6 as const }, others: [speaker()] }, {}, { busyActId: "a7" })).toEqual([]);
  });

  it("[ACT-12] with drama off the lock does not exist: a plan input without `drama` is today's plan", () => {
    expect(run({ self: { dir: 6 as const }, others: [speaker()] }, {}, null).map((c) => c.cmd)).toEqual(["face"]);
  });

  it("[REA-9] the face rule does not turn an actor back round after it turned its back (the face lock must not undo a table step), until the hold ends", () => {
    const o = { self: { dir: 6 as const }, others: [speaker()] };
    expect(run(o, { memory: { turnedBack: { ref: "rafa", until: NOW + 2000 } } })).toEqual([]);
    expect(run(o, { memory: { turnedBack: { ref: "rafa", until: NOW - 1 } } }).map((c) => c.cmd)).toEqual(["face"]);
    expect(run(o, { memory: { turnedBack: { ref: "gabi", until: NOW + 2000 } } }).map((c) => c.cmd)).toEqual(["face"]);
  });

  it("[REA-9] a turn_back and a storm_off write the lock memory the 30 s reversal rule and the face rule read", () => {
    const sent: PlannedCommand[] = [{ agentId: "duda", cmd: "act", actId: "pb1", verb: "turn_back", with: "rafa" }];
    const mem = updateMemory({}, sent, NOW, [4, 4], "12");
    expect(mem.turnedBack).toEqual({ ref: "rafa", until: NOW + TURN_BACK_HOLD_MS });
    expect(mem.soloAt).toEqual({ turn_back: NOW });
    const storm = updateMemory({}, [{ agentId: "duda", cmd: "act", actId: "pb2", verb: "storm_off" }], NOW, [4, 4], "12", [0, 5]);
    expect(storm.lastMove).toEqual({ at: NOW, dx: -4, dy: 1 });
  });

  it("[REA-9] after a storm_off the actor does not storm back: the 30 s reversal lock holds a step toward the person it left, and a step on toward the door goes through", () => {
    const stormed = updateMemory({}, [{ agentId: "duda", cmd: "act", actId: "pb2", verb: "storm_off" }], NOW - 4000, [4, 4], "12", [0, 5]);
    const threatened = { agentState: agentState({ rel: { rafa: { threat: 0.8 } } }) };
    const behind = run({ others: [person("rafa", [3, 4])] }, { ...threatened, memory: stormed });
    expect(behind.some((c) => c.cmd === "walk")).toBe(false);
    const ahead = run({ others: [person("rafa", [5, 4])] }, { ...threatened, memory: stormed });
    expect(ahead.some((c) => c.cmd === "walk")).toBe(true);
  });
});

describe("no reward after a kill and the bodies on the floor (LAD-8, DOWN-1)", () => {
  it("[LAD-8] the killer plays no dance, thumbs or laugh, from the model or from its own mood, and still waves", () => {
    const happy = { agentState: agentState({ mood: { valence: 0.9 }, social: { affection: 0.9 } }), rng: () => 0.1 };
    expect(run({}, { bodyIntent: intent({ gesture: { kind: "thumbs" } }) }, { noReward: true })).toEqual([]);
    expect(run({}, { bodyIntent: intent({ gesture: { kind: "dance" } }) }, { noReward: true })).toEqual([]);
    expect(run({}, happy, { noReward: true }).some((c) => c.cmd === "gesture")).toBe(false);
    expect(run({}, happy, { noReward: false }).some((c) => c.cmd === "gesture" && c.a === "laugh")).toBe(true);
    expect(run({}, { bodyIntent: intent({ gesture: { kind: "wave" } }) }, { noReward: true })).toEqual([{ agentId: "duda", cmd: "gesture", a: "wave" }]);
  });

  it("[DOWN-1] a body is not an interlocutor and not someone to hug: nobody faces, approaches or reaches for a fallen avatar", () => {
    const body = person("rafa", [9, 4], { state: "lay", lastSpokeAt: NOW - 500 });
    const fallen = new Map([["rafa", "dead" as const]]);
    const drawn = { agentState: agentState({ rel: { rafa: { attraction: 0.9, comfort: 0.9, desireForCloseness: 0.9 } } }), memory: { firstPlanAt: NOW - 200_000 } };
    expect(run({ self: { dir: 6 as const }, others: [body] }, drawn, { fallen }).filter((c) => c.cmd === "face" || c.cmd === "walk" || c.cmd === "pair")).toEqual([]);
    expect(run({ self: { dir: 6 as const }, others: [body] }, drawn, null).some((c) => c.cmd === "face" || c.cmd === "walk" || c.cmd === "pair")).toBe(true);
  });
});

describe("solo and targeted verbs from the emotion model (bible 3.3, 3.4)", () => {
  const MID = { others: [person("rafa", [7, 4])] };

  it("[bible 3.4] sends the act with the run's next act id, the mood's intensity and the director origin, as an ordinary planned command", () => {
    const cmds = run(MID, { actionEmotions: { ...ZERO_ACT, resentfulColdness: 0.9 }, agentState: agentState({ mood: { circumplexRadius: 0.5 } }) });
    expect(cmds).toContainEqual({ agentId: "duda", cmd: "act", actId: "pb1", verb: "storm_off", origin: "director", intensity: 0.5 });
  });

  it("[bible 3.4] a solo verb is not played again inside its cooldown, and is again after it", () => {
    const o = { actionEmotions: { ...ZERO_ACT, vulnerableRetreat: 0.9 } };
    expect(run({}, { ...o, memory: { soloAt: { cry: NOW - 10_000 } } }).some((c) => c.cmd === "act")).toBe(false);
    expect(run({}, { ...o, memory: { soloAt: { cry: NOW - 100_000 } } }).some((c) => c.cmd === "act")).toBe(true);
  });

  it("[bible 3.4] a spike of arousal with a rising momentum is a freeze_gasp, and a calm one is nothing", () => {
    const spike = { agentState: agentState({ mood: { arousal: 0.9, momentumArousal: 0.4 } }) };
    expect(run({}, spike).some((c) => c.cmd === "act" && c.verb === "freeze_gasp")).toBe(true);
    expect(run({}, { agentState: agentState({ mood: { arousal: 0.9, momentumArousal: 0.1 } }) }).some((c) => c.cmd === "act")).toBe(false);
  });

  it("[bible 3.3] a witness who loves the victim walks up to the aggressor and restrains it on arrival, or at once when already beside it", () => {
    const o = { agentState: agentState({ rel: { gabi: { affection: 0.9 } } }), actionEmotions: { ...ZERO_ACT, repairImpulse: 0.7 } };
    const far = run({ others: [person("rafa", [8, 4]), person("gabi", [9, 5])] }, o, { rescue: { aggressor: "rafa", victim: "gabi" } });
    const walk = far.find((c) => c.cmd === "walk");
    const restrain = far.find((c) => c.cmd === "act");
    expect(walk).toBeDefined();
    expect(restrain).toMatchObject({ cmd: "act", verb: "restrain", with: "rafa", afterArrival: walk?.cmd === "walk" ? walk.plan : "?" });
    const near = run({ others: [person("rafa", [5, 4]), person("gabi", [9, 5])] }, o, { rescue: { aggressor: "rafa", victim: "gabi" } });
    expect(near).toEqual([{ agentId: "duda", cmd: "act", actId: "pb1", verb: "restrain", with: "rafa", origin: "director" }]);
  });

  it("[RES-1] never restrains for a human aggressor, for the one who is itself the aggressor or the victim, or without a reason", () => {
    const o = { agentState: agentState({ rel: { gabi: { affection: 0.9 } } }), actionEmotions: { ...ZERO_ACT, repairImpulse: 0.7 } };
    const others = [person("h:9", [5, 4]), person("gabi", [9, 5])];
    expect(run({ others }, o, { rescue: { aggressor: "h:9", victim: "gabi" } }).some((c) => c.cmd === "act")).toBe(false);
    expect(run({ others: [person("rafa", [5, 4])] }, o, { rescue: { aggressor: "duda", victim: "rafa" } }).some((c) => c.cmd === "act")).toBe(false);
    expect(run({ others: [person("rafa", [5, 4])] }, { agentState: agentState() }, { rescue: { aggressor: "rafa", victim: "gabi" } }).some((c) => c.cmd === "act")).toBe(false);
  });

  it("[WAKE-1] tends a fallen avatar only: the act waits for the arrival when it is not beside it, and no tender goes to a standing one", () => {
    const o = { actionEmotions: { ...ZERO_ACT, repairImpulse: 0.8 } };
    const far = run({ others: [person("rafa", [8, 6], { state: "lay" })] }, o, { fallen: new Map([["rafa", "fainted" as const]]) });
    expect(far.map((c) => c.cmd)).toEqual(["walk", "act"]);
    expect(far[1]).toMatchObject({ verb: "tend_fallen", with: "rafa" });
    expect(run({ others: [person("rafa", [5, 4])] }, o).some((c) => c.cmd === "act" && c.verb === "tend_fallen")).toBe(false);
  });

  it("[bible 3.3] a proud actor whose own embrace just landed holds the picture: a tableau", () => {
    const o = { actionEmotions: { ...ZERO_ACT, pridefulPerformance: 0.8 } };
    expect(run({}, o, { staged: true }).some((c) => c.cmd === "act" && c.verb === "tableau")).toBe(true);
    expect(run({}, o, { staged: false }).some((c) => c.cmd === "act" && c.verb === "tableau")).toBe(false);
  });

  it("[ACT-3] an act counts against the planner's own budget of 4 per 5 s, like any command", () => {
    const body = { dwell: { postureSince: 0, placeSince: 0, lastGestureAt: {} }, budget: { cmdTimes: [NOW - 1000, NOW - 2000, NOW - 3000, NOW - 4000] } };
    expect(run({ body }, { actionEmotions: { ...ZERO_ACT, vulnerableRetreat: 0.9 } })).toEqual([]);
    expect(CMD_BUDGET.count).toBe(4);
  });
});
