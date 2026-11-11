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
    expect(walk).toBeDefined();
    if (walk?.cmd === "walk") {
      expect(Math.max(Math.abs(walk.to[0] - 11), Math.abs(walk.to[1] - 4))).toBeLessThanOrEqual(HT.prox.earshotMax);
      expect(walk.plan).toMatch(/^hl:/);
    }
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
    const walk = cmds.find((c) => c.cmd === "walk");
    expect(walk).toBeDefined();
  });
});

describe("idle life", () => {
  it("paces when anxious, a few legs a minute and no more", () => {
    const st = agentState({ social: { socialAnxiety: 0.9 } });
    const first = run({}, { agentState: st, human: human({ h: 1 }) });
    expect(first.find((c) => c.cmd === "walk" && c.humanTag === "pace")).toBeDefined();
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

describe("turn-taking", () => {
  it("typing time grows with the line and is the gateway's own at h = 0", () => {
    const at = (chars: number, h: number): number => typingPlan({ chars, thinkMs: 1000, h, seed: 3, actor: "duda", n: 1 }).totalMs;
    expect(at(20, 1)).toBeLessThan(at(80, 1));
    expect(at(80, 1)).toBeLessThan(at(180, 1) + 1);
    expect(at(40, 0)).toBe(1000 + 40 * HT.turn.perCharMs[0]);
    expect(at(400, 0)).toBe(4000);
    // jitter: two lines of one length differ, the same line does not
    const a = typingPlan({ chars: 60, thinkMs: 1000, h: 1, seed: 3, actor: "duda", n: 1 }).totalMs;
    const b = typingPlan({ chars: 60, thinkMs: 1000, h: 1, seed: 3, actor: "duda", n: 2 }).totalMs;
    expect(a).not.toBe(b);
    expect(typingPlan({ chars: 60, thinkMs: 1000, h: 1, seed: 3, actor: "duda", n: 1 }).totalMs).toBe(a);
  });

  it("reaction latency follows the feeling: a heated actor answers sooner, an ashamed one later", () => {
    const heated = feelOf({ arousal: 0.8, valence: -0.5 });
    const ashamed = feelOf({ arousal: 0.4, valence: -0.2, shame: 0.7 });
    expect(heated).toBe("heated");
    expect(ashamed).toBe("ashamed");
    expect(reactionLatencyMs(1500, heated, 1)).toBeLessThan(reactionLatencyMs(1500, "neutral", 1));
    expect(reactionLatencyMs(1500, ashamed, 1)).toBeGreaterThan(reactionLatencyMs(1500, "neutral", 1));
    expect(reactionLatencyMs(1500, ashamed, 0)).toBe(1500);
  });

  it("a cut line ends in a dash and is shorter; a short line is never cut", () => {
    const text = "Você mentiu pra todo mundo nessa mesa e agora quer fingir que não sabe de nada";
    const cut = cutLine(text, 4, "duda", 1)!;
    expect(cut.endsWith("—")).toBe(true);
    expect(cut.length).toBeLessThan(text.length);
    expect(text.startsWith(cut.slice(0, -1))).toBe(true);
    expect(cutLine("oi, tudo bem?", 4, "duda", 1)).toBeUndefined();
  });

  it("interrupts only a heated, long line, on a cooldown, the same way on every run", () => {
    const base = { h: 1, seed: 9, n: 1, speaker: { actor: "a", arousal: 0.9, words: 14 }, other: { actor: "b", arousal: 0.9 }, now: 100_000 };
    const draws = Array.from({ length: 40 }, (_, n) => interrupts({ ...base, n }));
    expect(draws.some(Boolean)).toBe(true);
    expect(draws.every(Boolean)).toBe(false);
    expect(interrupts({ ...base, h: 0 })).toBe(false);
    expect(interrupts({ ...base, speaker: { ...base.speaker, words: 3 } })).toBe(false);
    expect(interrupts({ ...base, other: { actor: "b", arousal: 0.2 } })).toBe(false);
    expect(Array.from({ length: 40 }, (_, n) => interrupts({ ...base, n, lastInterruptAt: 90_000 })).some(Boolean)).toBe(false);
    expect(Array.from({ length: 40 }, (_, n) => interrupts({ ...base, n }))).toEqual(draws);
  });
});

describe("reactions to a line", () => {
  const room = (): ReturnType<typeof space> => space({ others: [person("rafa", [6, 4], { dir: 0 }), person("gabi", [4, 7], { dir: 4 })], self: { dir: 0 } });
  const mood = (arousal: number, valence: number, shame = 0) => agentState({ mood: { arousal, valence }, social: { shame } });
  const ctx = (l: HumanLine, over: { duda?: ReturnType<typeof agentState>; rafa?: ReturnType<typeof agentState>; h?: number; props?: Parameters<typeof reactToLine>[0]["props"] } = {}) => {
    const v = room();
    const people = new Map<string, ReactPerson>(v.room!.occupants.map((p) => [p.ref, { ref: p.ref, presence: p, own: true, state: p.ref === "duda" ? (over.duda ?? mood(0.3, 0)) : p.ref === "rafa" ? (over.rafa ?? mood(0.3, 0)) : mood(0.3, 0) }]));
    return { h: over.h ?? 1, seed: 21, line: l, room: v.room!, people, history: [], props: over.props ?? [], memOf: () => ({}), lastGestureAt: () => ({}) };
  };

  it("does nothing at h = 0", () => {
    expect(reactToLine({ ...ctx(line({ n: 1, speaker: "duda", to: "rafa", words: 12 })), h: 0 })).toEqual([]);
  });

  it("the speaker turns to the addressee, who turns back after a beat", () => {
    const out = reactToLine(ctx(line({ n: 1, speaker: "duda", to: "rafa", words: 12, text: "Rafa, sente aqui comigo um instante, por favor" })));
    const speakerFace = out.find((t) => t.ref === "duda" && t.cmd.cmd === "face");
    const listenerFace = out.find((t) => t.ref === "rafa" && t.cmd.cmd === "face");
    expect(speakerFace).toBeDefined();
    expect(listenerFace).toBeDefined();
    expect(listenerFace!.atMs).toBeGreaterThanOrEqual(HT.gaze.listenerLagMs[0]);
  });

  it("looks away on a lie and on shame, but holds the look in a row", () => {
    const lie = reactToLine(ctx(line({ n: 2, speaker: "duda", to: "rafa", words: 10, lie: true })));
    const away = lie.filter((t) => t.ref === "duda" && t.cmd.cmd === "face");
    expect(away.some((t) => t.log.rule.startsWith("avert"))).toBe(true);
    expect(away.some((t) => t.log.rule === "return")).toBe(true);
    const row = reactToLine(ctx(line({ n: 2, speaker: "duda", to: "rafa", words: 10, lie: true, hostile: "insult" }), { duda: mood(0.9, -0.6), rafa: mood(0.9, -0.6) }));
    expect(row.some((t) => t.log.rule.startsWith("avert"))).toBe(false);
    const shame = reactToLine(ctx(line({ n: 3, speaker: "duda", to: "rafa", words: 10 }), { duda: mood(0.3, -0.3, 0.8) }));
    expect(shame.some((t) => t.log.rule === "avert:shame")).toBe(true);
  });

  it("the stung addressee turns its face away from an insult", () => {
    let stung = 0;
    for (let n = 1; n <= 30; n++) {
      const out = reactToLine(ctx(line({ n, speaker: "duda", to: "rafa", words: 8, hostile: "insult" }), { duda: mood(0.3, -0.1), rafa: mood(0.3, -0.1) }));
      if (out.some((t) => t.ref === "rafa" && t.log.rule === "avert:stung")) stung++;
    }
    expect(stung).toBeGreaterThan(5);
  });

  it("glances at the third party being discussed and at a prop that matters", () => {
    let thirds = 0;
    for (let n = 1; n <= 20; n++) {
      const third = reactToLine(ctx(line({ n, speaker: "duda", to: "rafa", words: 10, mentioned: ["gabi"] })));
      if (third.some((t) => t.log.rule === "glance:third_party" || t.log.rule === "glance:named")) thirds++;
    }
    expect(thirds).toBeGreaterThan(5);
    let prop = 0;
    for (let n = 1; n <= 20; n++) {
      const out = reactToLine(ctx(line({ n, speaker: "duda", to: "rafa", words: 9, text: "Você escondeu o envelope no cofre" }), { props: [{ id: "env", label: "envelope", tile: [9, 9], words: ["envelope"] }] }));
      if (out.some((t) => t.log.rule === "glance:prop:env")) prop++;
    }
    expect(prop).toBeGreaterThan(3);
  });

  it("backchannels without words: a nod, a tilt, a brow, never a text filler", () => {
    const seen = new Set<string>();
    for (let n = 1; n <= 80; n++) {
      const q = n % 3 === 0;
      const out = reactToLine(ctx(line({ n, speaker: "duda", to: "rafa", words: 9, question: q, ...(n % 7 === 0 ? { reveal: true } : {}) })));
      for (const t of out) {
        expect(t.cmd.cmd).not.toBe("chat");
        if (t.log.kind === "backchannel") seen.add(t.log.rule);
      }
    }
    expect([...seen].some((r) => r.startsWith("backchannel:"))).toBe(true);
  });

  it("witnesses of a reveal freeze with a surprised face, then look to the accused", () => {
    let freezes = 0;
    for (let n = 1; n <= 20; n++) {
      const out = reactToLine(ctx(line({ n, speaker: "duda", to: "rafa", words: 12, reveal: true, hostile: "accusation" })));
      if (out.some((t) => t.ref === "gabi" && t.log.rule === "witness:freeze") && out.some((t) => t.ref === "gabi" && t.log.rule === "witness:look_to_accused")) freezes++;
    }
    expect(freezes).toBeGreaterThan(8);
  });

  it("is deterministic under the seed", () => {
    const l = line({ n: 9, speaker: "duda", to: "rafa", words: 12, lie: true, mentioned: ["gabi"], stress: 0.8 });
    expect(reactToLine(ctx(l))).toEqual(reactToLine(ctx(l)));
  });

  it("an emphasis gesture comes with a stressed line, not a plain one", () => {
    let loud = 0;
    let plain = 0;
    for (let n = 1; n <= 60; n++) {
      const a = reactToLine(ctx(line({ n, speaker: "duda", to: "rafa", words: 8, stress: 1, hostile: "insult", text: "VOCÊ MENTIU!!" }), { duda: mood(0.9, -0.6) }));
      const b = reactToLine(ctx(line({ n, speaker: "duda", to: "rafa", words: 8, stress: 0, text: "tudo bem por aqui" })));
      if (a.some((t) => t.cmd.cmd === "gesture")) loud++;
      if (b.some((t) => t.cmd.cmd === "gesture")) plain++;
    }
    expect(loud).toBeGreaterThan(plain);
  });
});

describe("lines", () => {
  it("reads length, stress, a question, laughter and a hostile word", () => {
    const l = lineFacts({ n: 1, speaker: "a", to: "b", atMs: 0, text: "VOCÊ É UM IDIOTA!!", cast: new Map([["b", "Bia"]]) });
    expect(l.stress).toBeGreaterThan(0.5);
    expect(l.hostile).toBe("insult");
    expect(lineFacts({ n: 2, speaker: "a", atMs: 0, text: "hahaha, boa" }).amusement).toBe(true);
    expect(lineFacts({ n: 3, speaker: "a", atMs: 0, text: "Cadê o envelope?" }).question).toBe(true);
    expect(lineFacts({ n: 4, speaker: "a", atMs: 0, text: "Falei com a Bia ontem.", cast: new Map([["b", "Bia"]]) }).mentioned).toEqual(["b"]);
  });
});
