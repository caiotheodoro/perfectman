/**
 * Who is free after a faint or a kill (errata P4-03). REA-9 makes a witness busy only while its own reaction step runs; the sidecar's ledger had
 * held every owed witness until `act_done`, which for a faint comes after the fainted actor stood up, so nobody could kneel beside the body.
 * The act lock on the initiator and on a contact target stays. And the director learns of a fainted actor from the faint's own frames
 * (there is no stand-up frame, P2-10), so a `tend_fallen` at one is allowed while the faint lasts and refused after.
 */
import { describe, expect, it } from "vitest";
import { ActLedger } from "../embodiment/act-ledger.js";
import { REACTION_STEP_MS } from "../embodiment/constants.js";
import { verbTable } from "../director/verb-table.js";
import { feedFrames } from "../testing/drama-feed.js";
import { actFrames } from "../testing/fake-drama.js";
import { A, B, C, WIDE_BLOCK, makeRig } from "../testing/drama-rig.js";
import { ManualClock } from "../testing/manual-clock.js";

const REFS: Record<number, string> = { [-701]: "duda", [-702]: "rafa", [-703]: "gabi", [-704]: "leo", 9: "h:9" };
const T0 = 1_730_000_123_456;

function setup() {
  const clock = new ManualClock(50_000);
  const ledger = new ActLedger({ refOf: (id) => REFS[id] ?? `h:${id}`, near: () => [], now: () => clock.now() });
  return { clock, ledger, feed: (frames: Parameters<typeof feedFrames>[1]) => feedFrames(ledger, frames) };
}

const faint = (reactions: Parameters<typeof actFrames>[0]["reactions"] = []) =>
  actFrames({ actId: "f1", verb: "faint", actor: -701, outcome: "landed", at: T0, witnesses: [-702, -703], owed: [{ who: -702, role: "witness" }, { who: -703, role: "witness" }], reactions });

describe("the witness lock (REA-9)", () => {
  it("[REA-9] a witness is locked while it owes, locked while its own table step runs, and free after it, with the faint still open", async () => {
    const { ledger, feed, clock } = setup();
    const frames = faint([{ who: -702, role: "witness", reaction: "freeze_gasp" }]);
    feed(frames.slice(0, 2));
    expect(ledger.lockOf("rafa")).toMatchObject({ actId: "f1", why: "owed" });
    feed(frames.slice(2, 3));
    expect(ledger.owedOf("rafa")).toEqual([]);
    expect(ledger.lockOf("rafa")?.why).toBe("owed");
    await clock.advance(REACTION_STEP_MS - 1);
    expect(ledger.lockOf("rafa")).toBeDefined();
    await clock.advance(1);
    expect(ledger.lockOf("rafa")).toBeUndefined();
    expect(ledger.openActs().map((a) => a.actId)).toEqual(["f1"]);
  });

  it("[REA-3] a witness that answered with a command of its own skips the step and is free at once", () => {
    const { ledger, feed } = setup();
    feed(faint([{ who: -702, role: "witness", reaction: "cmd:face", source: "planner" }]).slice(0, 3));
    expect(ledger.lockOf("rafa")).toBeUndefined();
  });

  it("[REA-10] a witness whose debt is still open stays locked, however long the act runs", async () => {
    const { ledger, feed, clock } = setup();
    feed(faint([{ who: -702, role: "witness", reaction: "freeze_gasp" }]).slice(0, 3));
    await clock.advance(10_000);
    expect(ledger.lockOf("rafa")).toBeUndefined();
    expect(ledger.lockOf("gabi")).toMatchObject({ actId: "f1", why: "owed" });
  });

  it("[REA-9] [TGT-1] the initiator and the target of a contact verb stay locked to act_done, whatever they have reacted to", async () => {
    const { ledger, feed, clock } = setup();
    const slap = actFrames({ actId: "s1", verb: "slap", actor: -701, with: -702, outcome: "landed", at: T0, witnesses: [-703], owed: [{ who: -702, role: "target" }, { who: -703, role: "witness" }], reactions: [{ who: -702, role: "target", reaction: "head_snap" }, { who: -703, role: "witness", reaction: "freeze_gasp" }] });
    feed(slap.slice(0, -1));
    await clock.advance(20_000);
    expect(ledger.lockOf("duda")).toMatchObject({ actId: "s1", why: "initiator" });
    expect(ledger.lockOf("rafa")).toMatchObject({ actId: "s1", why: "target" });
    expect(ledger.lockOf("gabi")).toBeUndefined();
    feed(slap.slice(-1));
    expect(ledger.lockOf("duda")).toBeUndefined();
    expect(ledger.lockOf("rafa")).toBeUndefined();
  });

  it("[REA-9] a witness who reacted to an act that is cut, or who dies, owes and is held by nothing", () => {
    const { ledger, feed } = setup();
    feed(faint([{ who: -702, role: "witness", reaction: "freeze_gasp" }]).slice(0, 3));
    ledger.onGone("rafa", false);
    expect(ledger.lockOf("rafa")).toBeUndefined();
  });

  it("[VV-4] the step a table reaction holds a witness for is the nested freeze_gasp's last row", () => {
    const rows = verbTable().verbs.freeze_gasp.roles["actor"] ?? [];
    expect(Math.max(...rows.map((r) => r.t.ms))).toBe(REACTION_STEP_MS);
  });
});

describe("the fainted actor in the director (DEATH-1, DOWN-1, GATE-4)", () => {
  const asks = (rig: ReturnType<typeof makeRig>, verb: "tend_fallen" | "insult", actor = C) => rig.dir.decide({ actor, proposal: { verb, with: A, origin: "model" } });

  it("[DOWN-1] a tend_fallen at an actor that fainted is approved from the faint's contact until its act_done, and a scene cut ends it too", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    expect(asks(rig, "tend_fallen")).toMatchObject({ kind: "unsent", error: { detail: "not_fallen" } });
    const frames = actFrames({ actId: "f1", verb: "faint", actor: A, outcome: "landed", scene: "7.1", witnesses: [B, C], owed: [{ who: B, role: "witness" }, { who: C, role: "witness" }] });
    rig.hotel(frames.slice(0, 1));
    expect(asks(rig, "tend_fallen")).toMatchObject({ kind: "unsent" });
    rig.hotel(frames.slice(1, 2));
    expect(asks(rig, "tend_fallen")).toMatchObject({ kind: "approve", verb: "tend_fallen", with: A, origin: "model" });
    rig.hotel(frames.slice(2));
    expect(asks(rig, "tend_fallen", B)).toMatchObject({ kind: "unsent" });

    const cut = makeRig({ block: WIDE_BLOCK });
    cut.hotel(frames.slice(0, 2));
    cut.cut({ scene: "7.2", prev: "7.1" });
    expect(asks(cut, "tend_fallen")).toMatchObject({ kind: "unsent" });
  });

  it("[GATE-4] while the faint lasts an insult at the fainted actor is the hotel's dead_target, not sent", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.hotel(actFrames({ actId: "f1", verb: "faint", actor: A, outcome: "landed", scene: "7.1", witnesses: [B], owed: [{ who: B, role: "witness" }] }).slice(0, 2));
    expect(asks(rig, "insult")).toMatchObject({ kind: "veto", reason: "dead_target" });
    expect(rig.link.acts).toHaveLength(0);
  });

  it("a faint the hotel blocked, or aborted before contact, never made anyone fallen", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.hotel(actFrames({ actId: "f1", verb: "faint", actor: A, outcome: "aborted", reason: "calm_room", scene: "7.1" }));
    expect(asks(rig, "tend_fallen")).toMatchObject({ kind: "unsent" });
    rig.hotel(actFrames({ actId: "f2", verb: "faint", actor: A, outcome: "blocked", reason: "kill_switch", scene: "7.1" }));
    expect(asks(rig, "tend_fallen")).toMatchObject({ kind: "unsent" });
  });
});
