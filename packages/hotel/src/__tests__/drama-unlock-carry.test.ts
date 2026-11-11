/**
 * What the scene spine's unlock needs to become a blow (errata P9), one rule at a time: the answer to a blow inside one fight is not a spread (LAD-10), an actor holding an unlock is asked
 * for a beat of its own even when its model proposed something the director refused, the director is looked at the moment an unlock is granted, and a refusal the model does not act on is
 * not told again and again.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_DRAMA_TUNING } from "../director/drama/tuning.js";
import type { DramaTuning } from "../director/drama/tuning.js";
import { A, B, C, WIDE_BLOCK, emotion, makeRig } from "../testing/drama-rig.js";
import { FakePort, ZERO_ACT, handles, intent, rig } from "../testing/drama-body-rig.js";
import { feedFrames } from "../testing/drama-feed.js";
import { actFrames } from "../testing/fake-drama.js";

const OPEN = { resentment: 0, unlocked: 3, provocation: 0.85 };

describe("LAD-10 in a cast of three: one actor at a rung of 3 or more, and the answer inside one fight", () => {
  /** A has shoved B: A holds the only place the cap of a cast of three leaves. */
  function afterAShovedB(tuning?: DramaTuning) {
    const r = makeRig({ block: WIDE_BLOCK, ...(tuning ? { tuning } : {}) });
    r.world.cast = 3;
    for (const [i, verb] of (["glare", "insult", "shove"] as const).entries()) r.act({ actId: `a${i}`, verb, actor: A, with: B, origin: "director", outcome: "landed", at: r.clock.now() });
    return r;
  }
  const shoveAt = (r: ReturnType<typeof makeRig>, actor: number, target: number, relation: object, tendencies: Partial<typeof ZERO_ACT> = {}) => {
    // The one rung below, so that the ladder (one rung per beat) is not what answers.
    for (const [i, verb] of (["glare", "insult"] as const).entries()) r.act({ actId: `${actor}.${target}.${i}`, verb, actor, with: target, origin: "director", outcome: "landed", at: r.clock.now() });
    return r.dir.decide({ actor, proposal: { verb: "shove", with: target, origin: "model" }, emotion: emotion(tendencies, { toward: [target], relation }) });
  };

  it("the cap as it was: the person who was shoved is refused its own shove at the one who shoved it (a third actor at a rung of 3 or more), though the spine opened the pair", async () => {
    const r = afterAShovedB({ ...DEFAULT_DRAMA_TUNING, contagion: { ...DEFAULT_DRAMA_TUNING.contagion, answer: false } });
    await r.clock.advance(30_000);
    expect(shoveAt(r, B, A, OPEN)).toMatchObject({ kind: "veto", reason: "ladder", detail: "contagion", rule: "LAD-10" });
  });

  it("the answer: with the pair opened for it and the blow thrown at it, the person who was shoved shoves back, though the cap of one is held by the one who shoved it", async () => {
    const r = afterAShovedB();
    await r.clock.advance(30_000);
    expect(shoveAt(r, B, A, OPEN)).toMatchObject({ kind: "approve", verb: "shove", with: A });
  });

  it("only with the pair opened by the spine: the same answer with nothing unlocked is still the cap's", async () => {
    const r = afterAShovedB();
    await r.clock.advance(30_000);
    // Motivated on its own (the shove's own drivers are up and it holds a grievance), so the cap is what is left to refuse it.
    expect(shoveAt(r, B, A, { resentment: 0.9 }, { impulsiveProvocation: 0.9, dominanceAssertion: 0.9 })).toMatchObject({ kind: "veto", detail: "contagion" });
  });

  it("only to the one who threw the blow: a third person with its own pair opened is still capped", async () => {
    const r = afterAShovedB();
    await r.clock.advance(30_000);
    expect(shoveAt(r, C, B, OPEN)).toMatchObject({ kind: "veto", detail: "contagion" });
  });
});

describe("an actor holding an unlock is asked to carry it out, whatever its model proposed", () => {
  const glare = { bodyIntent: intent({ act: { verb: "glare", target: "p1" } }), handles };
  const veto = { kind: "veto", reason: "ladder", rule: "LAD-6", detail: "motive" } as const;
  const asked = (p: FakePort): number => p.turns.filter((t) => t.proposal === undefined).length;

  it("a refused proposal and an open unlock: the director is also asked for a beat of its own in the same consult", () => {
    const r = rig({ allow: (a, b) => a !== b });
    r.body.grant("duda", "gabi", "shove", "test");
    const before = asked(r.port!);
    r.port!.next = veto;
    r.body.planFor("duda", r.input(glare));
    expect(r.port!.turns.filter((t) => t.proposal !== undefined)).toHaveLength(1);
    expect(asked(r.port!)).toBe(before + 1);
  });

  it("with no unlock the model's proposal is all there is: no beat of the director's own on that consult", () => {
    const r = rig({ allow: (a, b) => a !== b });
    r.port!.next = veto;
    r.body.planFor("duda", r.input(glare));
    expect(asked(r.port!)).toBe(0);
  });

  it("an actor that holds an unlock for someone else is not asked on another actor's consult", () => {
    const r = rig({ allow: (a, b) => a !== b });
    r.body.grant("duda", "gabi", "shove", "test");
    const before = asked(r.port!);
    r.port!.next = veto;
    r.body.planFor("rafa", r.input({ ...glare, handles: { p1: { kind: "person", ref: "duda" } } }, "rafa"));
    expect(asked(r.port!)).toBe(before);
  });

  it("a proposal the director approved holds the actor: it is not given a second beat on the same consult", () => {
    const r = rig({ allow: (a, b) => a !== b });
    r.body.grant("duda", "gabi", "shove", "test");
    const before = asked(r.port!);
    r.port!.next = { kind: "approve", actId: "d1", actor: -701, verb: "glare", with: -702, origin: "model", rung: 1, skippedRungs: [], authoredSkip: false, cid: 5 };
    r.body.planFor("duda", r.input(glare));
    expect(asked(r.port!)).toBe(before);
  });
});

describe("the director is looked at the moment an unlock is granted", () => {
  it("a granted unlock asks it at once, as a passive turn does, with the pair open: no wait for the actor's next turn or the next pulse", () => {
    const r = rig({ allow: (a, b) => a !== b });
    r.body.planFor("duda", r.input());
    const before = r.port!.turns.length;
    expect(r.body.grant("duda", "gabi", "shove", "test")).toBe("granted");
    expect(r.port!.turns).toHaveLength(before + 1);
    const turn = r.port!.turns.at(-1)!;
    expect(turn.proposal).toBeUndefined();
    expect(turn.emotion?.relations?.get(-703)).toMatchObject({ unlocked: 3 });
  });

  it("only a grant: a refresh does not ask again, an actor that was never planned has nothing to ask with, a pair the scenario does not let is not opened", () => {
    const r = rig({ allow: (a, b) => a === "duda" && b === "gabi" });
    r.body.grant("leo", "gabi", "shove", "test");
    expect(r.port!.turns).toHaveLength(0);
    r.body.planFor("duda", r.input());
    r.body.grant("duda", "gabi", "shove", "test");
    const n = r.port!.turns.length;
    expect(r.body.grant("duda", "gabi", "shove", "test")).toBe("refreshed");
    expect(r.port!.turns).toHaveLength(n);
    expect(r.body.grant("duda", "rafa", "shove", "test")).toBe("none");
    expect(r.port!.turns).toHaveLength(n);
  });
});

describe("a refusal the model does not act on is told three times, not seventy-nine", () => {
  const veto = { kind: "veto", reason: "ladder", rule: "LAD-6", detail: "motive" } as const;
  const asks = (r: ReturnType<typeof rig>, who = "duda", target = "p1") => r.body.planFor(who, r.input({ bodyIntent: intent({ act: { verb: "glare", target } }), handles: { p1: { kind: "person", ref: "rafa" }, p2: { kind: "person", ref: "gabi" } } }, who));

  it("the same actor, verb, target and reason: the first three are in the prompt, the rest are not; every refusal is still in the log", async () => {
    const noted: string[] = [];
    const r = rig({ note: (a, reasons) => noted.push(`${a}:${reasons[0]!.detail}`) });
    r.port!.next = veto;
    for (let i = 0; i < 7; i++) {
      asks(r);
      await r.clock.advance(100_000);
    }
    expect(noted).toHaveLength(3);
    expect(r.blocked.filter(([, reasons]) => reasons[0]?.code === "ladder")).toHaveLength(7);
    expect(r.body.counters()).toEqual({ act_blocked_notes: 3, act_blocked_notes_silenced: 4 });
  });

  it("a quiet stretch of 120 s starts the count over: the next one is told again, and so are two more", async () => {
    const noted: string[] = [];
    const r = rig({ note: (a) => noted.push(a) });
    r.port!.next = veto;
    for (let i = 0; i < 5; i++) {
      asks(r);
      await r.clock.advance(60_000);
    }
    expect(noted).toHaveLength(3);
    await r.clock.advance(125_000);
    for (let i = 0; i < 4; i++) {
      asks(r);
      await r.clock.advance(60_000);
    }
    expect(noted).toHaveLength(6);
  });

  it("another target, another actor, another reason is another refusal: each has its own three", () => {
    const noted: string[] = [];
    const r = rig({ note: (a, reasons) => noted.push(`${a}:${reasons[0]!.target}:${reasons[0]!.detail}`) });
    r.port!.next = veto;
    for (let i = 0; i < 4; i++) asks(r, "duda", "p1");
    for (let i = 0; i < 4; i++) asks(r, "duda", "p2");
    for (let i = 0; i < 4; i++) asks(r, "gabi", "p1");
    r.port!.next = { ...veto, detail: "grievance" };
    for (let i = 0; i < 4; i++) asks(r, "duda", "p1");
    expect(noted).toHaveLength(12);
    expect(r.body.counters()["act_blocked_notes_silenced"]).toBe(4);
  });

  it("a blow of the actor's own starts the count over: what it was refused for has changed", () => {
    const noted: string[] = [];
    const r = rig({ note: (a) => noted.push(a) });
    r.port!.next = veto;
    for (let i = 0; i < 5; i++) asks(r);
    expect(noted).toHaveLength(3);
    feedFrames(r.body, actFrames({ actId: "d1", verb: "glare", actor: -701, with: -702, origin: "director", outcome: "landed", scene: "7.1", at: 1 }));
    for (let i = 0; i < 5; i++) asks(r);
    expect(noted).toHaveLength(6);
  });

  it("only the notes: the ceiling and every other refusal are as before, and no counter appears when nothing was silenced", () => {
    const r = rig({ note: () => undefined });
    r.port!.next = veto;
    asks(r);
    expect(r.body.counters()).toEqual({ act_blocked_notes: 1 });
    expect(Object.keys(r.body.counters())).not.toContain("act_blocked_notes_silenced");
    expect(ZERO_ACT.warmth).toBe(0);
  });
});
