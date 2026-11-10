/**
 * What the planner side does with what the cast says and with what the ladder refuses (errata P7): a line is handed to the grievance ledger and the director reads
 * the level as `rel.provocation`; an act refused for want of a motive or a grievance is told to the model in its next prompt, and counted.
 */
import type { BlockedReason } from "@perfectman/shared";
import { describe, expect, it } from "vitest";
import { feedFrames } from "../testing/drama-feed.js";
import { sceneCutFrames } from "../testing/fake-drama.js";
import { ZERO_ACT, handles, intent, rig } from "../testing/drama-body-rig.js";
import { avatar, snapshot } from "../testing/fixtures.js";

const own = (a: string, b: string): boolean => a !== b && ["duda", "rafa", "gabi", "leo"].includes(a) && ["duda", "rafa", "gabi", "leo"].includes(b);

describe("a refusal of the ladder is a note for the model's next prompt", () => {
  it.each([["motive"], ["grievance"], ["rung"], ["contagion"], ["zero_witness"]])("a model's act refused for %s is noted, with the name it aimed at, and counted; the log still gets the reason, the verb and the target", (detail) => {
    const noted: Array<[string, BlockedReason[]]> = [];
    const r = rig({ note: (a, reasons) => noted.push([a, reasons]) });
    r.port!.next = { kind: "veto", reason: "ladder", rule: "LAD-6", detail };
    r.body.planFor("duda", r.input({ bodyIntent: intent({ act: { verb: "insult", target: "p1" } }), handles }));
    // The audit (errata P8) says what was blocked, not only why: the verb the actor tried and who it was aimed at.
    expect(r.blocked).toEqual([["duda", [{ code: "ladder", part: "act", detail, verb: "insult", target: "rafa" }]]]);
    expect(noted).toEqual([["duda", [{ code: "ladder", part: "act", detail, verb: "insult", target: "rafa", ref: "Rafa" }]]]);
    expect(r.body.counters()).toEqual({ act_blocked_notes: 1 });
  });

  it("the ceiling (max_rung) and every other veto are not noted: the director decides those, the model is not told; the log still carries the verb and the target", () => {
    const noted: Array<[string, BlockedReason[]]> = [];
    const r = rig({ note: (a, reasons) => noted.push([a, reasons]) });
    for (const veto of [
      { reason: "ladder" as const, rule: "LAD-3", detail: "max_rung" },
      { reason: "budget" as const, rule: "GATE-9", detail: "physical" },
      { reason: "consent_off" as const, rule: "GATE-6" },
    ]) {
      r.port!.next = { kind: "veto", ...veto };
      r.body.planFor("duda", r.input({ bodyIntent: intent({ act: { verb: "slap", target: "p1" } }), handles }));
    }
    expect(noted).toEqual([]);
    expect(r.body.counters()).toEqual({});
    expect(r.blocked.map(([, reasons]) => reasons[0])).toEqual([
      { code: "ladder", part: "act", detail: "max_rung", verb: "slap", target: "rafa" },
      { code: "budget", part: "act", detail: "physical", verb: "slap", target: "rafa" },
      { code: "consent_off", part: "act", verb: "slap", target: "rafa" },
    ]);
  });
});

describe("what the cast says", () => {
  const insult = { speaker: "rafa", content: "Duda, você é uma imbecil", addressees: ["duda"], mentioned: ["duda"] };

  it("a hostile line at an own actor raises its grievance, and the director reads it as rel.provocation on the turn, even toward someone it has no relation with yet", () => {
    const r = rig({ allow: own });
    r.body.noteSpoken(insult);
    expect(r.body.counters()).toEqual({ grievance_raised: 1, grievance_insult: 1 });
    r.body.planFor("duda", r.input({ actionEmotions: { ...ZERO_ACT, resentfulColdness: 0 } }));
    const turn = r.port?.turns.at(-1);
    expect(turn?.emotion?.relations?.get(-702)?.provocation).toBe(0.5);
    // Rafa has not been provoked by Duda: no reading of it.
    r.body.planFor("rafa", r.input({ actionEmotions: ZERO_ACT }, "rafa"));
    expect(r.port?.turns.at(-1)?.emotion?.relations?.get(-701)?.provocation).toBeUndefined();
  });

  it("falls with time: the reading of the same turn a window later has no provocation in it", async () => {
    const r = rig({ allow: own });
    r.body.noteSpoken(insult);
    await r.clock.advance(121_000);
    r.refresh();
    r.body.planFor("duda", r.input({ actionEmotions: ZERO_ACT }));
    expect(r.port?.turns.at(-1)?.emotion?.relations?.get(-702)?.provocation).toBeUndefined();
  });

  it("is inert when drama is not in charge: no session, nothing counted, nothing read", () => {
    const r = rig({ allow: own, drama: false });
    r.body.noteSpoken(insult);
    expect(r.body.counters()).toEqual({});
  });

  it("is inert for a pair the run does not allow (drama off, a pair the block does not name) and for a human speaker", () => {
    const closed = rig({ allow: () => false });
    closed.body.noteSpoken(insult);
    expect(closed.body.counters()).toEqual({ grievance_skipped: 1 });
    const r = rig({ allow: own });
    r.body.noteSpoken({ speaker: "h:9", content: "Duda, imbecil", addressees: ["duda"], mentioned: ["duda"] });
    expect(r.body.counters()).toEqual({});
  });

  it("a scene cut starts the cast fresh", () => {
    const r = rig({ allow: own });
    r.body.noteSpoken(insult);
    feedFrames(r.body, sceneCutFrames({ scene: "7.2", prev: "7.1" }));
    r.body.planFor("duda", r.input({ actionEmotions: ZERO_ACT }));
    expect(r.port?.turns.at(-1)?.emotion?.relations?.get(-702)?.provocation).toBeUndefined();
  });

  it("an actor out of the say radius, in the room, is told it behind its back: half the gain", () => {
    const r = rig({ allow: own });
    // Wide room, Leo at the far end: 14 tiles from Rafa.
    r.mirror.applySnapshot(snapshot(12, 2, [avatar(-701, "Duda", 4, 4), avatar(-702, "Rafa", 6, 4), avatar(-703, "Gabi", 8, 6), avatar(-704, "Leo", 20, 2), avatar(9, "ana", 7, 5)], 24), r.clock.now());
    r.body.noteSpoken({ speaker: "rafa", content: "o Leo é um idiota", addressees: ["gabi"], mentioned: ["leo"] });
    expect(r.body.provocation.levelOf("leo", "rafa")).toBe(0.25);
    r.body.noteSpoken({ speaker: "rafa", content: "o Gabi é um idiota", addressees: ["duda"], mentioned: ["gabi"] });
    expect(r.body.provocation.levelOf("gabi", "rafa")).toBe(0.5);
  });
});
