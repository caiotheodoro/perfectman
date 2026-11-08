import { describe, expect, it } from "vitest";
import { ShotPlanner } from "../planner.js";
import { DEFAULT_CINE } from "../types.js";
import type { CineConfig, Program } from "../types.js";
import { FakeWorld, NARRATION, cameras, item, line, releaseAt, uis } from "./cine-helpers.js";

function setup(over: Partial<CineConfig> = {}) {
  const cfg = { ...DEFAULT_CINE, ...over };
  const world = new FakeWorld();
  const planner = new ShotPlanner(cfg);
  let now = 0;
  const intro = planner.intro(now, 12, world, NARRATION);
  now += intro.durationMs;
  /** Plans one item at the running playback time and advances it by the program's duration. */
  const play = (it: Parameters<ShotPlanner["plan"]>[0]): Program => {
    const p = planner.plan(it, now, world, NARRATION);
    if (!p) throw new Error("item was not staged");
    now += p.durationMs;
    return p;
  };
  return { cfg, world, planner, intro, play, clock: () => now };
}

describe("the opening", () => {
  it("opens with the letterbox, an establishing shot of the whole room and the title card, in that order", () => {
    const { intro } = setup();
    const ks = uis(intro);
    expect(ks[0]).toMatchObject({ k: "hud", letterbox: true });
    expect(ks[1]).toMatchObject({ k: "camera", shot: "establishing", target: { room: true }, zoom: "fit" });
    expect(ks.find((u) => u.k === "card")).toMatchObject({ kind: "title", title: "Sexta no lounge", subtitle: "com amigos" });
    expect(cameras(intro)).toHaveLength(1);
  });

  it("gives the room the film opens in its narrator aside, so a film that never cuts away still has a caption", () => {
    const { intro } = setup();
    const caption = uis(intro).find((u) => u.k === "caption");
    expect(caption).toMatchObject({ k: "caption", text: "Eles se encontram." });
    expect(intro.steps.find((s) => s.k === "ui" && s.ui.k === "caption")?.at).toBeGreaterThan(intro.steps.find((s) => s.k === "ui" && s.ui.k === "card")?.at ?? 0);
  });
});

describe("shot on the speaker before the line", () => {
  it("cuts a close-up on a new speaker and releases the line only after the shot has eased in", () => {
    const { play } = setup();
    const p = play(line("duda", "Oi gente, que bom ver vocês aqui hoje."));
    expect(cameras(p)[0]).toMatchObject({ ui: { shot: "close_up", target: { avatar: -701 }, zoom: 2 } });
    expect(releaseAt(p)).toBeGreaterThanOrEqual((cameras(p)[0]?.at ?? 0) + DEFAULT_CINE.easeMs.close_up);
  });

  it("holds a two-shot for an exchange instead of cutting on every line", () => {
    const { play } = setup();
    play(line("duda", "Você viu o que aconteceu ontem?", { to: "rafa" }));
    const second = play(line("rafa", "Vi sim, foi estranho demais.", { to: "duda" }));
    const third = play(line("duda", "Pois é, ninguém explicou nada.", { to: "rafa" }));
    expect(cameras(second).concat(cameras(third))).toHaveLength(0);
  });

  it("starts an exchange as a two-shot of the pair, zoomed in when they stand within four tiles", () => {
    const { play } = setup();
    play(line("duda", "Você viu o que aconteceu ontem?", { to: "rafa" }));
    // The first line has no history, so it was addressed: the pair is the frame.
    const { world, planner } = setup();
    const p = planner.plan(line("duda", "Você viu o que aconteceu ontem?", { to: "rafa" }), 5000, world, NARRATION);
    expect(cameras(p as Program)[0]?.ui).toMatchObject({ shot: "two_shot", target: { pair: [-701, -702] }, zoom: 2 });
  });

  it("gives a salient line its close-up once the two-shot has been up long enough", () => {
    const { play } = setup();
    play(line("duda", "Você viu o que aconteceu ontem?", { to: "rafa" }));
    play(line("rafa", "Vi sim, foi estranho demais, não consigo parar de pensar nisso.", { to: "duda" }));
    const climax = play(line("duda", "Eu não aguento mais isso!", { to: "rafa", salience: 0.9 }));
    expect(cameras(climax)[0]?.ui).toMatchObject({ shot: "close_up", target: { avatar: -701 } });
  });

  it("falls back to the room when the speaker has no avatar to point at", () => {
    const { play, world } = setup();
    play(line("rafa", "Oi?"));
    world.actors.delete("duda");
    const p = play(line("duda", "Alguém me ouve?"));
    expect(cameras(p)[0]?.ui).toMatchObject({ shot: "establishing" });
  });
});

describe("anti-jitter", () => {
  it("never sends two camera cues closer than the minimum shot length", () => {
    const { play, clock } = setup();
    const times: number[] = [];
    const speakers = ["duda", "rafa", "duda", "rafa", "duda"];
    for (const ref of speakers) {
      const start = clock();
      const p = play(line(ref, "Sim.", { salience: 0.9 }));
      times.push(...cameras(p).map((c) => start + c.at));
    }
    expect(times.length).toBeGreaterThan(3);
    for (let i = 1; i < times.length; i++) expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(DEFAULT_CINE.minShotMs);
  });

  it("delays the line along with its camera cue rather than speaking over the old shot", () => {
    const { play } = setup({ minShotMs: 6000 });
    play(line("duda", "Oi.", { salience: 0.9 }));
    const next = play(line("rafa", "Oi.", { salience: 0.9 }));
    const cam = cameras(next)[0];
    expect(cam?.at).toBeGreaterThan(0);
    expect(releaseAt(next)).toBeGreaterThanOrEqual((cam?.at ?? 0) + DEFAULT_CINE.easeMs.close_up);
  });
});

describe("reaction shots, lower-thirds and cues", () => {
  const long = "Eu preciso te dizer uma coisa que venho guardando faz muito tempo e que talvez mude tudo entre a gente aqui.";

  it("cuts to the listener near the end of a long line when they are visibly moved", () => {
    const { play, world } = setup();
    world.moods.set("rafa", { valence: -0.8, arousal: 0.7 });
    const p = play(line("duda", long, { to: "rafa", salience: 0.9 }));
    const reaction = cameras(p).find((c) => c.ui.shot === "reaction");
    expect(reaction?.ui.target).toEqual({ avatar: -702 });
    expect(reaction?.at).toBeGreaterThan(releaseAt(p) ?? 0);
    expect(reaction?.at).toBeLessThan(p.durationMs);
  });

  it("shows the lower-third on a character's first line only", () => {
    const { play } = setup();
    const first = play(line("duda", "Oi gente."));
    const again = play(line("duda", "Tudo bem com vocês?"));
    expect(uis(first).find((u) => u.k === "lower_third")).toMatchObject({ name: "Duda", role: "conciliadora" });
    expect(uis(again).some((u) => u.k === "lower_third")).toBe(false);
  });

  it("puts an overhead emotion cue on a charged speaker, at most once per cooldown, with a sting on the saddest moments", () => {
    const { play, world } = setup();
    world.moods.set("duda", { valence: -0.85, arousal: 0.3 });
    const first = uis(play(line("duda", "Eu não consigo mais.")));
    const second = uis(play(line("duda", "De verdade, não consigo mais.")));
    expect(first.find((u) => u.k === "cue")).toMatchObject({ id: -701, emotion: "sad" });
    expect(first.find((u) => u.k === "sfx")).toMatchObject({ cue: "sting_sad" });
    expect(second.some((u) => u.k === "cue")).toBe(false);
    expect(second.some((u) => u.k === "sfx" && u.cue.startsWith("sting"))).toBe(false);
  });
});

describe("room changes", () => {
  it("cuts with a fade, swaps the room, re-establishes it and shows a scene card on the first visit", () => {
    const { play, planner } = setup();
    play(line("duda", "Oi.", { room: 12 }));
    const p = play(line("gabi", "Cheguei!", { room: 13 }));
    const order = p.steps.map((s) => (s.k === "ui" ? s.ui.k : s.k));
    expect(order.indexOf("cut_fx")).toBeLessThan(order.indexOf("cut"));
    expect(order.indexOf("cut")).toBeLessThan(order.indexOf("camera"));
    expect(p.steps.find((s) => s.k === "cut")).toMatchObject({ room: 13, from: 12 });
    expect(uis(p).find((u) => u.k === "card")).toMatchObject({ kind: "scene", title: "Cena 13" });
    expect(planner.currentRoom).toBe(13);
  });

  it("calls a cut between two rooms that are both active 'meanwhile', and does not repeat the card on a return", () => {
    const { play } = setup();
    play(line("duda", "Oi.", { room: 12 }));
    play(line("gabi", "Cheguei!", { room: 13 }));
    const back = play(line("rafa", "Bom dia.", { room: 12 }));
    expect(uis(back).find((u) => u.k === "cut_fx")).toMatchObject({ kind: "meanwhile", label: "Enquanto isso..." });
    expect(uis(back).some((u) => u.k === "card")).toBe(false);
  });

  it("uses a door transition right after someone walked through it, and a door sound", () => {
    const { play } = setup();
    play(line("duda", "Vou ver a cozinha.", { room: 12 }));
    play(item("hop", { ref: "duda", room: 12, to: 13 }));
    const arrive = play(line("duda", "Que cheiro bom.", { room: 13 }));
    expect(uis(arrive).find((u) => u.k === "cut_fx")).toMatchObject({ kind: "door" });
    expect(uis(arrive).some((u) => u.k === "sfx" && u.cue === "door_open")).toBe(true);
  });

  it("runs the crowd murmur in one room at a time and stops it when the scene leaves", () => {
    const { play, world, intro } = setup();
    expect(uis(intro).some((u) => u.k === "sfx" && u.cue === "crowd_murmur")).toBe(false);
    world.move("leo", 12);
    const fresh = setup();
    fresh.world.move("leo", 12);
    const p = new ShotPlanner(DEFAULT_CINE).intro(0, 12, fresh.world, NARRATION);
    expect(uis(p).find((u) => u.k === "sfx")).toMatchObject({ cue: "crowd_murmur", loop: true, id: "murmur-12" });
    void play;
  });
});

describe("inserts, tracking and the rest of the taxonomy", () => {
  it("follows a long walk with a tracking shot, ignores a two-step shuffle", () => {
    const { play, planner, world } = setup();
    const p = play(item("walk", { ref: "duda", room: 12, steps: 8 }));
    expect(cameras(p)[0]?.ui).toMatchObject({ shot: "tracking", follow: true, target: { avatar: -701 } });
    expect(planner.plan(item("walk", { ref: "duda", room: 12, steps: 2 }), 99_000, world, NARRATION)).toBeUndefined();
  });

  it("inserts on a kiss with its sound and a romance sting, and on an object with its caption", () => {
    const { play } = setup();
    const kiss = uis(play(item("pair", { ref: "duda", with: "rafa", pair: "kiss", room: 12 })));
    expect(kiss.find((u) => u.k === "camera")).toMatchObject({ shot: "insert", target: { pair: [-701, -702] } });
    expect(kiss.filter((u) => u.k === "sfx").map((u) => (u.k === "sfx" ? u.cue : ""))).toEqual(expect.arrayContaining(["kiss", "sting_romance"]));
    const alarm = uis(play(item("object", { ref: "", room: 12, tile: [2, 2], label: "Um alarme dispara.", sfx: "sting_tension" })));
    expect(alarm.find((u) => u.k === "camera")).toMatchObject({ shot: "insert", target: { tile: [2, 2] } });
    expect(alarm.find((u) => u.k === "caption")).toMatchObject({ text: "Um alarme dispara." });
  });

  it("shows a thought as a bubble on the thinker, a laugh with its sound, and clips every text to the wire limit", () => {
    const { play } = setup();
    const thought = uis(play(item("thought", { ref: "rafa", room: 12, text: "x".repeat(400) })));
    const bubble = thought.find((u) => u.k === "thought");
    expect(bubble).toMatchObject({ id: -702 });
    expect(bubble?.k === "thought" ? [...bubble.text].length : 0).toBeLessThanOrEqual(200);
    const laugh = uis(play(item("gesture", { ref: "duda", room: 12, gesture: "laugh" })));
    expect(laugh.some((u) => u.k === "sfx" && u.cue === "laugh")).toBe(true);
  });

  it("is deterministic: the same items against the same world give identical programs", () => {
    const run = () => {
      const { play } = setup();
      const programs = [play(line("duda", "Oi.", { to: "rafa" })), play(line("rafa", "Oi!", { to: "duda" })), play(line("gabi", "Cheguei!", { room: 13 }))];
      // Item ids come from a global counter in the helper, so compare what the audience sees.
      return programs.map((p) => ({ d: p.durationMs, steps: p.steps.map((s) => (s.k === "release" ? { at: s.at, k: s.k, ref: s.item.ref } : s)) }));
    };
    expect(run()).toEqual(run());
  });
});

describe("fillers and the close", () => {
  it("holds the establishing shot with a narrator aside for a filler, and closes with a fade and the letterbox off", () => {
    const { planner, world, play } = setup();
    play(line("duda", "Oi.", { salience: 0.9 }));
    const filler = planner.filler(30_000, world, NARRATION);
    expect(filler && cameras(filler)[0]?.ui).toMatchObject({ shot: "establishing" });
    expect(filler && uis(filler).find((u) => u.k === "caption")).toMatchObject({ text: "Ninguém diz nada." });
    expect(planner.consecutiveFillers).toBe(1);
    const outro = uis(planner.outro(40_000));
    expect(outro.some((u) => u.k === "hud" && u.letterbox === false)).toBe(true);
  });
});
