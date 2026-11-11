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
import { ShotPlanner, readingMs } from "../director/cine/planner.js";
import { DEFAULT_CINE } from "../director/cine/types.js";
import type { LineItem } from "../director/cine/types.js";
import { FakeWorld, NARRATION, line as cineLine, rig } from "../director/cine/__tests__/cine-helpers.js";
import { HotelGateway } from "../gateway/hotel-gateway.js";
import type { GatewayHuman } from "../embodiment/human/human-body.js";
import { ManualClock } from "../testing/manual-clock.js";
import { cineLead } from "../embodiment/human/turn.js";
import type { BodyCommand } from "@perfectman/shared";
import type { DeliveryMessage } from "@perfectman/server/hotel";
import type { SpaceOpts } from "../testing/fixtures.js";
import { seededRng } from "../util/stats.js";

const human = (over: Partial<HumanPlanCtx> = {}): HumanPlanCtx => ({ h: 0.6, seed: 11, lines: [], ...over });
const run = (o: SpaceOpts, over: Partial<PlanInput> = {}): PlannedCommand[] =>
  plan({ space: space(o), agentState: agentState(), committedEvents: [], now: NOW, rng: seededRng(7), ...over });
const line = (over: Partial<HumanLine> & { n: number; speaker: string }): HumanLine => ({ atMs: NOW - 1000, text: "oi", words: 1, mode: "say", mentioned: [], question: false, stress: 0, amusement: false, ...over });

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



const HEATED = { valence: -0.5, arousal: 0.9 };

describe("turn-taking in the film", () => {
  const planned = (h: number, text: string, seed = 5) => {
    const world = new FakeWorld();
    const pl = new ShotPlanner({ ...DEFAULT_CINE, ...(h > 0 ? { human: { likeness: h, seed } } : {}) });
    pl.intro(0, 12, world, NARRATION);
    return { world, pl, program: pl.plan(cineLine("duda", text, { to: "rafa" }), 10_000, world, NARRATION) };
  };
  const lead = (p: ReturnType<typeof planned>["program"]): number => {
    const typing = p?.steps.find((x) => x.k === "typing" && x.on !== false);
    const release = p?.steps.find((x) => x.k === "release");
    return (release?.at ?? 0) - (typing?.at ?? 0);
  };

  it("keeps the old 500 ms bubble at h = 0 and lets it grow with the line above 0", () => {
    const short = "Oi, tudo bem?";
    const long = "Eu preciso te contar uma coisa que aconteceu ontem à noite e que muda tudo o que a gente combinou.";
    expect(lead(planned(0, short).program)).toBe(DEFAULT_CINE.typingLeadMs);
    expect(lead(planned(0, long).program)).toBe(DEFAULT_CINE.typingLeadMs);
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const shortMean = seeds.reduce((s, n) => s + lead(planned(1, short, n).program), 0) / seeds.length;
    const longMean = seeds.reduce((s, n) => s + lead(planned(1, long, n).program), 0) / seeds.length;
    expect(longMean).toBeGreaterThan(shortMean + 800);
  });

  it("cineLead is the base at h = 0 and bounded above it", () => {
    expect(cineLead({ chars: 90, baseMs: 500, h: 0, seed: 1, actor: "duda", n: 1 })).toEqual({ leadMs: 500 });
    const hi = cineLead({ chars: 5000, baseMs: 500, h: 1, seed: 1, actor: "duda", n: 1 });
    expect(hi.leadMs).toBeLessThanOrEqual(3200);
  });

  it("starts the next speaker's bubble inside the line before when its answer is already queued", () => {
    const world = new FakeWorld();
    const pl = new ShotPlanner({ ...DEFAULT_CINE, human: { likeness: 1, seed: 2 } });
    pl.intro(0, 12, world, NARRATION);
    const next = cineLine("rafa", "Eu discordo, e vou explicar por quê agora mesmo.", { to: "duda" });
    pl.peek = () => next as LineItem;
    const program = pl.plan(cineLine("duda", "Eu acho que a gente devia conversar sobre isso com calma.", { to: "rafa" }), 10_000, world, NARRATION);
    const early = program?.steps.find((x) => x.k === "typing" && x.ref === "rafa");
    const release = program?.steps.find((x) => x.k === "release");
    expect(early?.at).toBeGreaterThan(release?.at ?? Number.POSITIVE_INFINITY);
    // and its own program starts with the bubble already up: no second typing step
    const answer = pl.plan(next, 20_000, world, NARRATION);
    expect(answer?.steps.filter((x) => x.k === "typing" && x.on !== false)).toHaveLength(0);
  });

  it("talks over a heated line when a heated answer is queued: cut text ends in a dash and the line holds the stage for less", () => {
    const text = "Você mentiu pra todo mundo nessa mesa e agora quer fingir que não sabe de nada, seu covarde!";
    let cut: { cut: string; holdMs: number } | undefined;
    for (let seq = 1; seq <= 40 && !cut; seq++) {
      const world = new FakeWorld();
      world.moods.set("duda", HEATED);
      world.moods.set("rafa", HEATED);
      const pl = new ShotPlanner({ ...DEFAULT_CINE, human: { likeness: 1, seed: 9 } });
      pl.peek = () => cineLine("rafa", "Cala a boca, seu idiota!", { to: "duda" }) as LineItem;
      cut = pl.talkOver({ ...cineLine("duda", text, { to: "rafa" }), seq }, 10_000, world);
    }
    expect(cut?.cut.endsWith("—")).toBe(true);
    expect(text.startsWith(cut?.cut.slice(0, -1) ?? "?")).toBe(true);
    expect(cut?.holdMs).toBeLessThan(readingMs(text, DEFAULT_CINE));
  });

  it("never talks over at h = 0, with no answer queued, or between calm speakers", () => {
    const world = new FakeWorld();
    world.moods.set("duda", HEATED);
    world.moods.set("rafa", HEATED);
    const text = "Você mentiu pra todo mundo nessa mesa e agora quer fingir que não sabe de nada, seu covarde!";
    const answer = cineLine("rafa", "Cala a boca, seu idiota!", { to: "duda" }) as LineItem;
    const tries = Array.from({ length: 40 }, (_, seq) => ({ ...cineLine("duda", text, { to: "rafa" }), seq: seq + 1 }));
    const off = new ShotPlanner({ ...DEFAULT_CINE });
    off.peek = () => answer;
    const alone = new ShotPlanner({ ...DEFAULT_CINE, human: { likeness: 1, seed: 9 } });
    const calm = new FakeWorld();
    const calmPl = new ShotPlanner({ ...DEFAULT_CINE, human: { likeness: 1, seed: 9 } });
    calmPl.peek = () => answer;
    expect(tries.some((t) => off.talkOver(t, 1, world) !== undefined)).toBe(false);
    expect(tries.some((t) => alone.talkOver(t, 1, world) !== undefined)).toBe(false);
    expect(tries.some((t) => calmPl.talkOver(t, 1, calm) !== undefined)).toBe(false);
  });

  it("the director plays the cut text and reports it to the human layer", async () => {
    const text = "Você mentiu pra todo mundo nessa mesa e agora quer fingir que não sabe de nada, seu covarde!";
    let found: string | undefined;
    for (let seed = 1; seed <= 30 && !found; seed++) {
      const heard: Array<{ text: string; cut: boolean }> = [];
      const r = rig({ human: { likeness: 1, seed } });
      r.world.moods.set("duda", HEATED);
      r.world.moods.set("rafa", HEATED);
      r.director.start();
      r.say("duda", text, "say", "rafa");
      r.say("rafa", "Cala a boca, seu idiota!", "say", "duda");
      await r.clock.advance(60_000);
      const first = r.spoken()[0]?.cmd;
      if (first?.cmd === "chat" && first.text.endsWith("—")) {
        found = first.text;
        expect(r.spoken()).toHaveLength(2);
        expect(r.director.track.entries.some((e) => e.k === "line" && e.text === found)).toBe(true);
      }
      void heard;
    }
    expect(found).toMatch(/—$/);
  });
});

describe("the chat gateway under the human layer", () => {
  const msg = (agentId: string, content: string): DeliveryMessage => ({ kind: "message", agentId, content, salience: "low" }) as DeliveryMessage;
  function rigGateway(human?: GatewayHuman) {
    const clock = new ManualClock();
    const sent: Array<{ at: number; cmd: BodyCommand }> = [];
    const gateway = new HotelGateway({
      clock,
      rng: () => 0.5,
      executor: { send: (cmds) => cmds.forEach((cmd) => sent.push({ at: clock.now(), cmd })), sendThought: () => undefined },
      cast: new Map([["duda", { name: "Duda", responseDelayMs: [1000, 1000] as const }], ["rafa", { name: "Rafa", responseDelayMs: [1000, 1000] as const }]]),
      roomOfChannel: () => "12",
      roomOfAgent: () => "12",
      ...(human ? { human } : {}),
    });
    return { clock, gateway, sent, typingOn: () => sent.filter((s) => s.cmd.cmd === "typing" && s.cmd.on).map((s) => s.at), chats: () => sent.filter((s) => s.cmd.cmd === "chat") };
  }
  const fakeHuman = (over: Partial<GatewayHuman> = {}): GatewayHuman => ({
    likeness: 1,
    think: () => 1500,
    typing: (_a, text, think) => ({ thinkMs: think, typingMs: text.length * 50, totalMs: think + text.length * 50 }),
    interrupt: () => undefined,
    approach: () => undefined,
    note: () => undefined,
    ...over,
  });

  it("brings the bubble up after the think time and lands the line when the typing is done", async () => {
    const { clock, gateway, typingOn, chats } = rigGateway(fakeHuman());
    const t0 = clock.now();
    gateway.noteConsult("duda", t0);
    expect(typingOn()).toEqual([]);
    await clock.advance(1500);
    expect(typingOn()).toEqual([t0 + 1500]);
    await gateway.sendAgentMessage("room:12", msg("duda", "a".repeat(40)));
    await clock.advance(1999);
    expect(chats()).toHaveLength(0);
    await clock.advance(1);
    expect(chats()[0]?.at).toBe(t0 + 1500 + 2000);
  });

  it("an addressed consult keeps the bubble at once, as it always did", () => {
    const { clock, gateway, typingOn } = rigGateway(fakeHuman());
    gateway.noteConsult("duda", clock.now(), true);
    expect(typingOn()).toEqual([clock.now()]);
  });

  it("cuts a line another waiting line talks over, and lands the answer after the overlap gap", async () => {
    const human = fakeHuman({
      typing: (_a, _text, think) => ({ thinkMs: think, typingMs: 1500, totalMs: think + 1500 }),
      interrupt: (a) => (a.agentId === "duda" ? { text: "Você mentiu pra todo—", gapMs: 400 } : undefined),
    });
    const { clock, gateway, chats } = rigGateway(human);
    gateway.noteConsult("duda", clock.now());
    gateway.noteConsult("rafa", clock.now());
    await gateway.sendAgentMessage("room:12", msg("duda", "Você mentiu pra todo mundo nessa mesa!"));
    await gateway.sendAgentMessage("room:12", msg("rafa", "Cala a boca!"));
    await clock.advance(10_000);
    const lines = chats().map((c) => (c.cmd.cmd === "chat" ? c.cmd.text : ""));
    expect(lines).toEqual(["Você mentiu pra todo—", "Cala a boca!"]);
    expect((chats()[1]?.at ?? 0) - (chats()[0]?.at ?? 0)).toBeLessThanOrEqual(400);
  });
});
