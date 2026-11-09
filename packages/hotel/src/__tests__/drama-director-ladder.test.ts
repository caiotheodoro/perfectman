import { describe, expect, it } from "vitest";
import type { ActVerb } from "@perfectman/shared";
import { makeActIds } from "../director/drama/director.js";
import type { DramaApproval, DramaDecision } from "../director/drama/ports.js";
import { A, B, C, H, ROOM, RUN, WIDE_BLOCK, emotion, makeRig } from "../testing/drama-rig.js";
import type { Rig } from "../testing/drama-rig.js";

const HOT = emotion({ dominanceAssertion: 1, impulsiveProvocation: 1, resentfulColdness: 1, contemptuousDismissal: 1 });

function approved(d: DramaDecision): DramaApproval {
  expect(d).toMatchObject({ kind: expect.stringMatching(/approve|initiate/) });
  return d as DramaApproval;
}

/** The hotel's side of an act the director sent: accepted, run, done. */
function settle(rig: Rig, d: DramaApproval, outcome: "landed" | "dodged" | "declined" | "aborted" = "landed", extra: { chip?: boolean; answer?: "take" | "dodge" | "push_back" | "timeout" } = {}): void {
  rig.act({ actId: d.actId, verb: d.verb, actor: d.actor, ...(d.with !== undefined ? { with: d.with } : {}), outcome, ...extra });
}

const ask = (rig: Rig, actor: number, verb: ActVerb, target?: number, over: Partial<{ origin: "model" | "scenario"; authoredSkip: boolean }> = {}): DramaDecision =>
  rig.dir.decide({ actor, proposal: { verb, ...(target !== undefined ? { with: target } : {}), origin: over.origin ?? "model", ...(over.authoredSkip ? { authoredSkip: true } : {}) }, emotion: HOT });

describe("the ladder (LAD-1 to LAD-4, LAD-7, LAD-11)", () => {
  it("[LAD-1] climbs glare, insult, shove, slap one rung at a time and refuses a jump", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    expect(ask(rig, A, "shove", B)).toMatchObject({ kind: "veto", reason: "ladder", detail: "rung" });
    for (const verb of ["glare", "insult", "shove"] as const) {
      settle(rig, approved(ask(rig, A, verb, B)));
      await rig.clock.advance(21_000);
    }
    expect(ask(rig, A, "punch", B)).toMatchObject({ kind: "veto", reason: "ladder", detail: "rung" });
    expect(ask(rig, A, "slap", B)).toMatchObject({ kind: "approve", rung: 4 });
  });

  it("[LAD-1] opens a scene with insult, and moving down is always legal", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    settle(rig, approved(ask(rig, A, "insult", B)));
    rig.act({ actId: "p1", verb: "shove", actor: A, with: B, outcome: "landed" });
    await rig.clock.advance(61_000);
    expect(ask(rig, A, "glare", B)).toMatchObject({ kind: "approve", rung: 1 });
  });

  it("[LAD-2] an authored skip passes with scenario origin and a block, and names the rungs it jumped", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    const d = approved(ask(rig, A, "slap", B, { origin: "scenario", authoredSkip: true }));
    expect(d).toMatchObject({ origin: "scenario", authoredSkip: true, skippedRungs: ["glare", "insult", "shove"] });
    expect(rig.link.acts[0]?.cmd).toMatchObject({ origin: "scenario", authored_skip: true });
  });

  it("[LAD-2] the same flag from the model, or with no block at all, is no_scenario_gate skip", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    expect(ask(rig, A, "slap", B, { authoredSkip: true })).toMatchObject({ kind: "veto", reason: "no_scenario_gate", detail: "skip" });
    const free = makeRig();
    expect(ask(free, A, "shove", B, { origin: "scenario", authoredSkip: true })).toMatchObject({ kind: "veto", detail: "skip" });
    const empty = makeRig({ block: { max_rung: 3, may_target: [], may_die: [], permadeath: false } });
    expect(ask(empty, A, "shove", B, { origin: "scenario", authoredSkip: true })).toMatchObject({ kind: "approve" });
  });

  it("[LAD-3] holds a second physical beat back for 20 s of one scene and releases it at 20 s", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    settle(rig, approved(ask(rig, A, "insult", B)));
    settle(rig, approved(ask(rig, C, "shove", B, { origin: "scenario", authoredSkip: true })));
    await rig.clock.advance(19_900);
    expect(ask(rig, A, "shove", B)).toMatchObject({ kind: "veto", reason: "budget", detail: "physical" });
    await rig.clock.advance(100);
    expect(ask(rig, A, "shove", B)).toMatchObject({ kind: "approve" });
  });

  it("[LAD-3] a scene_cut starts a fresh scene at once, which resets the spacing", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    settle(rig, approved(ask(rig, C, "shove", B, { origin: "scenario", authoredSkip: true })));
    rig.cut({ scene: "7.2", prev: "7.1" });
    settle(rig, approved(ask(rig, A, "insult", B)));
    expect(ask(rig, A, "shove", B)).toMatchObject({ kind: "approve" });
  });

  it("[LAD-4] one kill per scene, counted at send whatever its outcome, and a new scene allows another", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    settle(rig, approved(ask(rig, A, "punch", B, { origin: "scenario", authoredSkip: true })), "landed");
    await rig.clock.advance(21_000);
    settle(rig, approved(ask(rig, A, "kill", B, { origin: "scenario" })), "dodged");
    await rig.clock.advance(61_000);
    expect(ask(rig, A, "kill", B, { origin: "scenario" })).toMatchObject({ kind: "veto", reason: "budget", detail: "kill" });
    rig.cut({ scene: "7.2", prev: "7.1" });
    expect(ask(rig, A, "kill", B, { origin: "scenario", authoredSkip: true })).toMatchObject({ kind: "approve", verb: "kill" });
  });

  it("[LAD-7] a restrain that lands on the aggressor, and the aggressor's own turn_back, bring the rung down to 2", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    settle(rig, approved(ask(rig, A, "slap", B, { origin: "scenario", authoredSkip: true })));
    expect(rig.dir.snapshot().highestRung).toBe(4);
    settle(rig, approved(ask(rig, C, "restrain", A)));
    expect(rig.dir.snapshot().highestRung).toBe(2);
    await rig.clock.advance(21_000);
    expect(ask(rig, A, "shove", B)).toMatchObject({ kind: "approve" });

    const other = makeRig({ block: WIDE_BLOCK });
    settle(other, approved(ask(other, A, "punch", B, { origin: "scenario", authoredSkip: true })));
    settle(other, approved(ask(other, A, "turn_back", B)));
    expect(other.dir.snapshot().highestRung).toBe(2);
  });

  it("[LAD-11] an autonomous slap with nobody in earshot is refused, an authored one is not, and a human counts", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.world.remove(C);
    rig.world.remove(H);
    rig.act({ actId: "p1", verb: "shove", actor: B, with: A, outcome: "landed" });
    rig.act({ actId: "p2", verb: "shove", actor: A, with: B, outcome: "landed" });
    expect(ask(rig, A, "slap", B)).toMatchObject({ kind: "veto", reason: "ladder", detail: "zero_witness" });
    rig.world.put(H, { human: true, tile: [4, 5] });
    expect(ask(rig, A, "slap", B)).toMatchObject({ kind: "veto", detail: expect.not.stringMatching(/zero_witness/) });
    rig.world.remove(H);
    await rig.clock.advance(21_000);
    expect(ask(rig, A, "slap", B, { origin: "scenario" })).toMatchObject({ kind: "approve", verb: "slap" });
  });
});

describe("reservations and the chips (RSV-1, GATE-3, GATE-10, CHIP-9)", () => {
  it("[RSV-1] a blocked act is not an act: the hotel's act_done{blocked} gives the budget back", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    settle(rig, approved(ask(rig, A, "insult", B)));
    const shove = approved(ask(rig, A, "shove", B));
    expect(ask(rig, C, "shove", B, { origin: "scenario", authoredSkip: true })).toMatchObject({ reason: "budget" });
    rig.act({ actId: shove.actId, verb: "shove", actor: A, with: B, outcome: "blocked", reason: "consent_off" });
    expect(ask(rig, C, "shove", B, { origin: "scenario", authoredSkip: true })).toMatchObject({ kind: "approve" });
  });

  it("[RSV-1] a dodge releases the harm reservation but never the spacing, the cooldown or the rung", async () => {
    const rig = makeRig({ block: WIDE_BLOCK, session: { enabled: true, chipTtlMs: 4000, harmMax: 2, harmWindowS: 300, dead: [] } });
    settle(rig, approved(ask(rig, A, "insult", H)));
    const first = approved(ask(rig, C, "shove", H, { origin: "scenario", authoredSkip: true }));
    expect(ask(rig, A, "shove", H)).toMatchObject({ reason: "rate_limit" });
    settle(rig, first, "dodged", { chip: true, answer: "dodge" });
    await rig.clock.advance(21_000);
    expect(ask(rig, A, "shove", H)).toMatchObject({ kind: "veto", reason: "cooldown", detail: "chip_cooldown" });
    expect(rig.dir.snapshot().highestRung).toBeGreaterThanOrEqual(3);
  });

  it("[GATE-3] the room's pause blocks violence at humans but not hug, and actor-to-actor still runs", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.state({ paused: true, pausedUntil: 1 });
    expect(ask(rig, A, "insult", H)).toMatchObject({ kind: "veto", reason: "rate_limit" });
    expect(ask(rig, C, "hug", H)).toMatchObject({ kind: "approve" });
    expect(ask(rig, B, "insult", A)).toMatchObject({ kind: "approve" });
  });

  it("[GATE-10] the same verb on the same target waits 60 s, then goes", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    settle(rig, approved(ask(rig, A, "glare", B)));
    await rig.clock.advance(59_000);
    expect(ask(rig, A, "glare", B)).toMatchObject({ kind: "veto", reason: "cooldown", detail: "verb" });
    await rig.clock.advance(1000);
    expect(ask(rig, A, "glare", B)).toMatchObject({ kind: "approve" });
  });

  it("[CHIP-9] an open chip blocks a second act at that human, an answered one does not, and a dodge leaves them alone for 60 s", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    const hug = approved(ask(rig, A, "hug", H));
    expect(ask(rig, C, "kiss", H)).toMatchObject({ kind: "veto", reason: "cooldown", detail: "chip_busy" });
    rig.hotel([{ t: "drama_consent", run: RUN, room: ROOM, act_id: hug.actId, phase: "answered", actor: A, with: H, verb: "hug", family: "affection", answer: "dodge", at: 1 }]);
    settle(rig, approved(ask(rig, C, "kiss", H)), "landed", { chip: true, answer: "take" });
    settle(rig, hug, "dodged", { chip: true, answer: "dodge" });
    rig.world.put(B, { tile: [4, 6] });
    await rig.clock.advance(59_000);
    expect(ask(rig, B, "hug", H)).toMatchObject({ kind: "veto", detail: "chip_cooldown" });
    await rig.clock.advance(2000);
    expect(ask(rig, B, "hug", H)).toMatchObject({ kind: "approve" });
  });
});

describe("who may act (ACT-5, ACT-9 to ACT-13, TGT-1)", () => {
  it("[ACT-5] act ids are unique across 10 000 draws and inside the pattern", () => {
    const next = makeActIds();
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(next());
    expect(seen.size).toBe(10_000);
    expect([...seen].every((id) => /^[A-Za-z0-9_.:-]{1,32}$/.test(id))).toBe(true);
  });

  it("[ACT-5] a retry after a refused send takes a new id", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.link.hasLease = false;
    expect(ask(rig, A, "glare", B)).toMatchObject({ kind: "unsent", cause: "no_lease" });
    rig.link.hasLease = true;
    const d = approved(ask(rig, A, "glare", B));
    expect(d.actId).toBe("d2");
  });

  it("[ACT-9] never targets itself, the narrator or a human with restrain", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    expect(ask(rig, A, "glare", A)).toMatchObject({ kind: "unsent", error: { code: "bad_target", detail: "self" } });
    expect(ask(rig, A, "glare", -(RUN * 100))).toMatchObject({ kind: "unsent", error: { code: "bad_target", detail: "narrator" } });
    expect(ask(rig, A, "restrain", H)).toMatchObject({ kind: "unsent", error: { code: "bad_target", detail: "kind" } });
  });

  it("[ACT-10] re-checks the mirror's room: a target that is not there is not asked for", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.world.put(B, { room: 99 });
    expect(ask(rig, A, "glare", B)).toEqual({ kind: "pass", why: "target_gone" });
    expect(rig.link.acts).toHaveLength(0);
  });

  it("[ACT-11] a dead actor, from actor_death or hello.drama.dead, proposes nothing; a revive brings it back", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.hotel([{ t: "actor_death", run: RUN, room: ROOM, actor: A, cause: "die", act_id: "x", scene: rig.dir.scene, at: 1 }]);
    expect(ask(rig, A, "glare", B)).toEqual({ kind: "pass", why: "actor_dead" });
    rig.cut({ scene: "7.2", prev: "7.1", revived: [A] });
    expect(ask(rig, A, "glare", B)).toMatchObject({ kind: "approve" });
    rig.dir.onSession({ enabled: true, chipTtlMs: 4000, harmMax: 3, harmWindowS: 300, dead: [C] });
    expect(ask(rig, C, "glare", B)).toEqual({ kind: "pass", why: "actor_dead" });
  });

  it("[ACT-12] [TGT-1] an actor is busy from send to act_done, and so is the locked actor target of a contact verb", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    const d = approved(ask(rig, A, "hug", B));
    expect(rig.dir.busyActId(A)).toBe(d.actId);
    expect(rig.dir.busyActId(B)).toBe(d.actId);
    expect(rig.dir.busyActId(C)).toBeUndefined();
    expect(ask(rig, A, "glare", C)).toEqual({ kind: "pass", why: "actor_busy" });
    settle(rig, d);
    expect(rig.dir.busyActId(A)).toBeUndefined();
    expect(rig.dir.busyActId(B)).toBeUndefined();
  });

  it("[ACT-13] a lying actor makes no gesture, but may cry", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.world.put(A, { state: "lay" });
    expect(ask(rig, A, "glare", B)).toEqual({ kind: "pass", why: "posture" });
    expect(rig.dir.decide({ actor: A, proposal: { verb: "cry", origin: "model" } })).toMatchObject({ kind: "approve", verb: "cry" });
  });

  it("[RES-1] [WAKE-1] restrain only with an aggressor in the scene, tend_fallen only at someone fallen", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    expect(ask(rig, C, "restrain", A)).toEqual({ kind: "pass", why: "no_drive" });
    expect(ask(rig, C, "tend_fallen", A)).toMatchObject({ kind: "unsent", error: { detail: "not_fallen" } });
  });
});
