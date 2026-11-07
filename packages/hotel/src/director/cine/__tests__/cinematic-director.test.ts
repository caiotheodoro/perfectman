import { describe, expect, it } from "vitest";
import { computeMetrics } from "../metrics.js";
import { rig } from "./cine-helpers.js";

describe("playback: speech is held for the clock, behind the camera", () => {
  it("opens the film, then releases a buffered line only after its camera cue, with the typing bubble just before", async () => {
    const r = rig();
    r.director.start();
    r.say("duda", "Oi gente, que bom ver vocês aqui hoje.");
    await r.clock.advance(100);
    expect(r.frames().map((f) => f.ui.k).slice(0, 3)).toEqual(["hud", "camera", "hud"]);
    expect(r.spoken()).toHaveLength(0);
    await r.clock.advance(8000);
    expect(r.spoken()).toHaveLength(1);
    const track = r.director.track.sorted();
    const cam = track.find((e) => e.k === "cue" && e.ui.k === "camera" && e.ui.shot === "close_up");
    const said = track.find((e) => e.k === "line");
    expect(cam && said && cam.t + 450 <= said.t).toBe(true);
    const typing = r.delivered.findIndex((d) => d.cmd.cmd === "typing" && d.cmd.on);
    expect(typing).toBeGreaterThan(-1);
    expect(typing).toBeLessThan(r.delivered.findIndex((d) => d.cmd.cmd === "chat"));
  });

  it("holds each line for its reading time, in the order the engine produced them", async () => {
    const r = rig();
    r.director.start();
    r.say("duda", "Primeira fala da cena, bem curta.", "say", "rafa");
    r.say("rafa", "Segunda fala, respondendo logo em seguida.", "say", "duda");
    r.say("duda", "Terceira.", "say", "rafa");
    await r.clock.advance(40_000);
    const times = r.spoken().map((d) => d.at);
    expect(r.spoken().map((d) => (d.cmd.cmd === "chat" ? d.cmd.text.split(" ")[0] : ""))).toEqual(["Primeira", "Segunda", "Terceira."]);
    for (let i = 1; i < times.length; i++) expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(2500);
  });

  it("lets quick movement and expressions through at once and holds back the show: typing on, speech, thoughts, laughs", async () => {
    const r = rig();
    r.director.start();
    r.exec.send([{ agentId: "duda", cmd: "walk", to: [5, 4], plan: "p1" }, { agentId: "duda", cmd: "typing", on: true }, { agentId: "rafa", cmd: "expression", face: "smile" }, { agentId: "rafa", cmd: "gesture", a: "laugh" }, { agentId: "rafa", cmd: "gesture", a: "stand", fidget: true }]);
    r.exec.sendThought("duda", "será que ele percebeu?");
    expect(r.delivered.map((d) => d.cmd.cmd)).toEqual(["walk", "expression", "gesture"]);
    expect(r.thoughts).toEqual([]);
  });

  it("holds a long walk, a door and a kiss until the camera is on them, so a deep buffer does not drop the shot", async () => {
    const r = rig();
    r.director.start();
    await r.clock.advance(7000); // past the opening cards
    r.exec.send([{ agentId: "duda", cmd: "walk", to: [9, 4], plan: "p1" }, { agentId: "rafa", cmd: "pair", kind: "kiss", with: "duda" } as never]);
    await r.clock.advance(30_000);
    const sent = r.delivered.map((d) => d.cmd.cmd);
    expect(sent).toContain("walk");
    expect(sent).toContain("pair");
    // the acts were filmed, not dropped, and each went out with its shot
    const cams = r.director.track.sorted().filter((e) => e.k === "cue" && e.ui.k === "camera");
    expect(cams.some((e) => e.k === "cue" && e.ui.k === "camera" && e.ui.shot === "tracking")).toBe(true);
    expect(cams.some((e) => e.k === "cue" && e.ui.k === "camera" && e.ui.shot === "insert")).toBe(true);
    expect(r.director.track.entries.some((e) => e.k === "drop" && e.why === "stale")).toBe(false);
  });

  it("an act that waited out its age limit still happens, off camera, and a stop discards the rest", async () => {
    const r = rig();
    r.director.start();
    r.say("rafa", "Uma fala longa o bastante para ocupar a tela por um bom tempo, enquanto a caminhada fica velha demais.");
    r.say("rafa", "Outra fala longa o bastante para ocupar a tela por mais um bom tempo, sem pressa nenhuma de acabar.");
    r.exec.send([{ agentId: "duda", cmd: "walk", to: [9, 4], plan: "p1" }]);
    await r.clock.advance(60_000);
    expect(r.director.track.entries.some((e) => e.k === "drop" && e.why === "stale")).toBe(true);
    expect(r.delivered.map((d) => d.cmd.cmd)).toContain("walk");
  });

  it("films a thought as a bubble on the thinker instead of forwarding it", async () => {
    const r = rig();
    r.director.start();
    await r.clock.advance(4000);
    r.exec.sendThought("rafa", "ela está mentindo");
    await r.clock.advance(4000);
    const bubble = r.frames().find((f) => f.ui.k === "thought");
    expect(bubble?.ui).toMatchObject({ k: "thought", id: -702, text: "ela está mentindo" });
    expect(r.thoughts).toEqual([]);
  });

  it("sends early cues with in_ms to absorb socket latency, and never gives cut or next_room a delay", async () => {
    const r = rig();
    r.director.start();
    r.say("duda", "Oi.");
    r.say("gabi", "Cheguei!");
    await r.clock.advance(30_000);
    const timed = r.frames().filter((f) => f.ui.k === "camera" || f.ui.k === "card");
    expect(timed.some((f) => "in_ms" in f.ui && (f.ui.in_ms ?? 0) > 0)).toBe(true);
    for (const f of r.frames().filter((x) => x.ui.k === "cut" || x.ui.k === "next_room")) expect("in_ms" in f.ui).toBe(false);
  });
});

describe("the lookahead budget (D18)", () => {
  it("asks the run to stop pulsing once two pulses of film are waiting, and to resume as playback catches up", async () => {
    const r = rig();
    r.director.start();
    expect(r.director.wantsMore()).toBe(true);
    for (let i = 0; i < 6; i++) r.say(i % 2 ? "rafa" : "duda", "Uma fala de tamanho médio para encher o buffer do diretor agora.");
    expect(r.director.bufferedMs()).toBeGreaterThanOrEqual(12_000);
    expect(r.director.wantsMore()).toBe(false);
    await r.clock.advance(60_000);
    expect(r.director.queued).toBe(0);
    expect(r.director.wantsMore()).toBe(true);
  });
});

describe("dead air", () => {
  it("fills a stalled engine with establishing shots and narrator asides, so no gap passes ten seconds", async () => {
    const r = rig();
    r.director.start();
    r.say("duda", "Oi.");
    await r.clock.advance(70_000);
    const m = r.director.metrics();
    expect(m.fillers).toBeGreaterThan(3);
    expect(m.deadAir.gapsOverLimit).toBe(0);
    expect(m.deadAir.maxGapMs).toBeLessThanOrEqual(7000);
  });

  it("stops filling after a long stall instead of narrating an empty room forever, and the metric then says so", async () => {
    const r = rig();
    r.director.start();
    await r.clock.advance(200_000);
    expect(r.director.metrics().fillers).toBe(8);
    expect(r.director.metrics().deadAir.gapsOverLimit).toBe(1);
  });

  it("plays a late line as soon as it arrives, with no wait for the filler to finish its idle timer", async () => {
    const r = rig();
    r.director.start();
    await r.clock.advance(30_000);
    r.say("rafa", "Desculpem a demora.");
    await r.clock.advance(5000);
    expect(r.spoken()).toHaveLength(1);
  });
});

describe("pause, drain and stop", () => {
  it("plays nothing new while paused, and the pause is not dead air", async () => {
    const r = rig();
    r.director.start();
    await r.clock.advance(5000);
    r.director.pause();
    r.say("duda", "Dita durante a pausa.");
    await r.clock.advance(120_000);
    expect(r.spoken()).toHaveLength(0);
    expect(r.director.metrics().fillers).toBeLessThanOrEqual(1);
    r.director.resume();
    await r.clock.advance(8000);
    expect(r.spoken()).toHaveLength(1);
    expect(r.director.metrics().deadAir.gapsOverLimit).toBe(0);
  });

  it("drains the buffer on a scenario ending, then fades out and takes the letterbox off", async () => {
    const r = rig();
    r.director.start();
    r.say("duda", "Fala um.", "say", "rafa");
    r.say("rafa", "Fala dois.", "say", "duda");
    await r.clock.advance(500);
    const stopped = r.director.stop("completed", true);
    await r.clock.advance(40_000);
    await stopped;
    expect(r.spoken()).toHaveLength(2);
    const last = r.frames().at(-1);
    expect(last?.ui).toMatchObject({ k: "hud", fade: { to: 0 } });
    expect(r.frames().some((f) => f.ui.k === "hud" && f.ui.letterbox === false)).toBe(true);
    expect(r.director.track.sorted().at(-1)).toMatchObject({ k: "end", reason: "completed" });
  });

  it("drops what is still buffered on an admin stop and passes everything straight through afterwards", async () => {
    const r = rig();
    r.director.start();
    r.say("duda", "Nunca vai ao ar.");
    const stopped = r.director.stop("stopped", false);
    await r.clock.advance(3000);
    await stopped;
    expect(r.spoken()).toHaveLength(0);
    expect(r.director.track.entries.some((e) => e.k === "drop" && e.why === "stopped")).toBe(true);
    r.say("duda", "Depois do fim.");
    expect(r.spoken()).toHaveLength(1);
  });

  it("shows no stale walk when the film is behind, but still plays the speech that arrived with it", async () => {
    const r = rig();
    r.director.start();
    r.say("rafa", "Uma fala longa o bastante para ocupar a tela por um bom tempo, enquanto a caminhada fica velha demais.");
    r.say("rafa", "Outra fala longa o bastante para ocupar a tela por mais um bom tempo, sem pressa nenhuma de acabar.");
    r.exec.send([{ agentId: "duda", cmd: "walk", to: [9, 4], plan: "p1" }]);
    await r.clock.advance(60_000);
    expect(r.spoken()).toHaveLength(2);
    expect(r.director.track.entries.some((e) => e.k === "drop" && e.why === "stale")).toBe(true);
    expect(computeMetrics(r.director.track.entries).cuts.shortShots).toBe(0);
  });
});
