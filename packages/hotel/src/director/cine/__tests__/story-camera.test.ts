import { describe, expect, it } from "vitest";
import { ACT_FX, SFX_FOR_MOVE, ShotPlanner } from "../planner.js";
import { cueViolations, canonicalize } from "../cue-vocab.js";
import { computeMetrics, minKindsInWindow } from "../metrics.js";
import { DEFAULT_CINE } from "../types.js";
import type { CameraIntent } from "../types.js";
import { FakeWorld, NARRATION, item, line, rig, uis } from "./cine-helpers.js";
import type { PerfectmanUi } from "../../generated.js";

const fx = (p: { steps: Array<{ k: string; ui?: PerfectmanUi }> }, move?: string) => p.steps.flatMap((s) => (s.k === "ui" && s.ui?.k === "camera_fx" && (!move || s.ui.move === move) ? [s.ui] : []));

function planner() {
  const world = new FakeWorld();
  const pl = new ShotPlanner(DEFAULT_CINE);
  let now = 0;
  now += pl.intro(now, 12, world, NARRATION).durationMs;
  const play = (it: Parameters<ShotPlanner["plan"]>[0]) => {
    const p = pl.plan(it, now, world, NARRATION);
    if (!p) throw new Error("not staged");
    now += p.durationMs;
    return p;
  };
  return { world, pl, play, clock: () => now, skip: (ms: number) => { now += ms; } };
}

describe("story-aware framing", () => {
  it("pushes in slowly during the escalation, a little more with each line, to a ceiling, with the tension sting once", () => {
    const { pl, play } = planner();
    pl.setPhase("escalation");
    const first = play(line("duda", "Você viu o que aconteceu ontem?", { to: "rafa" }));
    const dollies = fx(first, "dolly");
    expect(dollies).toHaveLength(1);
    expect(dollies[0]).toMatchObject({ move: "dolly", curve: "linear" });
    expect((dollies[0] as { to_zoom: number }).to_zoom).toBeGreaterThan(1);
    expect((dollies[0] as { ms: number }).ms).toBeGreaterThanOrEqual(1500);
    expect(uis(first).filter((u) => u.k === "sfx" && u.cue === "sting_tension")).toHaveLength(1);
    const zooms: number[] = [];
    for (let i = 0; i < 6; i++) {
      const p = play(line(i % 2 ? "duda" : "rafa", "Pois é, ninguém explicou nada para ninguém aqui.", { to: i % 2 ? "rafa" : "duda" }));
      zooms.push(...fx(p, "dolly").map((d) => (d as { to_zoom: number }).to_zoom));
    }
    expect(zooms.length).toBeGreaterThan(0);
    expect(Math.max(...zooms)).toBeLessThanOrEqual(2 * (1 + 2 * DEFAULT_CINE.escalationDolly) + 1e-9);
    expect(Math.max(...zooms)).toBeLessThanOrEqual(2.5);
  });

  it("does not push in outside the escalation", () => {
    const { play } = planner();
    expect(fx(play(line("duda", "Você viu o que aconteceu ontem?", { to: "rafa" })))).toHaveLength(0);
  });

  it("cuts to a close-up on a quiet line at the reversal and the climax, with the edges closing in once", () => {
    const { pl, play, skip } = planner();
    play(line("duda", "Você viu o que aconteceu ontem?", { to: "rafa" }));
    skip(3000);
    pl.setPhase("climax");
    const p = play(line("rafa", "Foi você.", { to: "duda", salience: 0.1 }));
    const cam = p.steps.flatMap((s) => (s.k === "ui" && s.ui.k === "camera" ? [s.ui] : []));
    expect(cam[0]).toMatchObject({ shot: "close_up", zoom: 2 });
    expect(fx(p, "vignette")).toHaveLength(1);
    expect(fx(p, "vignette")[0]).toMatchObject({ intensity: 0.55, hold_ms: DEFAULT_CINE.climaxVignetteMs });
    skip(3000);
    const again = play(line("duda", "Não fui eu.", { to: "rafa", salience: 0.1 }));
    expect(fx(again, "vignette"), "not twice in 12 s").toHaveLength(0);
  });

  it("establishes the room wide when someone comes in", () => {
    const { pl, world, skip } = planner();
    skip(5000);
    const p = pl.plan(item("entrance", { ref: "gabi", room: 12 }), 9000, world, NARRATION);
    expect(p?.steps.find((s) => s.k === "ui" && s.ui.k === "camera")).toMatchObject({ ui: { shot: "establishing", target: { room: true }, zoom: "fit" } });
    expect(uis(p!).some((u) => u.k === "sfx" && u.cue === "door_open")).toBe(true);
  });
});

describe("acts with a body", () => {
  it("stops the room and shakes at the table's contact time, harder for a punch than a slap than a shove", () => {
    const { pl } = planner();
    const shake = (verb: string) => {
      const p = pl.planAct({ kind: "act", id: `a-${verb}`, seq: 1, at: 0, room: 12, ref: "duda", verb, with: "rafa", contactMs: ACT_FX[verb]?.contactMs ?? 0, salience: 0.9 }, 10_000);
      return { p, shake: fx(p!, "shake")[0] as { amp_px: number } | undefined, stop: fx(p!, "hitstop")[0] as { ms: number } | undefined, at: p!.steps.find((s) => s.k === "ui" && s.ui.k === "camera_fx")?.at };
    };
    const [shove, slap, punch] = [shake("shove"), shake("slap"), shake("punch")];
    expect(shove.at).toBe(250);
    expect(slap.at).toBe(300);
    expect(punch.at).toBe(350);
    expect(shove.shake!.amp_px).toBeLessThan(slap.shake!.amp_px);
    expect(slap.shake!.amp_px).toBeLessThan(punch.shake!.amp_px);
    expect(punch.stop!.ms).toBeGreaterThan(slap.stop!.ms);
    expect(slap.stop!.ms).toBeLessThanOrEqual(150);
  });

  it("drops a kill into slow motion with a vignette and a red cast, and leaves the camera for the next line to frame afresh", () => {
    const { pl } = planner();
    const p = pl.planAct({ kind: "act", id: "k", seq: 1, at: 0, room: 12, ref: "duda", verb: "kill", with: "rafa", contactMs: 500, salience: 0.9 }, 10_000)!;
    expect(fx(p, "slowmo")[0]).toMatchObject({ factor: 0.35, ms: 1500 });
    expect(fx(p, "vignette")[0]).toMatchObject({ intensity: 0.65 });
    expect(fx(p, "grade")[0]).toMatchObject({ tint: "#5a0d0d" });
    expect(uis(p).some((u) => u.k === "sfx" && u.cue === SFX_FOR_MOVE.slowmo?.cue)).toBe(true);
    expect(p.steps.every((s) => s.k !== "ui" || s.ui.k !== "camera"), "the table's own shots are left alone").toBe(true);
    expect(p.steps.map((s) => s.k === "ui" && s.at).filter((a) => typeof a === "number").every((a) => (a as number) >= 500)).toBe(true);
  });

  it("every fx the acts ask for passes the cue vocabulary", () => {
    const { pl } = planner();
    for (const verb of Object.keys(ACT_FX)) {
      const p = pl.planAct({ kind: "act", id: verb, seq: 1, at: 0, room: 12, ref: "duda", verb, contactMs: ACT_FX[verb]?.contactMs ?? 0, salience: 0.9 }, 10_000);
      for (const ui of p ? uis(p) : []) expect(cueViolations(ui), `${verb}: ${JSON.stringify(ui)}`).toEqual([]);
    }
  });

  it("the director plays the act's moves on their own clock, with lead time, while a line holds the stage", async () => {
    const r = rig();
    r.director.start();
    await r.clock.advance(6000);
    r.say("duda", "Uma fala longa o bastante para ocupar a tela por um bom tempo, sem pressa nenhuma de acabar mesmo.");
    await r.clock.advance(1000);
    const before = r.frames().length;
    r.exec.send([{ agentId: "duda", cmd: "act", actId: "a1", verb: "slap", with: "rafa" } as never]);
    expect(r.delivered.map((d) => d.cmd.cmd)).toContain("act");
    await r.clock.advance(1000);
    const mine = r.frames().slice(before).map((f) => f.ui).filter((u) => u.k === "camera_fx");
    expect(mine.map((u) => (u as { move: string }).move)).toEqual(["hitstop", "shake"]);
    expect((mine[0] as { in_ms?: number }).in_ms).toBeGreaterThan(0);
  });
});

describe("camera intents of a beat sheet", () => {
  const world = new FakeWorld();
  const go = (intent: CameraIntent, over: Partial<ShotPlanner> = {}) => {
    const pl = new ShotPlanner(DEFAULT_CINE);
    pl.intro(0, 12, world, NARRATION);
    void over;
    return pl.planIntent(intent, 20_000, world);
  };

  it("maps a close-up with a slow dolly in onto a camera cue and a dolly after the ease", () => {
    const p = go({ shot: "close_up", on: "rafa", move: "dolly_in", amount: 0.4, ms: 5000 })!;
    expect(p.steps.map((s) => (s.k === "ui" ? s.ui.k : s.k))).toEqual(["camera", "camera_fx"]);
    const cam = uis(p)[0];
    expect(cam).toMatchObject({ k: "camera", shot: "close_up", target: { avatar: -702 }, zoom: 2 });
    const move = fx(p)[0] as { to_zoom: number; ms: number };
    expect(move.to_zoom).toBe(2.5);
    expect(move.ms).toBe(5000);
    expect(p.steps[1]!.at).toBeGreaterThanOrEqual(DEFAULT_CINE.easeMs.close_up);
  });

  it("two shots take a pair, dolly out comes with a whoosh, and every move has a default length", () => {
    const wide = go({ shot: "two_shot", on: ["duda", "rafa"], move: "dolly_out" })!;
    expect(uis(wide)[0]).toMatchObject({ shot: "two_shot", target: { pair: [-701, -702] } });
    expect(fx(wide)[0]).toMatchObject({ move: "dolly", curve: "out", ms: 2500 });
    expect(uis(wide).some((u) => u.k === "sfx" && u.cue === "whoosh_short")).toBe(true);
    for (const move of ["shake", "slowmo", "vignette", "hitstop"] as const) {
      const p = go({ shot: "close_up", on: "duda", move })!;
      for (const ui of uis(p)) expect(cueViolations(ui), `${move}: ${JSON.stringify(ui)}`).toEqual([]);
      expect(fx(p)[0]).toMatchObject({ move });
    }
    expect(fx(go({ shot: "close_up", on: "duda", move: "slowmo", amount: 0.05 })!)[0]).toMatchObject({ factor: 0.25 });
  });

  it("a beat that names someone who is not in the picture makes no shot, and an establishing beat needs no one", () => {
    expect(go({ shot: "close_up", on: "ghost" })).toBeUndefined();
    expect(uis(go({ shot: "establishing" })!)[0]).toMatchObject({ shot: "establishing", zoom: "fit" });
  });

  it("the director plays an intent now and remembers what the camera is on", async () => {
    const r = rig();
    expect(r.director.playIntent({ shot: "close_up", on: "duda" }), "not before the film starts").toBe(false);
    r.director.start();
    await r.clock.advance(5000);
    expect(r.director.playIntent({ shot: "close_up", on: "duda", move: "shake", amount: 8 })).toBe(true);
    await r.clock.advance(1500);
    const cues = r.frames().map((f) => f.ui);
    expect(cues.some((u) => u.k === "camera" && u.shot === "close_up" && "avatar" in u.target && u.target.avatar === -701)).toBe(true);
    expect(cues.some((u) => u.k === "camera_fx" && u.move === "shake" && u.amp_px === 8)).toBe(true);
    // The planner knows: a line by the person in the close-up needs no new shot.
    r.say("duda", "Oi.");
    await r.clock.advance(3000);
    expect(r.frames().map((f) => f.ui).filter((u) => u.k === "camera" && u.shot === "close_up")).toHaveLength(1);
  });
});

describe("camera_fx in the vocabulary", () => {
  it("flags numbers outside the ranges and canonicalize clamps them", () => {
    const bad: PerfectmanUi = { k: "camera_fx", move: "dolly", to_zoom: 9, ms: 99_999 };
    expect(cueViolations(bad).length).toBe(2);
    expect(canonicalize(bad)).toMatchObject({ to_zoom: 2.5, ms: 30_000 });
    expect(canonicalize({ k: "camera_fx", move: "slowmo", factor: 0, ms: 100 })).toMatchObject({ factor: 0.25 });
    expect(canonicalize({ k: "camera_fx", move: "grade", intensity: 0.5, ms: 100, tint: "red" }), "a grade with no #rrggbb is dropped").toBeUndefined();
    expect(cueViolations({ k: "camera_fx", move: "hitstop", ms: 120 })).toEqual([]);
  });
});

/**
 * A four-minute scene in one room as the engine would feed it: an escalating exchange, a late entrance, a slap at
 * 2:30, a reveal and a quiet climax. Pins the norms the planner steers by until `cinema-norms` is published:
 * at least 4 shot kinds in the window, 2 to 6 camera changes a minute, and the camera on the speaker.
 */
describe("a four-minute scene against the norms", () => {
  it("shows at least four kinds of shot, cuts two to six times a minute, stays on the speaker and drops nothing as stale", async () => {
    const r = rig();
    r.director.start();
    const talk = [
      ["duda", "rafa", "Você viu o que aconteceu ontem à noite no corredor?"],
      ["rafa", "duda", "Vi sim, foi estranho demais, ninguém quis explicar nada."],
      ["duda", "rafa", "Alguém sabe de quem era aquela chave que apareceu na mesa?"],
      ["rafa", "duda", "Não sei, mas eu ficaria quieto se fosse você, de verdade."],
      ["duda", "rafa", "Quieto por quê? Você sabe de alguma coisa que eu não sei?"],
      ["rafa", "duda", "Sei que a gente combinou uma coisa e agora tudo mudou de lugar."],
    ] as const;
    r.world.move("gabi", 12);
    r.director.setPhase("setup");
    let i = 0;
    const say = (n: number) => { for (let k = 0; k < n; k++) { const [a, b, text] = talk[i++ % talk.length]!; r.say(a, text, "say", b); } };
    say(2);
    await r.clock.advance(20_000);
    r.director.setPhase("inciting");
    r.exec.send([{ agentId: "gabi", cmd: "walk", to: [4, 5], plan: "gabi:enter" }]);
    say(2);
    await r.clock.advance(25_000);
    r.director.setPhase("escalation");
    say(5);
    await r.clock.advance(60_000);
    r.director.setPhase("reversal");
    r.say("duda", "Foi você.", "say", "rafa");
    await r.clock.advance(14_000);
    say(3);
    await r.clock.advance(30_000);
    r.director.setPhase("climax");
    r.exec.send([{ agentId: "duda", cmd: "act", actId: "a9", verb: "slap", with: "rafa" } as never]);
    r.say("rafa", "Não acredito.", "say", "duda");
    await r.clock.advance(20_000);
    r.director.setPhase("aftermath");
    say(2);
    await r.clock.advance(60_000);
    const m = r.director.metrics();
    expect(m.durationMs).toBeGreaterThan(200_000);
    expect(m.variety.minWindowKinds, JSON.stringify(m.variety)).toBeGreaterThanOrEqual(4);
    expect(m.variety.meets).toBe(true);
    expect(m.cuts.shotsPerMin, JSON.stringify(m.cuts)).toBeGreaterThanOrEqual(2);
    expect(m.cuts.shotsPerMin).toBeLessThanOrEqual(6);
    expect(m.shotOnSpeaker.ratio).toBeGreaterThanOrEqual(0.9);
    expect(m.staleDrops.count).toBe(0);
    expect(m.fx.byMove.hitstop).toBe(1);
    expect(m.fx.byMove.dolly ?? 0).toBeGreaterThan(0);
    expect(m.deadAir.gapsOverLimit).toBe(0);
  });
});

describe("the variety and stale metrics", () => {
  it("counts the leanest window and the stale share", () => {
    const shots = [{ t: 0, shot: "two_shot" }, { t: 10_000, shot: "reaction" }, { t: 130_000, shot: "close_up" }, { t: 200_000, shot: "establishing" }, { t: 300_000, shot: "two_shot" }];
    expect(minKindsInWindow(shots, 0, 100_000, 240_000), "whole film when shorter than a window").toBe(4);
    expect(minKindsInWindow(shots, 0, 320_000, 240_000)).toBe(2);
    const m = computeMetrics([
      { t: 0, k: "start", run: 1, room: 12, lang: "pt-BR" },
      { t: 100, k: "cue", room: 12, ui: { k: "camera", shot: "two_shot", target: { room: true }, zoom: 1, ease_ms: 0, hold_ms: 0 } },
      { t: 200, k: "drop", beat: "b1", why: "stale", item: "walk" },
      { t: 300, k: "cue", room: 12, ui: { k: "camera_fx", move: "shake", amp_px: 5, ms: 300 } },
      { t: 5000, k: "end", reason: "completed" },
    ]);
    expect(m.staleDrops).toEqual({ count: 1, rate: 0.5 });
    expect(m.fx).toEqual({ count: 1, byMove: { shake: 1 } });
    expect(m.variety).toMatchObject({ distinct: 1, target: 4, meets: false });
  });
});
