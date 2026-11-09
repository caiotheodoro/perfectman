import { describe, expect, it } from "vitest";
import { ActLedger } from "../embodiment/act-ledger.js";
import type { HotelFrame } from "../director/index.js";
import { feedFrames } from "../testing/drama-feed.js";
import { actFrames, dramaStateFrame, helloDrama, sceneCutFrames } from "../testing/fake-drama.js";
import { ManualClock } from "../testing/manual-clock.js";

const REFS: Record<number, string> = { [-701]: "duda", [-702]: "rafa", [-703]: "gabi", [-704]: "leo", 9: "h:9" };
const IDS = Object.fromEntries(Object.entries(REFS).map(([id, ref]) => [ref, Number(id)]));
const T0 = 1_730_000_123_456;

function setup(near: Record<string, string[]> = {}) {
  const clock = new ManualClock(50_000);
  const events: string[] = [];
  const ledger = new ActLedger({
    refOf: (id) => REFS[id] ?? `h:${id}`,
    near: (ref) => near[ref] ?? [],
    now: () => clock.now(),
    hooks: {
      blocked: (f) => events.push(`blocked:${f.reason}`),
      missed: (who, actId) => events.push(`missed:${who}:${actId}`),
      done: (f) => events.push(`done:${f.act_id}`),
    },
  });
  const feed = (frames: readonly HotelFrame[]): void => feedFrames(ledger, frames);
  return { clock, ledger, feed, events };
}

const slapOnRafa = (extra: Partial<Parameters<typeof actFrames>[0]> = {}) =>
  actFrames({ actId: "a1", verb: "slap", with: -702, outcome: "landed", at: T0, witnesses: [-703, -704], owed: [{ who: -702, role: "target" }, { who: -703, role: "witness" }, { who: -704, role: "witness" }], ...extra });

describe("act ledger: the sidecar half of the act lock (REA-9)", () => {
  it("[REA-9] locks the initiator from act_started to act_done and not a frame longer", () => {
    const { ledger, feed } = setup();
    const frames = slapOnRafa();
    feed(frames.slice(0, 1));
    expect(ledger.lockOf("duda")).toMatchObject({ actId: "a1", why: "initiator" });
    feed(frames.slice(1, -1));
    expect(ledger.lockOf("duda")?.actId).toBe("a1");
    feed(frames.slice(-1));
    expect(ledger.lockOf("duda")).toBeUndefined();
  });

  it("[TGT-1] locks an actor target of a contact verb from act_started, never a human, and never the target of a glare", () => {
    const { ledger, feed } = setup();
    feed(slapOnRafa().slice(0, 1));
    expect(ledger.lockOf("rafa")).toMatchObject({ actId: "a1", why: "target" });
    feed(actFrames({ actId: "a2", verb: "slap", actor: -703, with: 9, outcome: "landed", chip: true, at: T0 }).slice(0, 1));
    expect(ledger.lockOf("h:9")).toBeUndefined();
    const calm = setup();
    calm.feed(actFrames({ actId: "a3", verb: "glare", actor: -704, with: -703, outcome: "landed", at: T0 }).slice(0, 1));
    expect(calm.ledger.lockOf("gabi")).toBeUndefined();
    expect(calm.ledger.lockOf("leo")?.why).toBe("initiator");
  });

  it("[REA-9] holds every owed reactor from act_beat until act_done, and tells the planner what it owes and until when", () => {
    const { ledger, feed, clock } = setup();
    const frames = slapOnRafa();
    feed(frames.slice(0, 1));
    expect(ledger.lockOf("gabi")).toBeUndefined();
    expect(ledger.owedOf("gabi")).toEqual([]);
    feed(frames.slice(1, 2));
    const beat = frames[1] as Extract<HotelFrame, { t: "act_beat" }>;
    expect(ledger.lockOf("gabi")).toMatchObject({ actId: "a1", why: "owed" });
    expect(ledger.owedOf("gabi")).toEqual([{ actId: "a1", verb: "slap", who: "gabi", role: "witness", actor: "duda", target: "rafa", dueInMs: 3000, receivedAt: clock.now(), at: beat.at }]);
    expect(ledger.owedOf("rafa")[0]).toMatchObject({ role: "target", dueInMs: 1500 });
  });

  it("[REA-2] never infers a debt from the target or the verb: only act_beat.owed counts, and a human owes nothing", () => {
    const { ledger, feed } = setup();
    feed(actFrames({ actId: "a1", verb: "slap", with: 9, outcome: "landed", chip: true, answer: "take", at: T0, witnesses: [-702, 9], owed: [] }));
    expect(ledger.owedOf("rafa")).toEqual([]);
    expect(ledger.owedOf("h:9")).toEqual([]);
    expect(ledger.lockOf("rafa")).toBeUndefined();
  });

  it("[REA-10] an act_reaction settles the debt, whichever of the table or the planner reacted, and the reactor stays locked until act_done", () => {
    const { ledger, feed } = setup();
    const frames = slapOnRafa({ reactions: [{ who: -703, role: "witness", reaction: "freeze_gasp" }, { who: -704, role: "witness", reaction: "cmd:face", source: "planner" }] });
    feed(frames.slice(0, 4));
    expect(ledger.owedOf("gabi")).toEqual([]);
    expect(ledger.owedOf("leo")).toEqual([]);
    expect(ledger.owedOf("rafa")).toHaveLength(1);
    expect(ledger.lockOf("gabi")?.why).toBe("owed");
  });

  it("[REA-10] a reactor that left the room or died before its step is dropped from what the planner waits on", () => {
    const { ledger, feed } = setup();
    feed(slapOnRafa().slice(0, 2));
    ledger.onGone("gabi");
    expect(ledger.owedOf("gabi")).toEqual([]);
    expect(ledger.lockOf("gabi")).toBeUndefined();
    expect(ledger.owedOf("leo")).toHaveLength(1);
  });

  it("[REA-10] reports a debt that was still open at act_done, from the frame's owed_missed", () => {
    const { feed, events } = setup();
    const frames = slapOnRafa();
    const done = frames[frames.length - 1] as Extract<HotelFrame, { t: "act_done" }>;
    feed([...frames.slice(0, -1), { ...done, owed_missed: [{ who: -704, role: "witness" }] }]);
    expect(events).toContain("missed:leo:a1");
    expect(events).toContain("done:a1");
  });

  it("[FRM-2] a blocked act is one act_done: nothing is locked and the reason is reported", () => {
    const { ledger, feed, events } = setup();
    feed(actFrames({ actId: "a9", verb: "punch", with: 9, outcome: "blocked", reason: "consent_off", at: T0 }));
    expect(ledger.lockOf("duda")).toBeUndefined();
    expect(events).toEqual(["blocked:consent_off"]);
  });

  it("[FRM-3] an act aborted before contact frees everyone it had locked", () => {
    const { ledger, feed } = setup();
    feed(actFrames({ actId: "a5", verb: "slap", with: -702, outcome: "aborted", reason: "target_moved", at: T0 }));
    expect(ledger.lockOf("duda")).toBeUndefined();
    expect(ledger.lockOf("rafa")).toBeUndefined();
  });

  it("[TBL-11] a slap's tableau holds every actor in reach until act_done, never a human, and a witness who is already owed keeps its own lock", () => {
    const { ledger, feed } = setup({ duda: ["gabi", "leo", "h:9"] });
    feed(slapOnRafa().slice(0, 2));
    expect(ledger.lockOf("leo")?.why).toBe("owed");
    feed(actFrames({ actId: "a2", verb: "faint", actor: -703, outcome: "landed", at: T0 + 20_000, witnesses: [-701], owed: [{ who: -701, role: "witness" }] }).slice(0, 2));
    expect(ledger.lockOf("h:9")).toBeUndefined();
  });

  it("[TBL-11] a tableau act holds the actors around it even though nobody owes it a reaction", () => {
    const { ledger, feed } = setup({ duda: ["gabi", "h:9"] });
    feed(actFrames({ actId: "t1", verb: "tableau", actor: -701, outcome: "landed", at: T0 }).slice(0, 1));
    expect(ledger.lockOf("gabi")).toMatchObject({ actId: "t1", why: "held" });
    expect(ledger.lockOf("h:9")).toBeUndefined();
  });
});

describe("act ledger: no reward after a kill, the dead and the fallen (LAD-8, DEATH-2, DEATH-7)", () => {
  it("[LAD-8] locks the killer from the celebration gestures for 5 s from contact, and from nothing else", async () => {
    const { ledger, feed, clock } = setup();
    feed(actFrames({ actId: "k1", verb: "kill", with: -702, outcome: "landed", at: T0, witnesses: [-703], owed: [{ who: -703, role: "witness" }], death: { victim: -702, killer: -701 } }));
    expect(ledger.noReward("duda")).toBe(true);
    expect(ledger.noReward("gabi")).toBe(false);
    await clock.advance(5_001);
    expect(ledger.noReward("duda")).toBe(false);
  });

  it("[DEATH-2] a killed actor is out of the speaker pool until its actor_revive, and the hooks say when it leaves and returns", () => {
    const seen: string[] = [];
    const clock = new ManualClock(50_000);
    const ledger = new ActLedger({ refOf: (id) => REFS[id] ?? `h:${id}`, near: () => [], now: () => clock.now(), hooks: { dead: (ref) => seen.push(`dead:${ref}`), revived: (ref) => seen.push(`alive:${ref}`) } });
    feedFrames(ledger, actFrames({ actId: "k1", verb: "kill", with: -702, outcome: "landed", at: T0, death: { victim: -702, killer: -701 } }));
    expect(ledger.isDead("rafa")).toBe(true);
    expect(ledger.isDead("duda")).toBe(false);
    feedFrames(ledger, sceneCutFrames({ scene: "7.3", prev: "7.2", revived: [-702] }));
    expect(ledger.isDead("rafa")).toBe(false);
    expect(seen).toEqual(["dead:rafa", "alive:rafa"]);
  });

  it("[DEATH-7] a permadeath actor never comes back: actor_gone retires it for good", () => {
    const { ledger, feed } = setup();
    feed(actFrames({ actId: "k1", verb: "kill", with: -702, outcome: "landed", at: T0, death: { victim: -702, killer: -701 } }));
    ledger.onGone("rafa");
    feed(sceneCutFrames({ scene: "7.3", prev: "7.2", revived: [] }));
    expect(ledger.isDead("rafa")).toBe(false);
    expect(ledger.isGone("rafa")).toBe(true);
  });

  it("[NEG-8] the dead list of a new hello replaces the set: an id missing from it is alive again", () => {
    const { ledger } = setup();
    ledger.onSession({ enabled: true, chipTtlMs: 4000, harmMax: 3, harmWindowS: 300, dead: [-702, -703] });
    expect([ledger.isDead("rafa"), ledger.isDead("gabi")]).toEqual([true, true]);
    ledger.onSession({ enabled: true, chipTtlMs: 4000, harmMax: 3, harmWindowS: 300, dead: [-703] });
    expect([ledger.isDead("rafa"), ledger.isDead("gabi")]).toEqual([false, true]);
    ledger.onSession(null);
    expect(ledger.isDead("gabi")).toBe(false);
  });

  it("[WAKE-1] who is on the floor: a fainted actor from its contact to act_done, a down human until human_up, the dead until revive", () => {
    const { ledger, feed } = setup();
    const faint = actFrames({ actId: "f1", verb: "faint", actor: -703, outcome: "landed", at: T0 });
    feed(faint.slice(0, 2));
    expect(ledger.fallenKind("gabi")).toBe("fainted");
    feed(faint.slice(2));
    expect(ledger.fallenKind("gabi")).toBeUndefined();
    const kill = actFrames({ actId: "k2", verb: "kill", with: 9, outcome: "landed", chip: true, answer: "take", at: T0, death: { victim: 9, killer: -701, human: true } });
    feed(kill.slice(0, kill.length - 1));
    expect(ledger.fallenKind("h:9")).toBe("down");
    feed(kill.slice(-1));
    expect(ledger.fallenKind("h:9")).toBeUndefined();
  });

  it("[DEATH-7] a scene cut frees every lock, because the acts in flight end with it", () => {
    const { ledger, feed } = setup();
    feed(slapOnRafa().slice(0, 2));
    feed(sceneCutFrames({ scene: "7.3", prev: "7.2" }));
    expect([ledger.lockOf("duda"), ledger.lockOf("rafa"), ledger.lockOf("gabi")]).toEqual([undefined, undefined, undefined]);
  });
});

describe("act ledger: whether drama is on for the planner (SAFE-2, NEG-9)", () => {
  it("is on only in a dialect 2 session whose room is enabled, and off after a runtime kill switch or a dialect 1 session", () => {
    const { ledger, feed } = setup();
    expect(ledger.dramaOn()).toBe(false);
    ledger.onSession({ enabled: true, chipTtlMs: 4000, harmMax: 3, harmWindowS: 300, dead: [] });
    feed([dramaStateFrame({ enabled: true })]);
    expect(ledger.dramaOn()).toBe(true);
    feed([dramaStateFrame({ enabled: false })]);
    expect(ledger.dramaOn()).toBe(false);
    feed([dramaStateFrame({ enabled: true, calm: true })]);
    expect(ledger.dramaOn()).toBe(true);
    expect(ledger.calm()).toBe(true);
    ledger.onSession(null);
    expect(ledger.dramaOn()).toBe(false);
  });

  it("[NEG-9] a resume's drama_state rebuilds the scene id, and it only ever comes from the hotel (SCENE-4)", () => {
    const { ledger, feed } = setup();
    ledger.onSession({ enabled: true, chipTtlMs: 4000, harmMax: 3, harmWindowS: 300, dead: [] });
    feed([dramaStateFrame({ scene: "7.4" })]);
    expect(ledger.scene()).toBe("7.4");
    feed(sceneCutFrames({ scene: "7.5", prev: "7.4" }));
    expect(ledger.scene()).toBe("7.5");
    expect(helloDrama({ dead: [-702] }).dead).toEqual([-702]);
  });
});
