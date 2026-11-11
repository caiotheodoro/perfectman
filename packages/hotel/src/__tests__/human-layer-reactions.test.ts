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
import { HumanBody } from "../embodiment/human/human-body.js";
import type { HumanLogEntry } from "../embodiment/human/types.js";
import type { PlannerMemory } from "../embodiment/types.js";
import { ManualClock } from "../testing/manual-clock.js";
import type { SpaceOpts } from "../testing/fixtures.js";
import { seededRng } from "../util/stats.js";

const human = (over: Partial<HumanPlanCtx> = {}): HumanPlanCtx => ({ h: 0.6, seed: 11, lines: [], ...over });
const run = (o: SpaceOpts, over: Partial<PlanInput> = {}): PlannedCommand[] =>
  plan({ space: space(o), agentState: agentState(), committedEvents: [], now: NOW, rng: seededRng(7), ...over });
const line = (over: Partial<HumanLine> & { n: number; speaker: string }): HumanLine => ({ atMs: NOW - 1000, text: "oi", words: 1, mode: "say", mentioned: [], question: false, stress: 0, amusement: false, ...over });

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


describe("the human layer's runtime", () => {
  const POS: Record<string, { tile: [number, number]; dir: 0 | 2 | 4 }> = { duda: { tile: [4, 4], dir: 0 }, rafa: { tile: [6, 4], dir: 0 }, gabi: { tile: [4, 7], dir: 4 } };
  function rig(o: { likeness?: number; locked?: (ref: string) => boolean; states?: Record<string, ReturnType<typeof agentState>> } = {}) {
    const clock = new ManualClock(NOW);
    const sent: Array<{ at: number; cmd: PlannedCommand }> = [];
    const log: Array<HumanLogEntry & { at: number }> = [];
    const mems = new Map<string, PlannerMemory>();
    const walking = new Set<string>();
    const view = (ref: string, now: number) => {
      const others = Object.entries(POS).filter(([r]) => r !== ref).map(([r, p]) => person(r, p.tile, { dir: p.dir, ...(walking.has(r) ? { state: "walk" as const } : {}) }));
      return { ...space({ self: { ref, tile: POS[ref]?.tile ?? [4, 4], dir: POS[ref]?.dir ?? 0, ...(walking.has(ref) ? { state: "walk" as const } : {}) }, others }), readAt: now };
    };
    const body = new HumanBody({
      clock,
      likeness: o.likeness ?? 1,
      seed: 7,
      view,
      refOfAvatar: (id) => String(id),
      isOwn: () => true,
      names: () => new Map([["duda", "Duda"], ["rafa", "Rafa"], ["gabi", "Gabi"]]),
      stateOf: (ref) => o.states?.[ref] ?? agentState(),
      send: (cmds) => cmds.forEach((cmd) => sent.push({ at: clock.now(), cmd })),
      memory: { get: (ref) => mems.get(ref), set: (ref, m) => void mems.set(ref, m) },
      ...(o.locked ? { isLocked: o.locked } : {}),
      log: (e) => void log.push(e),
    });
    return { clock, body, sent, log, walking, mems };
  }
  const long = "Rafa, eu preciso que você me diga a verdade sobre o envelope, agora mesmo";

  it("turns the people to each other after their delays, with plain commands and never a text line", async () => {
    const r = rig();
    r.body.onLine({ speaker: "duda", to: "rafa", text: long });
    expect(r.sent).toHaveLength(0);
    await r.clock.advance(6000);
    expect(r.sent.length).toBeGreaterThan(0);
    expect(r.sent.every((s) => s.cmd.cmd !== "chat")).toBe(true);
    expect(r.sent.some((s) => s.cmd.agentId === "rafa" && s.cmd.cmd === "face")).toBe(true);
    expect(r.log.some((e) => e.actor === "rafa" && e.rule === "face:speaker")).toBe(true);
  });

  it("does nothing at h = 0 and for a whisper", async () => {
    const off = rig({ likeness: 0 });
    off.body.onLine({ speaker: "duda", to: "rafa", text: long });
    const whisper = rig();
    whisper.body.onLine({ speaker: "duda", to: "rafa", text: long, mode: "whisper" });
    await off.clock.advance(6000);
    await whisper.clock.advance(6000);
    expect(off.sent).toHaveLength(0);
    expect(whisper.sent).toHaveLength(0);
  });

  it("holds back a reaction for an actor that an act holds or that is walking, and says why", async () => {
    const locked = rig({ locked: () => true });
    locked.body.onLine({ speaker: "duda", to: "rafa", text: long });
    const walker = rig();
    walker.body.onLine({ speaker: "duda", to: "rafa", text: long });
    walker.walking.add("rafa");
    await locked.clock.advance(6000);
    await walker.clock.advance(6000);
    expect(locked.sent).toHaveLength(0);
    expect(locked.log.some((e) => e.skipped === "locked")).toBe(true);
    expect(walker.sent.some((s) => s.cmd.agentId === "rafa")).toBe(false);
    expect(walker.log.some((e) => e.actor === "rafa" && e.skipped === "walking")).toBe(true);
  });

  it("a face it set goes back to neutral after its hold, and a feeling shows on the speaker's face", async () => {
    const r = rig({ states: { duda: agentState({ mood: { arousal: 0.8, valence: -0.6 } }) } });
    for (let i = 0; i < 12; i++) {
      r.body.onLine({ speaker: "duda", to: "rafa", text: `${long} ${i}!!` });
      await r.clock.advance(3000);
    }
    await r.clock.advance(20_000);
    const faces = r.sent.filter((s) => s.cmd.agentId === "duda" && s.cmd.cmd === "expression").map((s) => (s.cmd.cmd === "expression" ? s.cmd.face : ""));
    expect(faces).toContain("angry");
    expect(faces.at(-1)).toBe("neutral");
  });

  it("stays inside its share of the actor's budget however many lines land", async () => {
    const r = rig();
    for (let i = 0; i < 20; i++) r.body.onLine({ speaker: i % 2 ? "duda" : "rafa", to: i % 2 ? "rafa" : "duda", text: `${long} ${i}` });
    await r.clock.advance(5000);
    for (const ref of ["duda", "rafa"]) {
      const times = r.sent.filter((s) => s.cmd.agentId === ref).map((s) => s.at);
      for (const t of times) expect(times.filter((x) => x >= t && x < t + 5000).length).toBeLessThanOrEqual(3);
    }
    expect(r.body.stats.droppedBudget).toBeGreaterThan(0);
  });

  it("keeps the line ring and offers the planner its context only while on", () => {
    const on = rig();
    on.body.onLine({ speaker: "duda", to: "rafa", text: long });
    expect(on.body.planCtx("rafa")?.lines).toHaveLength(1);
    expect(rig({ likeness: 0 }).body.planCtx("rafa")).toBeUndefined();
  });
});
