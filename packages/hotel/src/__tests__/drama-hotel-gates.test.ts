import { describe, expect, it } from "vitest";
import { A, B, WIDE_BLOCK, emotion, makeRig } from "../testing/drama-rig.js";
import { rigFromGiven } from "../testing/hotel-given.js";
import { outcomeSignature } from "../testing/fixture-diff.js";
import { readHotelRows } from "../testing/hotel-fixtures.js";

describe("the director's gate function over the hotel's own blocked-all-reasons rows (the hotel's world, the hotel's answer)", () => {
  const rows = readHotelRows("blocked-all-reasons.jsonl");

  for (const row of rows) {
    const id = String((row.in?.["cmd"] as { act_id: string }).act_id);
    it(`${id}: ${outcomeSignature(row)}`, async () => {
      const { rig, cmd } = await rigFromGiven(row);
      const before = rig.link.acts.length;
      const decision = rig.dir.decide({
        actor: A,
        proposal: { verb: cmd.verb, ...(cmd.with !== undefined ? { with: cmd.with } : {}), origin: "model", ...(cmd.authored_skip ? { authoredSkip: true } : {}) },
        emotion: emotion({ dominanceAssertion: 1, resentfulColdness: 1 }),
      });
      const want = row.expect[0] as { reason: string; detail?: string };
      expect(decision).toMatchObject({ kind: "veto", reason: want.reason, ...(want.detail ? { detail: want.detail } : {}) });
      expect(rig.link.acts.length).toBe(before);
    });
  }
});

describe("where the director reads the hotel's gates differently from its rows", () => {
  it("[LAD-1] the pair's rung stands for the whole scene, however long ago it was reached: a shove ten minutes old still lets a slap through", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.act({ actId: "old", verb: "shove", actor: A, with: B, outcome: "landed" });
    await rig.clock.advance(600_000);
    expect(rig.dir.decide({ actor: A, proposal: { verb: "slap", with: B, origin: "model" }, emotion: emotion({ dominanceAssertion: 1 }) })).toMatchObject({ kind: "approve", verb: "slap", rung: 4 });
  });

  it("[LAD-1] a scene cut starts the ladder over, so a rung from the scene before no longer counts", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.act({ actId: "old", verb: "shove", actor: A, with: B, outcome: "landed" });
    await rig.clock.advance(30_000);
    rig.cut({ scene: "7.2", prev: "7.1" });
    expect(rig.dir.decide({ actor: A, proposal: { verb: "slap", with: B, origin: "model" }, emotion: emotion({ dominanceAssertion: 1 }) })).toMatchObject({ kind: "veto", reason: "ladder", detail: "rung" });
  });

  it("[RES-1] a restrain at someone who has used no rung is not proposed at all, where the hotel's gates would have answered calm_room: the director declines before the hotel is asked", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.state({ calm: true });
    expect(rig.dir.decide({ actor: A, proposal: { verb: "restrain", with: B, origin: "model" } })).toEqual({ kind: "pass", why: "no_drive" });
    expect(rig.link.acts).toEqual([]);
  });
});
