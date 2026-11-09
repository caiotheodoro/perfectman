import { describe, expect, it } from "vitest";
import { ACT_VERBS } from "@perfectman/shared";
import type { ActVerb } from "@perfectman/shared";
import type { ScenarioDrama } from "../authoring/scenario-drama.js";
import { DEFAULT_DRAMA_TUNING } from "../director/drama/tuning.js";
import type { DramaTuning } from "../director/drama/tuning.js";
import type { DramaApproval, DramaDecision } from "../director/drama/ports.js";
import { A, B, C, H, WIDE_BLOCK, emotion, makeRig } from "../testing/drama-rig.js";
import type { Rig } from "../testing/drama-rig.js";

const ask = (rig: Rig, actor: number, verb: ActVerb, target: number | undefined, e: ReturnType<typeof emotion> | undefined, origin: "model" | "scenario" = "model"): DramaDecision =>
  rig.dir.decide({ actor, proposal: { verb, ...(target !== undefined ? { with: target } : {}), origin }, ...(e ? { emotion: e } : {}) });

describe("the motive gate (LAD-6) reads the emotion state as ladder pressure", () => {
  it("[LAD-6] a model proposal with no emotion state, or below theta, is vetoed with detail motive", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    expect(ask(rig, A, "glare", B, undefined)).toMatchObject({ kind: "veto", reason: "ladder", rule: "LAD-6", detail: "motive" });
    expect(ask(rig, A, "glare", B, emotion({ resentfulColdness: 0.2 }))).toMatchObject({ kind: "veto", detail: "motive" });
    expect(ask(rig, A, "glare", B, emotion({ resentfulColdness: 0.4 }))).toMatchObject({ kind: "approve" });
  });

  it("[LAD-6] rung 2 and above need a grievance: resentment 0.5 or a negative event inside the window", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    const cold = emotion({ impulsiveProvocation: 1 }, { relation: { resentment: 0.1, lastNegativeAt: null } });
    expect(ask(rig, A, "insult", B, cold)).toMatchObject({ kind: "veto", detail: "grievance" });
    const recent = emotion({ impulsiveProvocation: 1 }, { relation: { resentment: 0.1, lastNegativeAt: rig.clock.now() - 60_000 } });
    expect(ask(rig, A, "insult", B, recent)).toMatchObject({ kind: "approve" });
    const stale = emotion({ impulsiveProvocation: 1 }, { relation: { resentment: 0.1, lastNegativeAt: rig.clock.now() - 3_600_000 } });
    expect(ask(rig, C, "insult", B, stale)).toMatchObject({ kind: "veto", detail: "grievance" });
  });

  it("[LAD-6] strategicPatience raises every theta and rising arousal momentum lowers it", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    expect(ask(rig, A, "glare", B, emotion({ resentfulColdness: 0.4, strategicPatience: 1 }))).toMatchObject({ kind: "veto", detail: "motive" });
    expect(ask(rig, A, "glare", B, emotion({ resentfulColdness: 0.3 }, { core: { momentumArousal: 1 } }))).toMatchObject({ kind: "approve" });
  });

  it("[LAD-6] an authored beat bypasses the emotion gate, not the ladder", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    expect(ask(rig, A, "insult", B, undefined, "scenario")).toMatchObject({ kind: "approve" });
    expect(ask(rig, C, "shove", B, undefined, "scenario")).toMatchObject({ kind: "veto", reason: "ladder", detail: "rung" });
  });

  it("[LAD-6] the tendencies are data: each one drives the verbs of verb-bible 4.3 and stops at its ceiling", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    // defensiveness licenses a first strike from fear, and its ceiling is shove: it never drives a slap.
    const scared = emotion({ defensiveness: 1 });
    expect(DEFAULT_DRAMA_TUNING.drivers.shove?.map((d) => d.source)).toContain("act.defensiveness");
    expect(DEFAULT_DRAMA_TUNING.drivers.slap?.map((d) => d.source)).not.toContain("act.defensiveness");
    rig.act({ actId: "p1", verb: "insult", actor: A, with: B, outcome: "landed" });
    expect(ask(rig, A, "shove", B, scared)).toMatchObject({ kind: "approve", verb: "shove" });
    // kill has no driver at all: mortality is authored (LAD-5).
    expect(DEFAULT_DRAMA_TUNING.drivers.kill).toBeUndefined();
    const everything = emotion(Object.fromEntries(Object.keys(emotion({}).actionEmotions).map((k) => [k, 1])));
    const primed = makeRig({ block: WIDE_BLOCK });
    primed.act({ actId: "p1", verb: "punch", actor: A, with: B, outcome: "landed" });
    await primed.clock.advance(21_000);
    expect(ask(primed, A, "kill", B, everything)).toMatchObject({ kind: "veto", reason: "ladder", rule: "LAD-6", detail: "motive" });
  });

  it("[LAD-6] a tuning passed in changes the outcome with no code change", () => {
    const tuned: DramaTuning = { ...DEFAULT_DRAMA_TUNING, theta: { ...DEFAULT_DRAMA_TUNING.theta, 1: 0.95 } };
    const rig = makeRig({ block: WIDE_BLOCK, tuning: tuned });
    expect(ask(rig, A, "glare", B, emotion({ resentfulColdness: 0.9 }))).toMatchObject({ kind: "veto", detail: "motive" });
  });

  it("[LAD-10] at most two actors, or a third of a small cast, hold rung 3 or above at once", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.world.cast = 3;
    rig.act({ actId: "p1", verb: "insult", actor: B, with: C, outcome: "landed" });
    rig.act({ actId: "p2", verb: "shove", actor: B, with: C, outcome: "landed" });
    rig.act({ actId: "p3", verb: "insult", actor: A, with: C, outcome: "landed" });
    await rig.clock.advance(21_000);
    expect(ask(rig, A, "shove", C, emotion({ dominanceAssertion: 1 }))).toMatchObject({ kind: "veto", rule: "LAD-10", detail: "contagion" });
    // an actor already at the rung may go on; a bigger cast has room for two.
    expect(ask(rig, B, "slap", C, emotion({ dominanceAssertion: 1 }))).not.toMatchObject({ rule: "LAD-10" });
    const big = makeRig({ block: WIDE_BLOCK });
    big.act({ actId: "p1", verb: "insult", actor: B, with: C, outcome: "landed" });
    big.act({ actId: "p2", verb: "shove", actor: B, with: C, outcome: "landed" });
    big.act({ actId: "p3", verb: "insult", actor: A, with: C, outcome: "landed" });
    await big.clock.advance(21_000);
    expect(ask(big, A, "shove", C, emotion({ dominanceAssertion: 1 }))).toMatchObject({ kind: "approve" });
  });
});

describe("HYBRID: the director may also start a beat when the model is passive", () => {
  it("[LAD-6] initiates the beat the emotion drives, as origin director, one rung at a time", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    const d = rig.dir.decide({ actor: A, emotion: emotion({ resentfulColdness: 0.9, dominanceAssertion: 1 }, { toward: [B], core: { arousal: 0.64 } }) });
    expect(d).toMatchObject({ kind: "initiate", with: B, origin: "director", intensity: 0.64 });
    expect((d as DramaApproval).rung).toBeLessThanOrEqual(2);
    expect(rig.link.acts[0]?.cmd).toMatchObject({ origin: "director", intensity: 0.64 });
    expect((d as DramaApproval).volition?.v).toBeGreaterThanOrEqual((d as DramaApproval).volition?.theta ?? 1);
  });

  it("[LAD-6] passes when nothing drives a beat, when there is no emotion state, and inside the pace gap", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    expect(rig.dir.decide({ actor: A })).toEqual({ kind: "pass", why: "no_drive" });
    expect(rig.dir.decide({ actor: A, emotion: emotion({}) })).toEqual({ kind: "pass", why: "no_drive" });
    const first = rig.dir.decide({ actor: A, emotion: emotion({ resentfulColdness: 1 }, { toward: [B] }) }) as DramaApproval;
    rig.act({ actId: first.actId, verb: first.verb, actor: A, with: B, outcome: "landed" });
    expect(rig.dir.decide({ actor: A, emotion: emotion({ resentfulColdness: 1 }, { toward: [C] }) })).toEqual({ kind: "pass", why: "pace" });
    await rig.clock.advance(6_000);
    expect(rig.dir.decide({ actor: A, emotion: emotion({ resentfulColdness: 1 }, { toward: [C] }) })).toMatchObject({ kind: "initiate", with: C });
  });

  it("[SCN-1] in free play the director never starts a rung 4 act, nor a kill, however hot the emotion", async () => {
    const rig = makeRig();
    const hot = emotion({ dominanceAssertion: 1, impulsiveProvocation: 1, resentfulColdness: 1, contemptuousDismissal: 1, defensiveness: 1 }, { toward: [B] });
    const verbs: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = rig.dir.decide({ actor: A, emotion: hot });
      if (d.kind === "initiate") {
        verbs.push(d.verb);
        rig.act({ actId: d.actId, verb: d.verb, actor: A, with: B, outcome: "landed" });
      }
      await rig.clock.advance(61_000);
    }
    expect(verbs.length).toBeGreaterThan(0);
    expect(verbs.every((v) => ["glare", "insult", "shove", "turn_back"].includes(v))).toBe(true);
  });

  it("[GATE-6] [GATE-2] never starts violence at a human who has not opted in, nor contact in a calm room", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.state({ optIn: [], calm: true });
    const hot = emotion({ dominanceAssertion: 1, impulsiveProvocation: 1, resentfulColdness: 1 }, { toward: [H] });
    const d = rig.dir.decide({ actor: A, emotion: hot });
    expect(d).toMatchObject({ kind: "initiate", verb: expect.stringMatching(/glare|turn_back/) });
  });

  it("[LAD-11] an autonomous beat of rung 4 or more is not started with nobody in earshot", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.world.remove(C);
    rig.world.remove(H);
    rig.act({ actId: "p1", verb: "shove", actor: A, with: B, outcome: "landed" });
    await rig.clock.advance(21_000);
    const d = rig.dir.decide({ actor: A, emotion: emotion({ dominanceAssertion: 1 }, { toward: [B] }) });
    expect(d.kind === "initiate" ? d.rung ?? 0 : 0).toBeLessThanOrEqual(3);
  });
});

describe("the scenario block and the switches", () => {
  const authored = (rig: Rig, verb: ActVerb, target: number, skip = true): DramaDecision => rig.dir.decide({ actor: A, proposal: { verb, with: target, origin: "scenario", ...(skip ? { authoredSkip: true } : {}) } });

  it("[SCN-3] max_rung, may_target and may_die decide in that order, and @human stands for any opted-in human", () => {
    const block: ScenarioDrama = { max_rung: 6, may_target: [["person-1", "@human"]], may_die: ["@human"], permadeath: false };
    const rig = makeRig({ block });
    expect(authored(rig, "slap", H)).toMatchObject({ kind: "approve" });
    expect(authored(makeRig({ block }), "slap", B)).toMatchObject({ kind: "veto", detail: "may_target" });
    expect(authored(makeRig({ block }), "kill", H)).toMatchObject({ kind: "approve" });
    expect(authored(makeRig({ block: { ...block, may_die: [] } }), "kill", H)).toMatchObject({ kind: "veto", detail: "may_die" });
    expect(authored(makeRig({ block: { ...block, max_rung: 3 } }), "slap", H, false)).toMatchObject({ kind: "veto", detail: "max_rung" });
  });

  it("[SCN-3] a standalone die needs the actor in may_die", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    expect(rig.dir.decide({ actor: B, proposal: { verb: "die", origin: "scenario" } })).toMatchObject({ kind: "approve", verb: "die" });
    expect(rig.dir.decide({ actor: A, proposal: { verb: "die", origin: "scenario" } })).toMatchObject({ kind: "veto", detail: "may_die" });
    expect(makeRig().dir.decide({ actor: B, proposal: { verb: "die", origin: "scenario" } })).toMatchObject({ kind: "veto", detail: "free_play" });
  });

  it("[SCN-4] [SCN-2] drama:{} lets an authored skip through up to rung 3 and no further", () => {
    const rig = makeRig({ block: { max_rung: 3, may_target: [], may_die: [], permadeath: false } });
    expect(authored(rig, "shove", B)).toMatchObject({ kind: "approve", skippedRungs: ["glare", "insult"] });
    expect(authored(makeRig({ block: { max_rung: 3, may_target: [], may_die: [], permadeath: false } }), "slap", B)).toMatchObject({ kind: "veto", detail: "skip" });
  });

  it("[SAFE-2] with the runtime switch off every proposal is a kill_switch veto and the director starts nothing; on again, it resumes", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.state({ enabled: false });
    expect(ask(rig, A, "glare", B, emotion({ resentfulColdness: 1 }))).toMatchObject({ kind: "veto", reason: "kill_switch", rule: "GATE-1" });
    expect(rig.dir.decide({ actor: C, emotion: emotion({ resentfulColdness: 1 }) })).toEqual({ kind: "pass", why: "no_drive" });
    expect(rig.link.acts).toHaveLength(0);
    rig.state({ enabled: true });
    expect(ask(rig, A, "glare", B, emotion({ resentfulColdness: 1 }))).toMatchObject({ kind: "approve" });
  });

  it("[NEG-5] is inert on a dialect 1 link and before any session, and sends nothing", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.link.dialect = 1;
    expect(ask(rig, A, "glare", B, emotion({ resentfulColdness: 1 }))).toEqual({ kind: "pass", why: "inert" });
    expect(rig.dir.active).toBe(false);
    const none = makeRig({ block: WIDE_BLOCK, session: null });
    expect(none.dir.active).toBe(false);
    expect(none.dir.advanceScene("x")).toEqual({ kind: "refused", why: "inert" });
    expect(none.link.acts).toHaveLength(0);
  });

  it("[ACT-4] never sends a value outside the ranges: a bad intensity or a line on a verb that has none is unsent", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    expect(rig.dir.decide({ actor: A, proposal: { verb: "glare", with: B, origin: "scenario", intensity: 1.5 } })).toMatchObject({ kind: "unsent", cause: "invalid", error: { code: "bad_message", detail: "act.intensity" } });
    expect(rig.dir.decide({ actor: A, proposal: { verb: "glare", with: B, origin: "scenario", text: "hi" } })).toMatchObject({ kind: "unsent", error: { detail: "act.text" } });
    expect(rig.dir.decide({ actor: A, proposal: { verb: "insult", with: B, origin: "scenario", text: "x".repeat(201) } })).toMatchObject({ kind: "unsent", error: { detail: "act.text" } });
    expect(rig.dir.decide({ actor: A, proposal: { verb: "cry", with: B, origin: "scenario" } })).toMatchObject({ kind: "unsent", error: { code: "target_forbidden" } });
    expect(rig.link.acts).toHaveLength(0);
  });

  it("every one of the 18 verbs has a decision that is one of the five kinds", () => {
    for (const verb of ACT_VERBS) {
      const rig = makeRig({ block: WIDE_BLOCK });
      const d = rig.dir.decide({ actor: A, proposal: { verb, ...(["die", "recoil", "freeze_gasp", "cry", "storm_off", "tableau", "faint"].includes(verb) ? {} : { with: B }), origin: "scenario", authoredSkip: true } });
      expect(["approve", "veto", "pass", "unsent", "initiate"]).toContain(d.kind);
    }
  });
});
