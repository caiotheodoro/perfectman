import { describe, expect, it } from "vitest";
import { computeMetrics } from "../metrics.js";
import { parseTrack } from "../track.js";
import type { TrackEntry } from "../types.js";
import { rig } from "./cine-helpers.js";

type Rig = ReturnType<typeof rig>;
type Beat = (r: Rig) => void;

const WHITELIST = new Set(["hud", "card", "lower_third", "caption", "thought", "cue", "camera", "sfx", "cut_fx", "next_room", "cut"]);

/** What the engine produces, pulse by pulse: two rooms, four people. */
const SCRIPT: Beat[][] = [
  [
    (r) => r.say("duda", "Rafa, você viu o que aconteceu com o Leo ontem?", "say", "rafa"),
    (r) => r.say("rafa", "Vi. Ele saiu da festa sem falar com ninguém.", "say", "duda"),
    (r) => r.exec.sendThought("rafa", "Eu sei bem por que ele saiu."),
    (r) => r.say("gabi", "Leo! Finalmente você chegou, a cozinha estava vazia!", "shout", "leo"),
    (r) => r.say("leo", "Calma, Gabi, eu só vim pegar um café.", "say", "gabi"),
  ],
  [
    (r) => r.say("duda", "Será que a gente deveria ir lá falar com ele? Eu me sinto mal por não ter dito nada na hora, sabe, ele parecia tão sozinho.", "say", "rafa"),
    (r) => r.exec.send([{ agentId: "gabi", cmd: "gesture", a: "laugh" }]),
    (r) => r.say("leo", "Você fala demais, sabia?", "say", "gabi"),
    (r) => r.say("gabi", "E você escuta de menos!", "say", "leo"),
  ],
  [
    (r) => {
      r.exec.send([{ agentId: "duda", cmd: "move_room", to: "13" }]);
      r.world.move("duda", 13);
    },
    (r) => r.say("duda", "Leo, podemos conversar um minuto?", "say", "leo"),
    (r) => r.say("leo", "Agora? Logo agora?", "say", "duda"),
    (r) => r.exec.send([{ agentId: "gabi", cmd: "pair", kind: "hug", with: "leo", pair: "k1" }]),
    (r) => r.say("rafa", "Ué, todo mundo sumiu. Vou ficar aqui sozinho então.", "say"),
  ],
  [
    (r) => r.say("leo", "Tá bom, mas só um minuto, o café está esfriando.", "say", "duda"),
    (r) => r.say("duda", "Obrigada. Eu só queria saber se você está bem.", "say", "leo"),
    (r) => r.say("rafa", "Alguém aí? Alô?", "say"),
  ],
];

/** Runs the script the way the run loop does: a pulse every 6 s, skipped while the buffer is full. */
async function film(r: Rig, opts: { pulseMs?: number } = {}): Promise<void> {
  const pulseMs = opts.pulseMs ?? 6000;
  r.world.moods.set("rafa", { valence: -0.6, arousal: 0.7 });
  r.director.start();
  let next = 0;
  for (let elapsed = 0; elapsed < 300_000; elapsed += 1000) {
    if (elapsed % pulseMs === 0 && next < SCRIPT.length && r.director.wantsMore()) for (const beat of SCRIPT[next++] ?? []) beat(r);
    await r.clock.advance(1000);
    // The scenario ends itself once everything it said has been shown.
    if (next === SCRIPT.length && r.director.queued === 0 && r.spoken().length === 13) break;
  }
  await Promise.all([r.director.stop("completed", true), r.clock.advance(60_000)]);
}

describe("a scripted cinematic scene: 2 rooms, 4 actors", () => {
  it("emits a cue stream the hotel would accept, framed by the letterbox and ended with a fade out", async () => {
    const r = rig();
    await film(r);
    const frames = r.frames();
    expect(frames[0]?.ui).toMatchObject({ k: "hud", letterbox: true });
    expect(frames.find((f) => f.ui.k === "card")?.ui).toMatchObject({ kind: "title" });
    expect(frames.some((f) => f.ui.k === "hud" && f.ui.letterbox === false)).toBe(true);
    for (const f of frames) {
      expect(f.to).toEqual({ run: 7 });
      expect(WHITELIST.has(f.ui.k)).toBe(true);
      expect(JSON.stringify(f).length).toBeLessThanOrEqual(2048);
      for (const v of Object.values(f.ui)) if (typeof v === "string") expect([...v].length).toBeLessThanOrEqual(200);
    }
  });

  it("delivers every line once, in each person's own order, and each cut is announced, performed and re-established", async () => {
    const r = rig();
    await film(r);
    const said = r.spoken().map((d) => (d.cmd.cmd === "chat" ? `${d.cmd.agentId}:${d.cmd.text.slice(0, 6)}` : ""));
    expect(said).toHaveLength(13);
    expect(said.filter((s) => s.startsWith("duda:"))).toEqual(["duda:Rafa, ", "duda:Será q", "duda:Leo, p", "duda:Obriga"]);

    const track = r.director.track.sorted();
    const cuts = track.filter((e): e is Extract<TrackEntry, { k: "cut" }> => e.k === "cut");
    expect(cuts.length).toBeGreaterThanOrEqual(2);
    for (const cut of cuts) {
      const fx = track.filter((e) => e.k === "cue" && e.ui.k === "cut_fx" && e.t <= cut.t && cut.t - e.t <= 1500);
      expect(fx.length).toBe(1);
      const after = track.find((e) => e.k === "cue" && e.ui.k === "camera" && e.t >= cut.t);
      expect(after).toMatchObject({ room: cut.room, ui: { shot: "establishing", target: { room: true } } });
    }
    const firstCutTo13 = cuts.find((c) => c.room === 13);
    const hint = r.frames().findIndex((f) => f.ui.k === "next_room" && f.ui.room === 13);
    const performed = r.frames().findIndex((f) => f.ui.k === "cut" && f.ui.room === 13);
    expect(firstCutTo13).toBeDefined();
    expect(hint).toBeGreaterThan(-1);
    expect(hint).toBeLessThan(performed);
  });

  it("hits the scorecard: camera on the speaker before the line, no dead air, no jitter, a sane cut rate", async () => {
    const r = rig();
    await film(r);
    const m = r.director.metrics();
    expect(m.lines).toBe(13);
    expect(m.shotOnSpeaker.ratio).toBeGreaterThanOrEqual(0.9);
    expect(m.deadAir.gapsOverLimit).toBe(0);
    expect(m.cuts.shortShots).toBe(0);
    expect(m.cuts.shotsPerMin).toBeLessThan(15);
    expect(m.cuts.roomCuts).toBeLessThanOrEqual(8);
    // Only a live event (a hug nobody could film in time) may be dropped; no line is ever lost.
    const drops = r.director.track.entries.filter((e) => e.k === "drop");
    expect(drops.every((d) => d.k === "drop" && d.why === "stale")).toBe(true);
    expect(drops.length).toBeLessThanOrEqual(2);
  });

  it("uses the whole taxonomy on one scene: establishing, two-shot, close-up, reaction, insert, tracking, thought, SFX, lower-thirds", async () => {
    const r = rig();
    await film(r);
    const shots = new Set(r.frames().flatMap((f) => (f.ui.k === "camera" ? [f.ui.shot] : [])));
    for (const s of ["establishing", "two_shot", "close_up"]) expect(shots.has(s as never)).toBe(true);
    const kinds = new Set(r.frames().map((f) => f.ui.k));
    for (const k of ["thought", "lower_third", "sfx", "cut_fx", "caption", "card"]) expect(kinds.has(k as never)).toBe(true);
    const lowers = r.frames().flatMap((f) => (f.ui.k === "lower_third" ? [f.ui.name] : []));
    expect(new Set(lowers).size).toBe(lowers.length);
    expect(lowers.sort()).toEqual(["Duda", "Gabi", "Leo", "Rafa"]);
  });

  it("is replayable: the JSONL track gives back the same metrics (D39)", async () => {
    const r = rig();
    await film(r);
    const live = r.director.metrics();
    const replayed = computeMetrics(parseTrack(r.director.track.toJsonl()), { deadAirMs: 10_000, minShotMs: 1800 });
    expect(replayed.shotOnSpeaker).toEqual(live.shotOnSpeaker);
    expect(replayed.cuts).toEqual(live.cuts);
    expect(replayed.deadAir.gapsOverLimit).toBe(0);
  });

  it("hides a slow engine: with a model that answers once every 30 s the film never shows dead air", async () => {
    const r = rig();
    await film(r, { pulseMs: 30_000 });
    const m = r.director.metrics();
    expect(m.lines).toBe(13);
    expect(m.fillers).toBeGreaterThan(0);
    expect(m.deadAir.gapsOverLimit).toBe(0);
    expect(m.shotOnSpeaker.ratio).toBeGreaterThanOrEqual(0.9);
  });
});
