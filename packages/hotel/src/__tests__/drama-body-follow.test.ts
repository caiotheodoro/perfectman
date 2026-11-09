import { describe, expect, it } from "vitest";
import { feedFrames } from "../testing/drama-feed.js";
import { actFrames, sceneCutFrames } from "../testing/fake-drama.js";
import { ZERO_ACT, T0, intent, rig } from "../testing/drama-body-rig.js";

describe("a follow window and the actor's own walks (issue #262)", () => {
  /** A climb's actor that was told to walk up to Gabi: a follow window is open for Duda. */
  const following = () => {
    const r = rig();
    r.port!.next = { kind: "pass", why: "no_drive", approach: -703 };
    const first = r.body.planFor("duda", r.input({ actionEmotions: { ...ZERO_ACT, resentfulColdness: 0.8 } }));
    expect(first.find((c) => c.cmd === "walk")?.plan).toMatch(/^drama:/);
    r.blocked.length = 0;
    return r;
  };
  /** The model's own turn: walk up to Gabi (four tiles off), look angry, no feelings (so the director is not asked). */
  const ownTurn = (r: ReturnType<typeof rig>) => {
    const i = r.input({ bodyIntent: intent({ move: { kind: "approach", target: "p1", band: "personal" }, expression: "angry" }), handles: { p1: { kind: "person", ref: "gabi" } } });
    delete i.actionEmotions;
    return r.body.planFor("duda", i);
  };

  it("drops the actor's own walk while the window is open, keeps its expression, and says so to the blocked hook, once per walk", () => {
    const r = following();
    const cmds = ownTurn(r);
    expect(cmds.some((c) => c.cmd === "walk")).toBe(false);
    expect(cmds.some((c) => c.cmd === "expression")).toBe(true);
    expect(r.blocked).toEqual([["duda", [{ code: "busy_moving", part: "move", detail: "follow_suppressed_walk" }]]]);
    expect(r.body.suppressedWalks).toBe(1);
  });

  it("never drops the body's own walks (`drama:`), so a follow's approach goes through", () => {
    const r = following();
    r.port!.next = { kind: "pass", why: "no_drive", approach: -703 };
    const cmds = r.body.planFor("duda", r.input({ actionEmotions: { ...ZERO_ACT, resentfulColdness: 0.8 } }));
    expect(cmds.find((c) => c.cmd === "walk")?.plan).toMatch(/^drama:/);
    expect(r.body.suppressedWalks).toBe(0);
  });

  it("another actor's own walk is not touched", () => {
    const r = following();
    const i = r.input({ bodyIntent: intent({ move: { kind: "approach", target: "p1", band: "personal" } }), handles: { p1: { kind: "person", ref: "leo" } } }, "rafa");
    delete i.actionEmotions;
    expect(r.body.planFor("rafa", i).some((c) => c.cmd === "walk")).toBe(true);
    expect(r.blocked).toEqual([]);
  });

  it("releases the own walks when the window times out", async () => {
    const r = following();
    await r.clock.advance(31_000);
    r.refresh();
    expect(ownTurn(r).some((c) => c.cmd === "walk")).toBe(true);
    expect(r.body.suppressedWalks).toBe(0);
  });

  it("releases them when the actor's blow starts", () => {
    const r = following();
    feedFrames(r.body, actFrames({ actId: "s1", verb: "shove", with: -703, outcome: "landed", at: T0, actor: -701 }));
    expect(ownTurn(r).some((c) => c.cmd === "walk")).toBe(true);
    expect(r.body.suppressedWalks).toBe(0);
  });

  it("releases them when the scene is cut", () => {
    const r = following();
    feedFrames(r.body, sceneCutFrames({ scene: "7.3", prev: "7.2" }));
    expect(ownTurn(r).some((c) => c.cmd === "walk")).toBe(true);
  });

  it("releases them when the actor dies (a revive starts clean)", () => {
    const r = following();
    feedFrames(r.body, actFrames({ actId: "k1", verb: "kill", with: -701, actor: -702, outcome: "landed", at: T0, death: { victim: -701, killer: -702 } }));
    feedFrames(r.body, sceneCutFrames({ scene: "7.3", prev: "7.2", revived: [-701] }));
    expect(ownTurn(r).some((c) => c.cmd === "walk")).toBe(true);
  });

  it("with no window open nothing is dropped", () => {
    const r = rig();
    expect(ownTurn(r).some((c) => c.cmd === "walk")).toBe(true);
    expect(r.blocked).toEqual([]);
  });
});

describe("a climb's actor looks at its director when the climb's gap is over (issue #262)", () => {
  const GAP = 25_000;
  /** Duda has planned once (its feelings are known) and the director starts its insult at Rafa. */
  const started = (o: { origin?: "director" | "model"; verb?: "insult" | "slap" | "glare"; actor?: number } = {}) => {
    const r = rig();
    r.body.planFor("duda", r.input({ actionEmotions: { ...ZERO_ACT, resentfulColdness: 0.8 } }));
    r.port!.turns.length = 0;
    feedFrames(r.body, actFrames({ actId: "i1", verb: o.verb ?? "insult", with: -702, outcome: "landed", at: T0, actor: o.actor ?? -701, origin: o.origin ?? "director" }));
    return r;
  };

  it("asks the director once, without a proposal, when the gap is over, and opens a follow when it says approach", async () => {
    const r = started();
    r.port!.next = { kind: "pass", why: "no_drive", approach: -702 };
    await r.clock.advance(GAP - 1000);
    expect(r.port!.turns).toEqual([]);
    await r.clock.advance(2000);
    expect(r.port!.turns).toHaveLength(1);
    expect(r.port!.turns[0]).toMatchObject({ actor: -701 });
    expect(r.port!.turns[0]!.proposal).toBeUndefined();
    r.refresh();
    const i = r.input({ bodyIntent: intent({ move: { kind: "approach", target: "p1", band: "personal" } }), handles: { p1: { kind: "person", ref: "gabi" } } });
    delete i.actionEmotions;
    expect(r.body.planFor("duda", i).some((c) => c.cmd === "walk")).toBe(false);
    expect(r.body.suppressedWalks).toBe(1);
  });

  it("opens nothing when the director has no approach to name", async () => {
    const r = started();
    await r.clock.advance(GAP + 1000);
    expect(r.port!.turns).toHaveLength(1);
    r.refresh();
    const i = r.input({ bodyIntent: intent({ move: { kind: "approach", target: "p1", band: "personal" } }), handles: { p1: { kind: "person", ref: "gabi" } } });
    delete i.actionEmotions;
    expect(r.body.planFor("duda", i).some((c) => c.cmd === "walk")).toBe(true);
  });

  it("does not look for an act of the model's, for a blow at the climb's ceiling, or when the scene is cut first", async () => {
    const model = started({ origin: "model" });
    await model.clock.advance(GAP + 1000);
    expect(model.port!.turns).toEqual([]);
    const slap = started({ verb: "slap" });
    await slap.clock.advance(GAP + 1000);
    expect(slap.port!.turns).toEqual([]);
    const cut = started();
    feedFrames(cut.body, sceneCutFrames({ scene: "7.3", prev: "7.2" }));
    await cut.clock.advance(GAP + 1000);
    expect(cut.port!.turns).toEqual([]);
  });
});

