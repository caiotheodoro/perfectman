/**
 * The engine side of the cinematic revamp (agent B2): the pressure floor, LAD-10 aging, the unlock that outlasts its climb, authored acts and the new verbs at GATE-5, and the owner's
 * decision that a human can be the target of an act without the consent chip (`may_target_humans`), with the player's Block, the rate limit and the director's own cap kept.
 */
import { describe, expect, it } from "vitest";
import { HUMAN_TARGETS_ENV, compileDramaForm, dramaForAuthoredActs, resolveRunDrama, cleanDramaExt, FREE_PLAY_DRAMA } from "../authoring/scenario-drama.js";
import type { ScenarioDrama } from "../authoring/scenario-drama.js";
import { hotelReadsBlock } from "../testing/hotel-block-read.js";
import { ProvocationLedger } from "../director/drama/provocation.js";
import { hasGrievance, motive, pressureFloor, volition } from "../director/drama/pressure.js";
import { DEFAULT_DRAMA_TUNING } from "../director/drama/tuning.js";
import type { RelationReading } from "../director/drama/ports.js";
import { A, B, C, H, WIDE_BLOCK, emotion, makeRig } from "../testing/drama-rig.js";

const T = DEFAULT_DRAMA_TUNING;
const COLD: RelationReading = { resentment: 0.16, threat: 0, envy: 0, suspicion: 0, lastNegativeAt: null };
const emo = emotion({}, { toward: [B] });

describe("the pressure floor", () => {
  it("is 0 with no climax deadline, rises from a tenth of it, and is 0.8 at the deadline", () => {
    expect(pressureFloor(200_000, undefined, T)).toBe(0);
    expect(pressureFloor(20_000, 240_000, T)).toBe(0);
    expect(pressureFloor(130_000, 240_000, T)).toBeCloseTo(0.8 * ((130 / 240 - 0.1) / 0.9), 5);
    expect(pressureFloor(240_000, 240_000, T)).toBeCloseTo(0.8, 5);
    expect(pressureFloor(900_000, 240_000, T)).toBeCloseTo(0.8, 5);
    expect(pressureFloor(240_000, 240_000, T, 0.5)).toBe(0.5);
  });

  it("lifts the volition of a pair with heat, up to the slap, and no other (run 63: insult v 0.36 against theta 0.52)", () => {
    expect(volition("insult", emo, COLD, T)).toBeLessThan(0.45);
    expect(volition("insult", emo, COLD, T, 0.6)).toBe(0.6);
    expect(volition("slap", emo, COLD, T, 0.75)).toBe(0.75);
    expect(volition("punch", emo, COLD, T, 0.8)).toBe(0); // above the climb's ceiling: the author's
    expect(volition("kill", emo, COLD, T, 0.8)).toBe(0);
    // No heat, no floor: nothing was said, no unlock, resentment under 0.1.
    expect(volition("insult", emo, { ...COLD, resentment: 0.05 }, T, 0.8)).toBe(0);
    expect(volition("insult", emo, undefined, T, 0.8)).toBe(0);
  });

  it("stands in for the grievance only late in the ramp and only with heat", () => {
    expect(hasGrievance("insult", COLD, 0, T, 0)).toBe(false);
    expect(hasGrievance("insult", COLD, 0, T, 0.3)).toBe(false);
    expect(hasGrievance("insult", COLD, 0, T, 0.5)).toBe(true);
    expect(hasGrievance("insult", { ...COLD, resentment: 0 }, 0, T, 0.8)).toBe(false);
    expect(motive("shove", emo, COLD, 0, T, 0.7)).toMatchObject({ ok: true });
    expect(motive("shove", emo, COLD, 0, T, 0)).toMatchObject({ ok: false, why: "volition" });
  });

  it("the director's own beat climbs on the floor and a model's proposal does not read it", async () => {
    const rig = makeRig({ block: WIDE_BLOCK, climaxAtMs: 240_000 });
    const cold = emotion({}, { toward: [B], relation: { resentment: 0.16 } });
    expect(rig.dir.decide({ actor: A, emotion: cold })).toMatchObject({ kind: "pass" });
    await rig.clock.advance(150_000);
    expect(rig.dir.decide({ actor: A, emotion: cold })).toMatchObject({ kind: "initiate", verb: "glare", with: B });
    // The same glare as the model's proposal is judged on the feelings: refused on the motive.
    const model = makeRig({ block: WIDE_BLOCK, climaxAtMs: 240_000 });
    await model.clock.advance(150_000);
    expect(model.dir.decide({ actor: C, proposal: { verb: "insult", with: B, origin: "model" }, emotion: cold })).toMatchObject({ kind: "veto", rule: "LAD-6" });
  });

  it("a scene with no climax deadline has no floor, however long it runs", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    await rig.clock.advance(600_000);
    expect(rig.dir.decide({ actor: A, emotion: emotion({}, { toward: [B], relation: { resentment: 0.16 } }) })).toEqual({ kind: "pass", why: "no_drive" });
    expect(rig.dir.pressure()).toBe(0);
  });
});

describe("LAD-10 ages out", () => {
  it("the shove of the first minute no longer shuts the second actor's rung out 90 s later", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.world.cast = 3;
    const hot = emotion({ dominanceAssertion: 0.9, impulsiveProvocation: 0.9, contemptuousDismissal: 0.9, jealousInspection: 0.9, resentfulColdness: 0.9, defensiveness: 0.9 }, { toward: [B] });
    const land = (actId: string, verb: "glare" | "insult" | "shove", actor: number): void => rig.act({ actId, verb, actor, with: B, origin: "director", outcome: "landed" });
    // A reaches the shove (rung 3) in the first minute; C has only reached the insult.
    for (const [i, verb] of (["glare", "insult", "shove"] as const).entries()) {
      land(`a${i}`, verb, A);
      await rig.clock.advance(25_000);
    }
    land("c1", "glare", C);
    await rig.clock.advance(25_000);
    land("c2", "insult", C);
    await rig.clock.advance(25_000);
    const ask = (): ReturnType<typeof rig.dir.decide> => rig.dir.decide({ actor: C, proposal: { verb: "shove", with: B, origin: "model" }, emotion: hot });
    expect(ask()).toMatchObject({ kind: "veto", rule: "LAD-10", detail: "contagion" });
    await rig.clock.advance(40_000);
    expect(ask()).toMatchObject({ kind: "approve", verb: "shove" });
  });

  it("with the age off (0) the old cap holds for the whole scene", async () => {
    const rig = makeRig({ block: WIDE_BLOCK, tuning: { ...T, contagion: { ...T.contagion, ageMs: 0 } } });
    rig.world.cast = 3;
    const hot = emotion({ dominanceAssertion: 0.9, impulsiveProvocation: 0.9, contemptuousDismissal: 0.9, jealousInspection: 0.9, resentfulColdness: 0.9, defensiveness: 0.9 }, { toward: [B] });
    for (const [i, verb] of (["glare", "insult", "shove"] as const).entries()) {
      rig.act({ actId: `a${i}`, verb, actor: A, with: B, origin: "director", outcome: "landed" });
      await rig.clock.advance(25_000);
    }
    for (const [i, verb] of (["glare", "insult"] as const).entries()) {
      rig.act({ actId: `c${i}`, verb, actor: C, with: B, origin: "director", outcome: "landed" });
      await rig.clock.advance(25_000);
    }
    await rig.clock.advance(300_000);
    expect(rig.dir.decide({ actor: C, proposal: { verb: "shove", with: B, origin: "model" }, emotion: hot })).toMatchObject({ kind: "veto", rule: "LAD-10" });
  });
});

describe("the unlock outlasts its climb", () => {
  const ledger = (): { l: ProvocationLedger; at: { now: number } } => {
    const at = { now: 0 };
    return { l: new ProvocationLedger(() => T.provocation, () => at.now, (a, b) => a !== b), at };
  };

  it("a slap unlocked at 0 s is still open at 100 s and 130 s when the aggressor has climbed a rung every 25 s; the old 90 s hold would have lapsed", () => {
    const { l, at } = ledger();
    expect(l.unlock("person-1", "person-2", "slap")).toBe("granted");
    for (const [i, rung] of [1, 2, 3].entries()) {
      at.now = (i + 1) * 25_000;
      l.consume("person-1", "person-2", rung);
    }
    at.now = 100_000;
    expect(l.unlockedRung("person-1", "person-2")).toBe(4);
    at.now = 130_000;
    expect(l.unlockedRung("person-1", "person-2")).toBe(4);
    // The blow it was for ends it.
    l.consume("person-1", "person-2", 4);
    expect(l.unlockedRung("person-1", "person-2")).toBeUndefined();
  });

  it("without progress it lapses after the hold: 120 s, not forever", () => {
    const { l, at } = ledger();
    l.unlock("person-1", "person-2", "shove");
    at.now = 119_000;
    expect(l.unlockedRung("person-1", "person-2")).toBe(3);
    at.now = 121_000;
    expect(l.unlockedRung("person-1", "person-2")).toBeUndefined();
    expect(T.provocation.unlock.holdMs).toBeGreaterThanOrEqual(90_000);
  });
});

describe("GATE-5 for authored acts and the verbs of the next table", () => {
  const free: ScenarioDrama = { max_rung: 3, may_target: [], may_die: [], permadeath: false };

  it("dramaForAuthoredActs widens a block just enough for a sheet's punch, kill and die", () => {
    const block = dramaForAuthoredActs(free, [
      { actor: "person-1", verb: "punch", with: "person-2" },
      { actor: "person-1", verb: "kill", with: "person-3" },
      { actor: "person-3", verb: "die" },
      { actor: "person-2", verb: "point", with: "person-1" },
      { actor: "person-1", verb: "punch", with: "person-2" },
    ]);
    expect(block).toEqual({ max_rung: 6, may_target: [["person-1", "person-2"], ["person-1", "person-3"]], may_die: ["person-3"], permadeath: false });
    // Never narrower, never a pair added for a rung under 4.
    expect(dramaForAuthoredActs(WIDE_BLOCK, [{ actor: "person-1", verb: "shove", with: "person-2" }])).toEqual(WIDE_BLOCK);
    expect(dramaForAuthoredActs(free, [{ actor: "person-1", verb: "insult", with: "person-2" }]).may_target).toEqual([]);
    expect(hotelReadsBlock({ drama: block }).kind).toBe("valid");
  });

  it("a sheet's punch, kill and die pass the gates of the block it implies, and are refused without it", async () => {
    const acts = [
      { actor: "person-1", verb: "punch", with: "person-2" },
      { actor: "person-1", verb: "kill", with: "person-2" },
      { actor: "person-2", verb: "die" },
    ] as const;
    const block = dramaForAuthoredActs(free, acts);
    const withBlock = makeRig({ block });
    for (const a of acts) {
      const actor = a.actor === "person-1" ? A : B;
      const d = withBlock.dir.decide({ actor, proposal: { verb: a.verb, ...("with" in a ? { with: B } : {}), origin: "scenario", authoredSkip: true } });
      expect(d, `${a.verb}`).toMatchObject({ kind: "approve", verb: a.verb });
      withBlock.act({ actId: (d as { actId: string }).actId, verb: a.verb, actor, ...("with" in a ? { with: B } : {}), origin: "scenario", outcome: "landed" });
      await withBlock.clock.advance(25_000);
    }
    const bare = makeRig({ block: free });
    expect(bare.dir.decide({ actor: A, proposal: { verb: "punch", with: B, origin: "scenario", authoredSkip: true } })).toMatchObject({ kind: "veto", rule: "GATE-5" });
    expect(bare.dir.decide({ actor: B, proposal: { verb: "die", origin: "scenario" } })).toMatchObject({ kind: "veto", rule: "GATE-5", detail: "may_die" });
  });

  it("the seven new verbs are known to the code but refused with unknown_verb until the hotel's table carries them", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    for (const verb of ["point", "grab", "push_away", "plead"] as const) expect(rig.dir.decide({ actor: A, proposal: { verb, with: B, origin: "scenario" } }), verb).toMatchObject({ kind: "unsent", cause: "invalid", error: { code: "unknown_verb" } });
    for (const verb of ["slump", "kneel", "flee"] as const) expect(rig.dir.decide({ actor: A, proposal: { verb, origin: "scenario" } }), verb).toMatchObject({ kind: "unsent", cause: "invalid", error: { code: "unknown_verb" } });
  });
});

describe("humans without the consent chip (may_target_humans)", () => {
  const slapBlock: ScenarioDrama = { ...WIDE_BLOCK };
  const shoveHuman = (rig: ReturnType<typeof makeRig>, actor = A): ReturnType<typeof rig.dir.decide> => rig.dir.decide({ actor, proposal: { verb: "shove", with: H, origin: "model" }, emotion: emotion({ dominanceAssertion: 0.9, impulsiveProvocation: 0.9, defensiveness: 0.9 }, { toward: [H] }) });
  const readyForShove = async (rig: ReturnType<typeof makeRig>): Promise<void> => {
    rig.act({ actId: "g", verb: "glare", actor: A, with: H, origin: "director", outcome: "landed" });
    await rig.clock.advance(30_000);
    rig.act({ actId: "i", verb: "insult", actor: A, with: H, origin: "director", outcome: "landed" });
    await rig.clock.advance(30_000);
  };

  it("the chip gate is still the default of a scene that turns the flag off: a human who did not opt in is refused (consent_off)", async () => {
    const rig = makeRig({ block: slapBlock, humans: false });
    rig.state({ optIn: [] });
    await readyForShove(rig);
    expect(shoveHuman(rig)).toMatchObject({ kind: "veto", reason: "consent_off", rule: "GATE-6" });
  });

  it("with the flag on a human who did not opt in is a target with no chip, and the act is on the ledger with no chip open", async () => {
    const rig = makeRig({ block: slapBlock, humans: true });
    rig.state({ optIn: [] });
    await readyForShove(rig);
    expect(shoveHuman(rig)).toMatchObject({ kind: "approve", verb: "shove", with: H });
  });

  it("the player's Block holds with the flag on, and with the human opted in: a blocked actor never targets the blocker, another actor still can", async () => {
    const rig = makeRig({ block: slapBlock, humans: true, blocks: (human, actor) => human === H && actor === A });
    rig.state({ optIn: [H] });
    await readyForShove(rig);
    expect(shoveHuman(rig)).toMatchObject({ kind: "veto", reason: "consent_off", rule: "GATE-6", detail: "blocked" });
    const insult = rig.dir.decide({ actor: A, proposal: { verb: "insult", with: H, origin: "model" }, emotion: emotion({ impulsiveProvocation: 0.9 }, { toward: [H] }) });
    expect(insult).toMatchObject({ kind: "veto", rule: "GATE-6" });
  });

  it("the rate limit of violent acts at humans still holds (GATE-3)", async () => {
    const rig = makeRig({ block: slapBlock, humans: true, session: { enabled: true, chipTtlMs: 4000, harmMax: 1, harmWindowS: 300, dead: [] } });
    rig.state({ optIn: [] });
    rig.act({ actId: "h1", verb: "insult", actor: C, with: H, origin: "director", outcome: "landed" });
    await rig.clock.advance(30_000);
    expect(rig.dir.decide({ actor: A, proposal: { verb: "insult", with: H, origin: "model" }, emotion: emotion({ impulsiveProvocation: 0.9 }, { toward: [H] }) })).toMatchObject({ kind: "veto", reason: "rate_limit" });
  });

  it("the director's own beats never go above an insult at a human, however hot the actor is", async () => {
    const rig = makeRig({ block: slapBlock, humans: true });
    rig.state({ optIn: [] });
    const hot = emotion({ dominanceAssertion: 0.95, impulsiveProvocation: 0.95, contemptuousDismissal: 0.95, jealousInspection: 0.95, resentfulColdness: 0.95, defensiveness: 0.9 }, { toward: [H], relation: { resentment: 0.9, lastNegativeAt: rig.clock.now() - 1000 } });
    const verbs: string[] = [];
    for (let t = 0; t < 300_000; t += 5000) {
      const d = rig.dir.decide({ actor: A, emotion: hot });
      if (d.kind === "initiate") {
        verbs.push(d.verb);
        rig.act({ actId: d.actId, verb: d.verb, actor: A, with: H, origin: "director", outcome: "landed" });
      }
      await rig.clock.advance(5000);
    }
    expect(verbs.length).toBeGreaterThan(0);
    expect(verbs.filter((v) => ["shove", "slap", "punch", "kill"].includes(v))).toEqual([]);
    expect(verbs).toContain("insult");
  });

  it("the scene spine never unlocks a human: the ledger refuses a pair the cast's own refs do not name", () => {
    const l = new ProvocationLedger(() => T.provocation, () => 0, (a, b) => a.startsWith("person-") && b.startsWith("person-"));
    expect(l.unlock("person-1", "@human", "shove")).toBe("skipped");
    expect(l.unlock("person-1", "h:9", "slap")).toBe("skipped");
  });

  it("reads off with PERFECTMAN_HUMAN_TARGETS=0, with drama.may_target_humans:false, and with drama off; on otherwise", () => {
    expect(resolveRunDrama({}, {}).humansTargetable).toBe(true);
    expect(resolveRunDrama({}, { [HUMAN_TARGETS_ENV]: "0" }).humansTargetable).toBe(false);
    expect(resolveRunDrama({}, { [HUMAN_TARGETS_ENV]: "1" }).humansTargetable).toBe(true);
    expect(resolveRunDrama({ drama_ext: { may_target_humans: false } }, {}).humansTargetable).toBe(false);
    expect(resolveRunDrama({ drama_ext: { may_target_humans: true } }, { [HUMAN_TARGETS_ENV]: "0" }).humansTargetable).toBe(false);
    expect(resolveRunDrama({ drama: FREE_PLAY_DRAMA, drama_mode: "off" }, {}).humansTargetable).toBe(false);
  });

  it("the flag rides beside the hotel's block, never inside it: the hotel still reads the block as valid", () => {
    const out = compileDramaForm({ max_rung: "slap", may_target_humans: false, pressure_floor: { climax_at_ms: 240_000 } }, { names: ["Ana"], ids: ["person-1"] });
    expect(out.errors).toEqual([]);
    expect(out.ext).toEqual({ may_target_humans: false, pressure_floor: { climax_at_ms: 240_000 } });
    expect(Object.keys(out.drama!)).toEqual(["max_rung", "may_target", "may_die", "permadeath"]);
    expect(hotelReadsBlock({ drama: out.drama }).kind).toBe("valid");
    expect(compileDramaForm({ may_target_humans: "no" }, { names: [], ids: [] }).errors[0]?.path).toBe("drama.may_target_humans");
    expect(compileDramaForm({ pressure_floor: { climax_at_ms: -1 } }, { names: [], ids: [] }).errors[0]?.path).toBe("drama.pressure_floor");
    expect(cleanDramaExt({ may_target_humans: 1, pressure_floor: { climax_at_ms: 240_000, max: 0.6 }, junk: 1 })).toEqual({ pressure_floor: { climax_at_ms: 240_000, max: 0.6 } });
  });
});
