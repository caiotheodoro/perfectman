/**
 * The director's default pace (errata P4-02). With the first seeds (a beat of its own every 6 s per passive actor) a resentful actor was started on
 * something 8.6 times a minute against the act-rate probe's 3 per scene-minute, and a model that proposes the same solo verb every consult kept
 * kneeling beside the same body. The numbers are data (`DEFAULT_DRAMA_TUNING`); these tests pin what they promise, not the numbers themselves.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_DRAMA_TUNING } from "../director/drama/tuning.js";
import { A, B, C, WIDE_BLOCK, emotion, makeRig } from "../testing/drama-rig.js";
import { actFrames } from "../testing/fake-drama.js";

const RESENTFUL = { resentfulColdness: 1, contemptuousDismissal: 1, impulsiveProvocation: 1, jealousInspection: 1, dominanceAssertion: 1 };

describe("a passive actor's pace (P4-02)", () => {
  it("[D6] a resentful actor consulted every 6 s for four minutes stays under the act-rate probe's 3 a minute, and only a step up the ladder with the same person comes sooner than the slow gap", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    const beats: Array<{ at: number; verb: string; with: number | undefined; rung: number | undefined }> = [];
    const t0 = rig.clock.now();
    for (let t = 0; t < 240_000; t += 6000) {
      const d = rig.dir.decide({ actor: A, emotion: emotion(RESENTFUL, { toward: [B, C] }) });
      if (d.kind === "initiate") {
        beats.push({ at: rig.clock.now() - t0, verb: d.verb, with: d.with, rung: d.rung });
        rig.hotel(actFrames({ actId: d.actId, verb: d.verb, actor: A, ...(d.with !== undefined ? { with: d.with } : {}), outcome: "landed", scene: rig.dir.scene }));
      }
      await rig.clock.advance(6000);
    }
    expect(beats.length).toBeGreaterThan(0);
    expect(beats.length / 4).toBeLessThanOrEqual(3);
    for (let i = 1; i < beats.length; i++) {
      if (beats[i]!.at - beats[i - 1]!.at >= DEFAULT_DRAMA_TUNING.origination.minGapMs) continue;
      const [prev, now] = [beats[i - 1]!, beats[i]!];
      expect({ verb: now.verb, with: now.with, up: (now.rung ?? 0) > (prev.rung ?? 0) }).toEqual({ verb: now.verb, with: prev.with, up: true });
    }
  });

  it("the pace is the tuning's: a director built with a faster one starts more beats than the default does", async () => {
    const fast = { ...DEFAULT_DRAMA_TUNING, origination: { ...DEFAULT_DRAMA_TUNING.origination, minGapMs: 6000 } };
    const count = async (tuning: typeof fast): Promise<number> => {
      const rig = makeRig({ block: WIDE_BLOCK, tuning });
      let n = 0;
      for (let t = 0; t < 120_000; t += 6000) {
        const d = rig.dir.decide({ actor: A, emotion: emotion(RESENTFUL, { toward: [B, C] }) });
        if (d.kind === "initiate") {
          n += 1;
          rig.hotel(actFrames({ actId: d.actId, verb: d.verb, actor: A, ...(d.with !== undefined ? { with: d.with } : {}), outcome: "landed", scene: rig.dir.scene }));
        }
        await rig.clock.advance(6000);
      }
      return n;
    };
    expect(await count(fast)).toBeGreaterThan(await count(DEFAULT_DRAMA_TUNING));
  });
});

describe("the same solo verb again (P4-02)", () => {
  const tend = (rig: ReturnType<typeof makeRig>, actor: number, origin: "model" | "scenario" = "model") => rig.dir.decide({ actor, proposal: { verb: "tend_fallen", with: A, origin } });
  const faintedA = () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.hotel(actFrames({ actId: "f1", verb: "faint", actor: A, outcome: "landed", scene: "7.1", witnesses: [B, C], owed: [{ who: B, role: "witness" }, { who: C, role: "witness" }] }).slice(0, 2));
    return rig;
  };
  const finish = (rig: ReturnType<typeof makeRig>, actId: string, actor: number) => rig.hotel(actFrames({ actId, verb: "tend_fallen", actor, with: A, outcome: "landed", scene: "7.1" }).slice(-1));

  it("a model that proposes the same verb every consult is passed on as pace until the verb's own window is over, then approved again", async () => {
    const rig = faintedA();
    const first = tend(rig, B);
    expect(first).toMatchObject({ kind: "approve" });
    finish(rig, (first as { actId: string }).actId, B);
    expect(tend(rig, B)).toEqual({ kind: "pass", why: "pace" });
    await rig.clock.advance(DEFAULT_DRAMA_TUNING.repeatMs.tend_fallen! - 1);
    expect(tend(rig, B)).toEqual({ kind: "pass", why: "pace" });
    await rig.clock.advance(1);
    expect(tend(rig, B)).toMatchObject({ kind: "approve" });
  });

  it("it is the actor's own pace: someone else may tend at once, and the other verbs of the same actor are not slowed", () => {
    const rig = faintedA();
    const first = tend(rig, B);
    finish(rig, (first as { actId: string }).actId, B);
    expect(tend(rig, C)).toMatchObject({ kind: "approve" });
    expect(rig.dir.decide({ actor: B, proposal: { verb: "glare", with: C, origin: "model" }, emotion: emotion(RESENTFUL, { toward: [C] }) })).not.toEqual({ kind: "pass", why: "pace" });
  });

  it("an authored beat is exempt: the script is the author's pace", () => {
    const rig = faintedA();
    const first = tend(rig, B, "scenario");
    finish(rig, (first as { actId: string }).actId, B);
    expect(tend(rig, B, "scenario")).toMatchObject({ kind: "approve" });
  });

  it("the director's own beats keep the pace of the verb too: no turn_back again inside its window", async () => {
    const rig = makeRig({ block: WIDE_BLOCK, tuning: { ...DEFAULT_DRAMA_TUNING, origination: { ...DEFAULT_DRAMA_TUNING.origination, verbs: ["turn_back"], minGapMs: 0 } } });
    const turn = () => rig.dir.decide({ actor: A, emotion: emotion({ resentfulColdness: 1, contemptuousDismissal: 1 }, { toward: [B] }) });
    const first = turn();
    expect(first).toMatchObject({ kind: "initiate", verb: "turn_back" });
    rig.hotel(actFrames({ actId: (first as { actId: string }).actId, verb: "turn_back", actor: A, with: B, outcome: "landed", scene: rig.dir.scene }));
    expect(turn()).toEqual({ kind: "pass", why: "no_drive" });
    await rig.clock.advance(DEFAULT_DRAMA_TUNING.repeatMs.turn_back!);
    expect(turn()).toMatchObject({ kind: "initiate", verb: "turn_back" });
  });
});
