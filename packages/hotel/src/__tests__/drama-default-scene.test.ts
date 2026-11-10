/**
 * A scene that writes no `drama` block gets the conservative default (`defaultSceneDrama`): production runs of user-authored scenes held insults and a
 * bet but no act, because a scene without a block could not slap (SCN-1) and no heat reached the lower rungs. The director's side of it: with the default
 * the climb runs glare, insult, shove, slap for a heated actor and stops there (no punch, no kill, nobody aimed at a human), and `drama: off` makes
 * the whole drama inert. The compile side is in `drama-scenario.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { BeatPlayer } from "../director/drama/beat-player.js";
import { DEFAULT_DRAMA_TUNING } from "../director/drama/tuning.js";
import { DRAMA_OFF, defaultSceneDrama, resolveRunDrama } from "../authoring/scenario-drama.js";
import type { ScenarioBeat } from "../authoring/scenario-beats.js";
import { A, B, C, H, emotion, makeRig } from "../testing/drama-rig.js";
import { actFrames } from "../testing/fake-drama.js";

const HOT = { jealousInspection: 0.9, resentfulColdness: 0.9, contemptuousDismissal: 0.9, impulsiveProvocation: 0.9, dominanceAssertion: 0.9, defensiveness: 0.5 };
const DEFAULT = defaultSceneDrama(["person-1", "person-2", "person-3"])!;
type Rig = ReturnType<typeof makeRig>;

/** Consults the actor every `everyMs` for `forMs`; every beat it is given lands at once, as the fake hotel would have it. */
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

describe("a scene with the default block: the director climbs to a slap and no further", () => {
  it("a heated actor shows glare, insult, shove, slap toward the same person within the two minutes a run is watched, one rung per beat", async () => {
    const rig = makeRig({ block: DEFAULT, mode: "default" });
    const beats = await consult(rig, 120_000);
    expect(beats.slice(0, 4).map((b) => b.verb)).toEqual(["glare", "insult", "shove", "slap"]);
    expect(new Set(beats.slice(0, 4).map((b) => b.with))).toEqual(new Set([B]));
    expect(beats.find((b) => b.verb === "shove")!.at).toBeLessThanOrEqual(2 * DEFAULT_DRAMA_TUNING.origination.climb.gapMs + 1000);
    expect(beats.find((b) => b.verb === "slap")!.at).toBeLessThanOrEqual(100_000);
  });

  it("never goes past the slap: no punch, no kill, however long and hot, from any of the three actors", async () => {
    const rig = makeRig({ block: DEFAULT, mode: "default" });
    const verbs = new Set<string>();
    for (const [who, toward] of [[A, [B]], [B, [C]], [C, [A]]] as const) for (const b of await consult(rig, 300_000, 5000, who, [...toward])) verbs.add(b.verb);
    expect(verbs.has("slap")).toBe(true);
    for (const banned of ["punch", "kill", "die"]) expect(verbs.has(banned), banned).toBe(false);
    expect(rig.link.acts.every((a) => a.cmd.with == null || a.cmd.with < 0), "no act is aimed at the human").toBe(true);
    expect(rig.link.acts.some((a) => a.cmd.with === H)).toBe(false);
  });

  it("an authored kill is still refused: nobody is in may_die", async () => {
    const rig = makeRig({ block: DEFAULT, mode: "default" });
    const d = rig.dir.decide({ actor: A, proposal: { verb: "kill", with: B, origin: "scenario" } });
    expect(d).toMatchObject({ kind: "veto", reason: "no_scenario_gate" });
  });

  it("without the block (a body saved before the default) the same actor stops at the shove: that is the gap the default closes", async () => {
    const rig = makeRig();
    const beats = await consult(rig, 120_000);
    expect(beats.map((b) => b.verb)).toContain("shove");
    expect(beats.map((b) => b.verb)).not.toContain("slap");
  });
});

describe("drama: off", () => {
  const off = () => makeRig({ block: DRAMA_OFF, mode: "off" });

  it("is read by the run as off and is not active, so nothing is originated however hot the actor is", async () => {
    expect(resolveRunDrama({ drama: DRAMA_OFF, drama_mode: "off" })).toMatchObject({ off: true, mode: "off", canSkip: false });
    const rig = off();
    expect(rig.dir.active).toBe(false);
    expect(await consult(rig, 300_000)).toEqual([]);
    expect(rig.link.acts).toEqual([]);
  });

  it("turns a model's proposal away too (hug, cry and slap alike), and refuses a scene cut", () => {
    const rig = off();
    for (const verb of ["slap", "hug", "cry", "glare"] as const) {
      const proposal = verb === "cry" ? { verb, origin: "model" as const } : { verb, with: B, origin: "model" as const };
      expect(rig.dir.decide({ actor: A, proposal }), verb).toEqual({ kind: "pass", why: "inert" });
    }
    expect(rig.dir.advanceScene("fim")).toEqual({ kind: "refused", why: "inert" });
    expect(rig.link.acts).toEqual([]);
  });

  it("drops an authored beat as inert instead of playing it", async () => {
    const rig = off();
    const reports: string[] = [];
    const beats: ScenarioBeat[] = [{ id: "b1", at_ms: 0, kind: "act", actor: "person-1", verb: "glare", with: "person-2" }];
    const player = new BeatPlayer({ clock: rig.clock, port: () => rig.dir, beats, drama: resolveRunDrama({ drama: DRAMA_OFF, drama_mode: "off" }), wireOf: (ref) => rig.world.idOf(ref), onReport: (r) => reports.push(`${r.outcome}:${r.why}`) });
    player.start();
    await rig.clock.advance(10);
    expect(reports).toEqual(["dropped:inert"]);
    expect(rig.link.acts).toEqual([]);
  });

  it("the scene's contract free play is not off: a body with no mode and no block still shoves (the two are different opt-outs)", async () => {
    const rig = makeRig({ mode: undefined as never });
    expect(rig.dir.active).toBe(true);
    expect((await consult(rig, 60_000)).map((b) => b.verb)).toContain("shove");
  });
});
