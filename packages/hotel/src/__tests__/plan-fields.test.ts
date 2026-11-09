import type { ActionEmotions, CoreMood, RelationalState, SocialEmotions } from "@perfectman/shared";
import { describe, expect, it } from "vitest";
import { plan } from "../embodiment/plan.js";
import type { DramaPlanInput, PlannedCommand } from "../embodiment/types.js";
import { NOW, agentState, person } from "../testing/fixtures.js";
import { space } from "../testing/fixtures.js";
import type { SpaceOpts } from "../testing/fixtures.js";
import { seededRng } from "../util/stats.js";

const ZERO_ACT: ActionEmotions = {
  defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0, resentfulColdness: 0, curiousApproach: 0, anxiousOverreach: 0, pridefulPerformance: 0,
  vulnerableRetreat: 0, contemptuousDismissal: 0, strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0, dominanceAssertion: 0, repairImpulse: 0,
};

type Over = {
  mood?: Partial<CoreMood>;
  social?: Partial<SocialEmotions>;
  act?: Partial<ActionEmotions>;
  rel?: Record<string, Partial<RelationalState>>;
  space?: SpaceOpts;
  drama?: Partial<DramaPlanInput>;
  memory?: Parameters<typeof plan>[0]["memory"];
  now?: number;
};

function go(o: Over, drama = true): PlannedCommand[] {
  let n = 0;
  const base: DramaPlanInput = { noReward: false, fallen: new Map(), nextActId: () => `pb${++n}`, ...o.drama };
  return plan({
    space: space(o.space),
    agentState: agentState({ ...(o.mood ? { mood: o.mood } : {}), ...(o.social ? { social: o.social } : {}), ...(o.rel ? { rel: o.rel } : {}) }),
    actionEmotions: { ...ZERO_ACT, ...o.act },
    committedEvents: [],
    now: o.now ?? NOW,
    rng: seededRng(7),
    ...(o.memory ? { memory: o.memory } : {}),
    ...(drama ? { drama: base } : {}),
  });
}

const act = (verb: string) => (cmds: PlannedCommand[]): boolean => cmds.some((c) => c.cmd === "act" && c.verb === verb);
const walks = (cmds: PlannedCommand[]): boolean => cmds.some((c) => c.cmd === "walk");
const faces = (cmds: PlannedCommand[]): boolean => cmds.some((c) => c.cmd === "face");
const expr = (face: string) => (cmds: PlannedCommand[]): boolean => cmds.some((c) => c.cmd === "expression" && c.face === face);
const gesture = (a: string) => (cmds: PlannedCommand[]): boolean => cmds.some((c) => c.cmd === "gesture" && c.a === a);
const anyExpr = (cmds: PlannedCommand[]): boolean => cmds.some((c) => c.cmd === "expression");

const RAFA_NEAR = { others: [person("rafa", [5, 4])] };
const RAFA_FAR = { others: [person("rafa", [10, 4])] };
const RAFA_MID = { others: [person("rafa", [7, 4])] };
const RAFA_S = { others: [person("rafa", [4, 7])] };
const FAMILIAR = { rafa: { interactionCount: 3, lastInteractionAt: 7 } };

type Case = { field: string; base: Over; treated: Over; expect: (cmds: PlannedCommand[]) => boolean };

/** One row per field the planner never read before (verb-bible 4.3 and 4.4): the decision it now decides, with the field as the only difference. */
const CASES: Case[] = [
  // ---- the 12 social emotions
  { field: "social.humiliation", base: { space: RAFA_MID }, treated: { space: RAFA_MID, social: { humiliation: 0.9 } }, expect: act("storm_off") },
  { field: "social.resentment", base: { space: RAFA_MID, rel: FAMILIAR }, treated: { space: RAFA_MID, rel: FAMILIAR, social: { resentment: 0.7 } }, expect: act("turn_back") },
  { field: "social.contempt", base: { space: RAFA_MID, rel: FAMILIAR }, treated: { space: RAFA_MID, rel: FAMILIAR, social: { contempt: 0.8 } }, expect: act("turn_back") },
  { field: "social.jealousy", base: { space: RAFA_S, rel: { rafa: { attraction: 0.8 } } }, treated: { space: RAFA_S, rel: { rafa: { attraction: 0.8 } }, social: { jealousy: 0.8 } }, expect: (c) => anyExpr(c) && faces(c) },
  { field: "social.envy", base: { space: RAFA_NEAR }, treated: { space: RAFA_NEAR, social: { envy: 0.8 } }, expect: walks },
  { field: "social.suspicion", base: { space: RAFA_NEAR }, treated: { space: RAFA_NEAR, social: { suspicion: 0.8 } }, expect: walks },
  { field: "social.admiration", base: { space: RAFA_FAR }, treated: { space: RAFA_FAR, social: { admiration: 0.8 } }, expect: walks },
  { field: "social.neediness", base: { space: RAFA_FAR }, treated: { space: RAFA_FAR, social: { neediness: 0.8 } }, expect: walks },
  { field: "social.desireForIntimacy", base: { space: RAFA_FAR }, treated: { space: RAFA_FAR, social: { desireForIntimacy: 0.8 } }, expect: walks },
  { field: "social.fearOfExclusion", base: { space: { others: [person("rafa", [5, 4]), person("gabi", [5, 5])] } }, treated: { space: { others: [person("rafa", [5, 4]), person("gabi", [5, 5])] }, social: { fearOfExclusion: 0.8 } }, expect: expr("sad") },
  { field: "social.desireForStatus", base: { space: { self: { tile: [1, 1] } } }, treated: { space: { self: { tile: [1, 1] } }, social: { desireForStatus: 0.8 } }, expect: walks },
  { field: "social.pride", base: {}, treated: { social: { pride: 0.8 } }, expect: gesture("thumbs") },
  // ---- the 15 action tendencies
  { field: "act.defensiveness", base: { space: RAFA_NEAR, rel: { rafa: { threat: 0.6 } } }, treated: { space: RAFA_NEAR, rel: { rafa: { threat: 0.6 } }, act: { defensiveness: 0.9 } }, expect: act("recoil") },
  { field: "act.warmth", base: { space: RAFA_NEAR, drama: { fallen: new Map([["rafa", "fainted" as const]]) } }, treated: { space: RAFA_NEAR, drama: { fallen: new Map([["rafa", "fainted" as const]]) }, act: { warmth: 0.8 } }, expect: act("tend_fallen") },
  { field: "act.jealousInspection", base: { space: RAFA_S, rel: { rafa: { attraction: 0.8 } } }, treated: { space: RAFA_S, rel: { rafa: { attraction: 0.8 } }, act: { jealousInspection: 0.8 } }, expect: (c) => anyExpr(c) && faces(c) },
  { field: "act.shameWithdrawal", base: { space: RAFA_MID }, treated: { space: RAFA_MID, act: { shameWithdrawal: 0.9 } }, expect: act("storm_off") },
  { field: "act.resentfulColdness", base: { space: RAFA_MID }, treated: { space: RAFA_MID, act: { resentfulColdness: 0.9 } }, expect: act("storm_off") },
  { field: "act.curiousApproach", base: { space: RAFA_FAR }, treated: { space: RAFA_FAR, act: { curiousApproach: 0.8 } }, expect: walks },
  {
    field: "act.anxiousOverreach",
    base: { space: RAFA_MID, rel: { rafa: { attraction: 0.7, comfort: 0.6, desireForCloseness: 0.8, desireForDistance: 0.1 } }, memory: { firstPlanAt: NOW - 40_000 } },
    treated: { space: RAFA_MID, rel: { rafa: { attraction: 0.7, comfort: 0.6, desireForCloseness: 0.8, desireForDistance: 0.1 } }, memory: { firstPlanAt: NOW - 40_000 }, act: { anxiousOverreach: 0.9 } },
    expect: (c) => c.some((x) => x.cmd === "pair"),
  },
  { field: "act.pridefulPerformance", base: {}, treated: { act: { pridefulPerformance: 0.8 } }, expect: gesture("thumbs") },
  { field: "act.vulnerableRetreat", base: {}, treated: { act: { vulnerableRetreat: 0.9 } }, expect: act("cry") },
  { field: "act.contemptuousDismissal", base: { space: RAFA_MID, rel: FAMILIAR }, treated: { space: RAFA_MID, rel: FAMILIAR, act: { contemptuousDismissal: 0.8 } }, expect: act("turn_back") },
  { field: "act.strategicPatience", base: { space: RAFA_MID, act: { resentfulColdness: 0.75 } }, treated: { space: RAFA_MID, act: { resentfulColdness: 0.75, strategicPatience: 1 } }, expect: (c) => !act("storm_off")(c) },
  { field: "act.impulsiveProvocation", base: { space: RAFA_MID, act: { resentfulColdness: 0.62 } }, treated: { space: RAFA_MID, act: { resentfulColdness: 0.62, impulsiveProvocation: 1 } }, expect: act("storm_off") },
  { field: "act.comfortSeeking", base: { space: RAFA_FAR }, treated: { space: RAFA_FAR, act: { comfortSeeking: 0.8 } }, expect: walks },
  { field: "act.dominanceAssertion", base: { space: RAFA_MID, mood: { arousal: 0.7, valence: -0.5 } }, treated: { space: RAFA_MID, mood: { arousal: 0.7, valence: -0.5 }, act: { dominanceAssertion: 0.8 } }, expect: expr("angry") },
  { field: "act.repairImpulse", base: { space: RAFA_NEAR, drama: { fallen: new Map([["rafa", "dead" as const]]) } }, treated: { space: RAFA_NEAR, drama: { fallen: new Map([["rafa", "dead" as const]]) }, act: { repairImpulse: 0.8 } }, expect: act("tend_fallen") },
  // ---- core mood
  { field: "core.stability", base: { space: RAFA_NEAR, rel: { rafa: { threat: 0.8 } }, memory: { lastMove: { at: NOW - 5000, dx: 1, dy: 0 } } }, treated: { space: RAFA_NEAR, rel: { rafa: { threat: 0.8 } }, memory: { lastMove: { at: NOW - 5000, dx: 1, dy: 0 } }, mood: { stability: 0.15 } }, expect: walks },
  { field: "core.circumplexRadius", base: { mood: { circumplexAngle: Math.PI } }, treated: { mood: { circumplexAngle: Math.PI, circumplexRadius: 0.8 } }, expect: expr("sad") },
  { field: "core.circumplexAngle", base: { mood: { circumplexRadius: 0.8, circumplexAngle: Math.PI } }, treated: { mood: { circumplexRadius: 0.8, circumplexAngle: (3 * Math.PI) / 4 } }, expect: expr("angry") },
  { field: "core.momentumArousal", base: { space: RAFA_MID, act: { resentfulColdness: 0.62 } }, treated: { space: RAFA_MID, act: { resentfulColdness: 0.62 }, mood: { momentumArousal: 0.5 } }, expect: act("storm_off") },
  { field: "core.momentumValence", base: { space: RAFA_MID, act: { resentfulColdness: 0.62 } }, treated: { space: RAFA_MID, act: { resentfulColdness: 0.62 }, mood: { momentumValence: -0.5 } }, expect: act("storm_off") },
  // ---- relational state
  { field: "rel.trust", base: { space: RAFA_NEAR }, treated: { space: RAFA_NEAR, rel: { rafa: { trust: -0.9 } } }, expect: walks },
  { field: "rel.resentment", base: { space: RAFA_MID, social: { contempt: 0.7 }, rel: { rafa: { interactionCount: 3 } } }, treated: { space: RAFA_MID, social: { contempt: 0.7 }, rel: { rafa: { interactionCount: 3, resentment: 0.6 } } }, expect: act("turn_back") },
  { field: "rel.suspicion", base: { space: RAFA_NEAR }, treated: { space: RAFA_NEAR, rel: { rafa: { suspicion: 0.8 } } }, expect: walks },
  { field: "rel.admiration", base: { space: RAFA_FAR }, treated: { space: RAFA_FAR, rel: { rafa: { admiration: 0.8 } } }, expect: walks },
  { field: "rel.envy", base: { space: RAFA_NEAR }, treated: { space: RAFA_NEAR, rel: { rafa: { envy: 0.8 } } }, expect: walks },
  { field: "rel.curiosity", base: { space: RAFA_FAR }, treated: { space: RAFA_FAR, rel: { rafa: { curiosity: 0.8 } } }, expect: walks },
  { field: "rel.affection", base: { space: RAFA_NEAR, drama: { fallen: new Map([["rafa", "fainted" as const]]) } }, treated: { space: RAFA_NEAR, drama: { fallen: new Map([["rafa", "fainted" as const]]) }, rel: { rafa: { affection: 0.8 } } }, expect: act("tend_fallen") },
  { field: "rel.interactionCount", base: { space: RAFA_MID, social: { contempt: 0.7 }, rel: { rafa: { lastNegativeAt: 5 } } }, treated: { space: RAFA_MID, social: { contempt: 0.7 }, rel: { rafa: { lastNegativeAt: 5, interactionCount: 4 } } }, expect: act("turn_back") },
  { field: "rel.lastInteractionAt", base: { space: RAFA_MID, social: { contempt: 0.7 }, rel: { rafa: { lastNegativeAt: 5 } } }, treated: { space: RAFA_MID, social: { contempt: 0.7 }, rel: { rafa: { lastNegativeAt: 5, lastInteractionAt: 7 } } }, expect: act("turn_back") },
  { field: "rel.lastNegativeAt", base: { space: RAFA_MID, social: { contempt: 0.7 }, rel: FAMILIAR }, treated: { space: RAFA_MID, social: { contempt: 0.7 }, rel: { rafa: { ...FAMILIAR.rafa, lastNegativeAt: 5 } } }, expect: act("turn_back") },
  { field: "rel.lastPositiveAt", base: { space: RAFA_MID, social: { contempt: 0.7 }, rel: { rafa: { ...FAMILIAR.rafa, lastNegativeAt: 5, lastPositiveAt: 9 } } }, treated: { space: RAFA_MID, social: { contempt: 0.7 }, rel: { rafa: { ...FAMILIAR.rafa, lastNegativeAt: 5 } } }, expect: act("turn_back") },
];

describe("4.3 and 4.4: every field the planner never read now decides something (drama on)", () => {
  it.each(CASES.map((c) => [c.field, c] as const))("[bible 4.3/4.4] %s changes the plan, and the change is the one the reading names", (_field, c) => {
    const before = go(c.base);
    const after = go(c.treated);
    expect(c.expect(before)).toBe(false);
    expect(c.expect(after)).toBe(true);
    expect(after).not.toEqual(before);
  });

  it.each(CASES.map((c) => [c.field, c] as const))("[NEG-2] with drama off %s changes nothing: the plan is exactly today's", (_field, c) => {
    expect(go(c.treated, false)).toEqual(go(c.base, false));
  });
});

describe("4.3: the readings stay data", () => {
  it("[bible 4.3] a solo act carries the mood's intensity, so a calm actor and a wrought one do not play the same cry", () => {
    const calm = go({ act: { vulnerableRetreat: 0.9 }, mood: { circumplexRadius: 0.3 } }).find((c) => c.cmd === "act");
    const wrought = go({ act: { vulnerableRetreat: 0.9 }, mood: { circumplexRadius: 0.95 } }).find((c) => c.cmd === "act");
    expect(calm).toMatchObject({ verb: "cry", actId: "pb1", intensity: 0.3 });
    expect(wrought).toMatchObject({ verb: "cry", intensity: 0.95 });
  });
});
