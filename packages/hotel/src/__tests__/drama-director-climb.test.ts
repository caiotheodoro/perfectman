/**
 * Issue #262: a model that only talks gives the director nothing to approve, so the ladder has to start from the actor's own feelings. The
 * director's beats climb it one rung at a time with the same person (glare, insult, shove, slap), each beat on the heels of the last as long as
 * the climb goes on, and fall back to the slow pace once it stops. The contract's gates (LAD-1 one rung per beat, 20 s between blows, the scene's
 * `max_rung`, consent, kills) are untouched: every beat here goes through them.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_DRAMA_TUNING } from "../director/drama/tuning.js";
import { A, B, WIDE_BLOCK, emotion, makeRig } from "../testing/drama-rig.js";
import { actFrames } from "../testing/fake-drama.js";

/** Beatriz, as the scene seeds her: every tendency of the ladder is up. */
const HOT = { jealousInspection: 0.9, resentfulColdness: 0.9, contemptuousDismissal: 0.9, impulsiveProvocation: 0.9, dominanceAssertion: 0.9, defensiveness: 0.5 };

type Rig = ReturnType<typeof makeRig>;

/** Consults the passive actor every `everyMs` for `forMs`; every beat it is given lands at once, as the fake hotel would have it. */
async function consult(rig: Rig, forMs: number, everyMs = 5000, who = A, toward = [B]) {
  const beats: Array<{ at: number; verb: string; with: number | undefined }> = [];
  const t0 = rig.clock.now();
  for (let t = 0; t < forMs; t += everyMs) {
    const d = rig.dir.decide({ actor: who, emotion: emotion(HOT, { toward, relation: { resentment: 0.8, lastNegativeAt: rig.clock.now() - 60_000 } }) });
    if (d.kind === "initiate") {
      beats.push({ at: rig.clock.now() - t0, verb: d.verb, with: d.with });
      rig.hotel(actFrames({ actId: d.actId, verb: d.verb, actor: who, ...(d.with !== undefined ? { with: d.with } : {}), origin: "director", outcome: "landed", scene: rig.dir.scene, at: rig.clock.now() }));
    }
    await rig.clock.advance(everyMs);
  }
  return beats;
}

describe("a passive actor with a grievance climbs the ladder on its own (#262)", () => {
  it("shows glare, insult, shove, slap toward the same person, in that order, one rung per beat", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    const beats = await consult(rig, 120_000);
    expect(beats.slice(0, 4).map((b) => b.verb)).toEqual(["glare", "insult", "shove", "slap"]);
    expect(new Set(beats.slice(0, 4).map((b) => b.with))).toEqual(new Set([B]));
  });

  it("the whole climb fits in about the two minutes a run is watched, and the blows keep the contract's 20 s spacing", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    const beats = await consult(rig, 120_000);
    const slap = beats.find((b) => b.verb === "slap");
    expect(slap, "the slap").toBeDefined();
    expect(slap!.at).toBeLessThanOrEqual(100_000);
    const physical = beats.filter((b) => b.verb === "shove" || b.verb === "slap" || b.verb === "punch");
    for (let i = 1; i < physical.length; i++) expect(physical[i]!.at - physical[i - 1]!.at).toBeGreaterThanOrEqual(20_000);
  });

  it("stops at the scene's own ceiling: a scene that allows rung 4 never gets a punch or a kill from the director", async () => {
    const rig = makeRig({ block: { ...WIDE_BLOCK, max_rung: 4 } });
    const beats = await consult(rig, 240_000);
    expect(beats.map((b) => b.verb)).not.toContain("punch");
    expect(beats.map((b) => b.verb)).not.toContain("kill");
    expect(beats.filter((b) => b.verb === "slap").length).toBeGreaterThanOrEqual(1);
  });

  it("once the climb has nowhere to go it is back to the slow pace: the beat after the slap is a full gap later, and is not a lower rung again", async () => {
    const rig = makeRig({ block: { ...WIDE_BLOCK, max_rung: 4 } });
    const beats = await consult(rig, 300_000);
    const slap = beats.find((b) => b.verb === "slap")!;
    const next = beats.find((b) => b.at > slap.at);
    expect(next, "a later beat").toBeDefined();
    expect(next!.at - slap.at).toBeGreaterThanOrEqual(DEFAULT_DRAMA_TUNING.origination.minGapMs);
    expect(["glare", "insult", "shove"]).not.toContain(next!.verb);
  });

  it("a beat right after the last one is passed on as pace until the climb gap is over", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    const first = rig.dir.decide({ actor: A, emotion: emotion(HOT, { toward: [B] }) });
    expect(first).toMatchObject({ kind: "initiate", verb: "glare" });
    rig.hotel(actFrames({ actId: (first as { actId: string }).actId, verb: "glare", actor: A, with: B, origin: "director", outcome: "landed", scene: rig.dir.scene, at: rig.clock.now() }));
    await rig.clock.advance(5000);
    expect(rig.dir.decide({ actor: A, emotion: emotion(HOT, { toward: [B] }) })).toEqual({ kind: "pass", why: "pace" });
  });

  it("without a grievance there is no beat of rung 2 or above, however hot the tendencies: LAD-6 is not weakened", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    const d = rig.dir.decide({ actor: A, emotion: emotion({ ...HOT, jealousInspection: 0, resentfulColdness: 0, contemptuousDismissal: 0 }, { toward: [B], relation: { resentment: 0, lastNegativeAt: null } }) });
    expect(d).toEqual({ kind: "pass", why: "no_drive" });
  });
});

describe("the climb walks up to its target for a blow (#262)", () => {
  it("a motivated shove refused only for distance (GATE-7) is not a beat: the director passes and says whom to walk to, and starts it once they are beside each other", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.world.put(B, { tile: [9, 5] });
    const beats = await consult(rig, 60_000);
    expect(beats.map((b) => b.verb)).toEqual(["glare", "insult"]);
    await rig.clock.advance(30_000);
    const far = rig.dir.decide({ actor: A, emotion: emotion(HOT, { toward: [B], relation: { resentment: 0.8, lastNegativeAt: rig.clock.now() - 60_000 } }) });
    expect(far).toEqual({ kind: "pass", why: "no_drive", approach: B });
    rig.world.put(B, { tile: [6, 5] });
    expect(rig.dir.decide({ actor: A, emotion: emotion(HOT, { toward: [B], relation: { resentment: 0.8, lastNegativeAt: rig.clock.now() - 60_000 } }) })).toMatchObject({ kind: "initiate", verb: "shove", with: B });
  });

  it("a far target with no beat in reach for another reason (no grievance, nothing driving it) is just a pass: nobody is sent walking", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.world.put(B, { tile: [9, 5] });
    expect(rig.dir.decide({ actor: A, emotion: emotion({}, { toward: [B] }) })).toEqual({ kind: "pass", why: "no_drive" });
  });
});

