import { describe, expect, it } from "vitest";
import { plan, updateMemory } from "../embodiment/plan.js";
import type { PlanInput, PlannedCommand } from "../embodiment/types.js";
import { HT, HT_SOURCES, leafKeys, resolveHumanLikeness, sourceOf, DEFAULT_HUMAN_LIKENESS, HUMAN_LIKENESS_ENV } from "../embodiment/human/tuning.js";
import { hrand } from "../embodiment/human/rng.js";
import { relationClass, windowFor, groupSpot, mustUnstack } from "../embodiment/human/proxemics.js";
import { cutLine, feelOf, reactionLatencyMs, typingPlan, interrupts } from "../embodiment/human/turn.js";
import { lineFacts } from "../embodiment/human/lines.js";
import { reactToLine } from "../embodiment/human/reactions.js";
import type { ReactPerson } from "../embodiment/human/reactions.js";
import type { HumanLine, HumanPlanCtx } from "../embodiment/human/types.js";
import { NOW, agentState, person, space } from "../testing/fixtures.js";
import type { SpaceOpts } from "../testing/fixtures.js";
import { seededRng } from "../util/stats.js";

const human = (over: Partial<HumanPlanCtx> = {}): HumanPlanCtx => ({ h: 0.6, seed: 11, lines: [], ...over });
const run = (o: SpaceOpts, over: Partial<PlanInput> = {}): PlannedCommand[] =>
  plan({ space: space(o), agentState: agentState(), committedEvents: [], now: NOW, rng: seededRng(7), ...over });
const line = (over: Partial<HumanLine> & { n: number; speaker: string }): HumanLine => ({ atMs: NOW - 1000, text: "oi", words: 1, mode: "say", mentioned: [], question: false, stress: 0, amusement: false, ...over });

describe("the stylization dial", () => {
  it("resolves scene over env over default, clamps, and ignores nonsense", () => {
    expect(resolveHumanLikeness(undefined, {})).toBe(DEFAULT_HUMAN_LIKENESS);
    expect(resolveHumanLikeness(undefined, { [HUMAN_LIKENESS_ENV]: "0.3" })).toBe(0.3);
    expect(resolveHumanLikeness(0.9, { [HUMAN_LIKENESS_ENV]: "0.3" })).toBe(0.9);
    expect(resolveHumanLikeness(7, {})).toBe(1);
    expect(resolveHumanLikeness(-2, {})).toBe(0);
    expect(resolveHumanLikeness(undefined, { [HUMAN_LIKENESS_ENV]: "lots" })).toBe(DEFAULT_HUMAN_LIKENESS);
    expect(resolveHumanLikeness(Number.NaN, { [HUMAN_LIKENESS_ENV]: "0" })).toBe(0);
  });

  it("every number in the tuning table says where it comes from", () => {
    for (const leaf of leafKeys()) {
      const s = sourceOf(leaf);
      expect(s, leaf).toBeDefined();
      expect(["prior", "corpus", "runs"]).toContain(s!.src);
    }
    expect(HT_SOURCES.every((s) => s.note.length >= 9)).toBe(true);
  });

  it("deterministic draws do not depend on call order", () => {
    const a = hrand(5, "x", "duda", 3);
    hrand(5, "y");
    expect(hrand(5, "x", "duda", 3)).toBe(a);
    expect(hrand(6, "x", "duda", 3)).not.toBe(a);
  });
});

describe("at human_likeness 0 the planner is what it was", () => {
  const cases: Array<[string, SpaceOpts, Partial<PlanInput>]> = [
    ["a far speaker", { others: [person("rafa", [10, 4], { lastSpokeAt: NOW - 1000 })] }, {}],
    ["two on one tile", { others: [person("rafa", [4, 4])] }, {}],
    ["an anxious loner", { others: [] }, { agentState: agentState({ social: { socialAnxiety: 0.9 } }) }],
  ];
  for (const [name, o, over] of cases) {
    it(name, () => {
      const plain = run(o, over);
      expect(run(o, { ...over, human: human({ h: 0 }) })).toEqual(plain);
    });
  }
});

describe("proxemics", () => {
  it("windows are monotone in the dial and never wider than earshot above 0", () => {
    for (const cls of ["intimate", "warm", "neutral", "cool", "faceoff", "fear"] as const) {
      const w0 = windowFor(cls, 0);
      const w1 = windowFor(cls, 1);
      expect([w0.min, w0.ideal, w0.max]).toEqual([HT.prox.oldMin, HT.prox.oldIdeal, HT.prox.oldMax]);
      expect(w1.max).toBeLessThanOrEqual(HT.prox.earshotMax);
      expect(windowFor(cls, 0.01).max).toBeLessThanOrEqual(HT.prox.oldMax);
      let prev = windowFor(cls, 0);
      for (let h = 0.1; h <= 1.0001; h += 0.1) {
        const w = windowFor(cls, h);
        expect(w.max).toBeLessThanOrEqual(prev.max);
        prev = w;
      }
    }
  });

  it("closer for affection and for a threat to be made, farther for fear and for cold", () => {
    const ideal = (rel: Parameters<typeof agentState>[0], heated = false, hit = false): number => {
      const st = agentState(rel);
      return windowFor(relationClass(st.relationalStates.get("rafa"), st.coreMood, { heated, hit }), 1).ideal;
    };
    const lover = ideal({ rel: { rafa: { attraction: 0.7, comfort: 0.6 } } });
    const friend = ideal({ rel: { rafa: { affection: 0.5 } } });
    const stranger = ideal({ rel: { rafa: {} } });
    const cold = ideal({ rel: { rafa: { desireForDistance: 0.8 } } });
    const faceoff = ideal({ rel: { rafa: { resentment: 0.5 } }, mood: { arousal: 0.8, valence: -0.5 } }, true);
    const afraid = ideal({ rel: { rafa: { threat: 0.8 } } });
    const shoved = ideal({ rel: { rafa: {} } }, false, true);
    expect(lover).toBeLessThan(friend);
    expect(friend).toBeLessThan(stranger);
    expect(stranger).toBeLessThan(cold);
    expect(faceoff).toBeLessThan(stranger);
    expect(afraid).toBeGreaterThan(stranger);
    expect(shoved).toBeGreaterThan(stranger);
  });

  it("walks up to someone who is too far to talk to, and never stands closer than the window", () => {
    const lines = [line({ n: 1, speaker: "duda", to: "rafa", atMs: NOW - 4000 })];
    const cmds = run({ others: [person("rafa", [11, 4])] }, { human: human({ lines }) });
    const walk = cmds.find((c) => c.cmd === "walk");
    expect(walk).toMatchObject({ cmd: "walk", plan: expect.stringMatching(/^hl:/) });
    const to = walk?.cmd === "walk" ? walk.to : [0, 0];
    expect(Math.max(Math.abs(to[0] - 11), Math.abs(to[1] - 4))).toBeLessThanOrEqual(HT.prox.earshotMax);
  });

  it("steps off a tile somebody else stands on", () => {
    const o: SpaceOpts = { self: { ref: "rafa" }, others: [person("duda", [4, 4])] };
    const view = space(o);
    expect(mustUnstack(view.self!, view.room!)).toBe(true);
    const cmds = run(o, { human: human() });
    expect(cmds.find((c) => c.cmd === "walk")).toBeDefined();
    // the other one stays
    expect(mustUnstack(person("duda", [4, 4]), view.room!)).toBe(false);
  });

  it("a hold silences every movement rule but the unstacking", () => {
    const lines = [line({ n: 1, speaker: "duda", to: "rafa", atMs: NOW - 4000 })];
    expect(run({ others: [person("rafa", [11, 4])] }, { human: human({ lines, hold: true }) }).some((c) => c.cmd === "walk")).toBe(false);
    expect(run({ self: { ref: "rafa" }, others: [person("duda", [4, 4])] }, { human: human({ hold: true }) }).some((c) => c.cmd === "walk")).toBe(true);
  });

  it("never overrides a walk somebody else started", () => {
    const lines = [line({ n: 1, speaker: "duda", to: "rafa", atMs: NOW - 4000 })];
    expect(run({ self: { state: "walk" }, others: [person("rafa", [11, 4])] }, { human: human({ lines }) }).some((c) => c.cmd === "walk")).toBe(false);
  });

  it("makes a ring of three people who stand in a line", () => {
    const self = { tile: [5, 5] as [number, number] };
    const others = [person("rafa", [6, 5]), person("gabi", [7, 5])];
    const view = space({ self, others });
    const spot = groupSpot(view.self!, view.room!, others.map((p) => p.tile), new Set());
    expect(spot).toBeDefined();
    const lines = [line({ n: 1, speaker: "rafa", to: "gabi", atMs: NOW - 5000 }), line({ n: 2, speaker: "gabi", to: "duda", atMs: NOW - 3000 })];
    // a chance per look, so over a few looks it happens, and it always lands on a free tile
    const walks = Array.from({ length: 12 }, (_, i) => plan({ space: { ...space({ self, others }), readAt: NOW + i * 5000 }, agentState: agentState(), committedEvents: [], now: NOW + i * 5000, rng: seededRng(7), human: human({ lines: lines.map((l) => ({ ...l, atMs: l.atMs + i * 5000 })), h: 1 }) }).find((c) => c.cmd === "walk"));
    expect(walks.some((w) => w !== undefined)).toBe(true);
  });

  it("gives space to the one who holds the floor", () => {
    const lines = [line({ n: 1, speaker: "rafa", to: "gabi", atMs: NOW - 1500 })];
    const cmds = run({ others: [person("rafa", [5, 4]), person("gabi", [8, 4])] }, { human: human({ lines, h: 1 }) });
    expect(cmds.find((c) => c.cmd === "walk")).toMatchObject({ cmd: "walk", humanTag: "space" });
  });
});

describe("idle life", () => {
  it("paces when anxious, a few legs a minute and no more", () => {
    const st = agentState({ social: { socialAnxiety: 0.9 } });
    const first = run({}, { agentState: st, human: human({ h: 1 }) });
    expect(first.find((c) => c.humanTag === "pace")).toMatchObject({ cmd: "walk", humanTag: "pace" });
    const legs = [NOW - 50_000, NOW - 30_000, NOW - 10_000];
    const capped = run({}, { agentState: st, human: human({ h: 1 }), memory: { humanPace: legs, humanAt: { pace: NOW - 20_000 } } });
    expect(capped.some((c) => c.humanTag === "pace")).toBe(false);
  });

  it("sits down when beaten, and does nothing while someone is talking to it", () => {
    const seat = { id: 3, defId: "sofa", label: "sofa", kinds: ["sit" as const], tiles: [[5, 5] as [number, number]], front: [[5, 4] as [number, number]], state: 0 };
    const st = agentState({ mood: { valence: -0.7, energy: 0.6 }, social: { shame: 0.7, humiliation: 0.6 } });
    const memory = { firstPlanAt: NOW - 100_000, lastSatAt: NOW - 90_000 };
    expect(run({ furni: [seat] }, { agentState: st, human: human(), memory }).some((c) => c.cmd === "sit")).toBe(true);
    const talking = [line({ n: 1, speaker: "rafa", to: "duda", atMs: NOW - 2000 })];
    expect(run({ furni: [seat], others: [person("rafa", [5, 4])] }, { agentState: st, human: human({ lines: talking }), memory }).some((c) => c.cmd === "sit")).toBe(false);
  });

  it("no jitter loop: a pacing actor is not told to move twice inside the cooldown", () => {
    const st = agentState({ social: { socialAnxiety: 0.9 } });
    let mem: PlanInput["memory"] = {};
    let walks = 0;
    for (let t = 0; t < 60_000; t += 6000) {
      const now = NOW + t;
      const cmds = plan({ space: { ...space({}), readAt: now }, agentState: st, committedEvents: [], now, rng: seededRng(2), memory: mem, human: human({ h: 1 }) });
      if (cmds.some((c) => c.humanTag === "pace")) walks++;
      mem = updateMemory(mem ?? {}, cmds, now, [4, 4], "12");
    }
    expect(walks).toBeLessThanOrEqual(HT.idle.paceLegsPerMin + 1);
  });
});

