import { describe, expect, it } from "vitest";
import { DramaRunHub, composeDramaSinks } from "../director/drama/index.js";
import type { DramaDecision } from "../director/drama/index.js";
import { buildReplayPlan, isRecordedDramaCmd } from "../run/replay-plan.js";
import type { DramaFrameSink } from "../run/drama-frame-sink.js";
import { NOOP_DRAMA_SINK, routeDramaFrame } from "../run/drama-frame-sink.js";
import type { DramaFrame } from "../director/drama-frames.js";
import { actFrames, dramaStateFrame } from "../testing/fake-drama.js";
import { A, B, C, H, ROOM, RUN, SESSION, WIDE_BLOCK, emotion, makeRig } from "../testing/drama-rig.js";

const ask = (rig: ReturnType<typeof makeRig>, actor: number, verb: "glare" | "shove" | "insult" | "slap" | "kill" | "punch", target: number, origin: "model" | "scenario" = "scenario", skip = false): DramaDecision =>
  rig.dir.decide({ actor, proposal: { verb, with: target, origin, ...(skip ? { authoredSkip: true } : {}) }, emotion: emotion({ resentfulColdness: 1, impulsiveProvocation: 1, dominanceAssertion: 1 }) });

describe("scenes (SCENE-1 to SCENE-5, DEATH-7)", () => {
  it("[SCENE-1] a run starts in scene <run>.1 and the director's scene follows the hotel's ids", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    expect(rig.dir.scene).toBe("7.1");
    rig.cut({ scene: "7.2", prev: "7.1" });
    expect(rig.dir.scene).toBe("7.2");
  });

  it("[SCENE-4] the director's own scene_advance changes nothing: only the scene_cut does", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    await rig.clock.advance(20_000);
    expect(rig.dir.advanceScene("scenario_beat_4")).toEqual({ kind: "sent" });
    expect(rig.link.advances).toEqual([{ run: RUN, reason: "scenario_beat_4" }]);
    expect(rig.dir.scene).toBe("7.1");
    rig.cut({ scene: "7.2", prev: "7.1" });
    expect(rig.dir.scene).toBe("7.2");
  });

  it("[SCENE-5] never sends a scene_advance before the scene is 20 s old, and waits for the cut it asked for", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    await rig.clock.advance(19_900);
    expect(rig.dir.advanceScene("x")).toEqual({ kind: "refused", why: "too_young", retryInMs: 100 });
    expect(rig.link.advances).toHaveLength(0);
    await rig.clock.advance(100);
    expect(rig.dir.advanceScene("x")).toEqual({ kind: "sent" });
    expect(rig.dir.advanceScene("x")).toMatchObject({ kind: "refused", why: "pending" });
    // The hotel cut: the 20 s floor starts over from that frame.
    rig.cut({ scene: "7.2", prev: "7.1" });
    await rig.clock.advance(19_900);
    expect(rig.dir.advanceScene("y")).toMatchObject({ kind: "refused", why: "too_young" });
    await rig.clock.advance(100);
    expect(rig.dir.advanceScene("y")).toEqual({ kind: "sent" });
    expect(rig.link.advances).toHaveLength(2);
  });

  it("[SCENE-5] a scene_advance the hotel dropped without an answer may be asked again after the pending window", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    await rig.clock.advance(20_000);
    rig.dir.advanceScene("x");
    await rig.clock.advance(3_000);
    expect(rig.dir.advanceScene("x")).toEqual({ kind: "sent" });
  });

  it("[SCENE-3] a cut resets the rung, the spacing and the kill count, and keeps the same-verb cooldown, the chip cooldown and the harm window", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.act({ actId: "p1", verb: "punch", actor: A, with: B, outcome: "landed" });
    rig.act({ actId: "p2", verb: "kill", actor: A, with: B, outcome: "landed" });
    rig.act({ actId: "p3", verb: "hug", actor: C, with: H, outcome: "dodged", chip: true, answer: "dodge" });
    rig.act({ actId: "p4", verb: "glare", actor: B, with: A, outcome: "landed" });
    rig.cut({ scene: "7.2", prev: "7.1" });
    expect(rig.dir.snapshot()).toMatchObject({ highestRung: 0, kills: 0, lastPhysicalAt: undefined });
    expect(ask(rig, B, "glare", A, "model")).toMatchObject({ kind: "veto", reason: "cooldown", detail: "verb" });
    rig.world.put(B, { tile: [4, 6] });
    expect(ask(rig, B, "insult", H, "model")).toMatchObject({ kind: "veto", reason: "cooldown", detail: "chip_cooldown" });
    expect(ask(rig, A, "kill", B, "scenario", true)).toMatchObject({ kind: "veto", detail: "verb" });
    expect(ask(rig, C, "kill", B, "scenario", true)).toMatchObject({ kind: "approve" });
  });

  it("[DEATH-7] an actor revived by the cut acts again; one removed by permadeath stays out", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.hotel([{ t: "actor_death", run: RUN, room: ROOM, actor: B, cause: "kill", act_id: "x", killer: A, scene: "7.1", at: 1 }, { t: "actor_death", run: RUN, room: ROOM, actor: C, cause: "die", act_id: "y", scene: "7.1", at: 1 }]);
    expect(rig.dir.snapshot().fallen).toEqual([C, B]);
    rig.cut({ scene: "7.2", prev: "7.1", revived: [B], removed: [C] });
    expect(rig.dir.snapshot().fallen).toEqual([C]);
    expect(rig.dir.decide({ actor: B, proposal: { verb: "cry", origin: "model" } })).toMatchObject({ kind: "approve" });
  });

  it("[DOWN-1] a human down is not a target until human_up, and a down human survives a new hello", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.hotel([{ t: "human_down", run: RUN, room: ROOM, human: H, act_id: "x", ms: 5000, scene: "7.1", at: 1 }]);
    expect(ask(rig, A, "glare", H, "model")).toMatchObject({ kind: "veto", reason: "dead_target" });
    rig.dir.onSession({ ...SESSION, dead: [] });
    expect(rig.dir.snapshot().fallen).toEqual([H]);
    rig.hotel([{ t: "human_up", run: RUN, room: ROOM, human: H, act_id: "x", reason: "timer", at: 2 }]);
    expect(rig.dir.snapshot().fallen).toEqual([]);
  });
});

describe("resume (NEG-8, NEG-9)", () => {
  it("[NEG-9] a director rebuilt from nothing stays inert until the first drama_state, then holds its scene, calm, switch and opt-in", () => {
    const rig = makeRig({ block: WIDE_BLOCK, resumed: true });
    expect(rig.dir.active).toBe(false);
    expect(ask(rig, A, "glare", B, "model")).toEqual({ kind: "pass", why: "inert" });
    rig.hotel([dramaStateFrame({ run: RUN, room: ROOM, scene: "7.3", calm: true, paused: false, optIn: [H] })]);
    expect(rig.dir.active).toBe(true);
    expect(rig.dir.scene).toBe("7.3");
    expect(ask(rig, A, "hug", B, "model")).toMatchObject({ kind: "veto", reason: "calm_room" });
    expect(ask(rig, A, "glare", B, "model")).toMatchObject({ kind: "approve" });
  });

  it("[NEG-9] what a resume cannot read back is assumed at its worst until the next cut: a physical beat just started, the kill used", async () => {
    const rig = makeRig({ block: WIDE_BLOCK, resumed: true });
    rig.hotel([dramaStateFrame({ run: RUN, room: ROOM, scene: "7.3", optIn: [H] })]);
    const first = ask(rig, A, "insult", B, "model");
    expect(first).toMatchObject({ kind: "approve" });
    rig.act({ actId: (first as { actId: string }).actId, verb: "insult", actor: A, with: B, outcome: "landed" });
    expect(ask(rig, A, "shove", B, "model")).toMatchObject({ kind: "veto", reason: "budget", detail: "physical" });
    await rig.clock.advance(20_000);
    expect(ask(rig, A, "shove", B, "model")).toMatchObject({ kind: "approve" });
    expect(ask(rig, C, "kill", B, "scenario", true)).toMatchObject({ kind: "veto", reason: "budget", detail: "kill" });
    rig.cut({ scene: "7.4", prev: "7.3" });
    expect(ask(rig, C, "kill", B, "scenario", true)).toMatchObject({ kind: "approve" });
  });

  it("[NEG-9] the scene a resumed director adopts starts its 20 s floor at the resume", async () => {
    const rig = makeRig({ block: WIDE_BLOCK, resumed: true });
    rig.hotel([dramaStateFrame({ run: RUN, room: ROOM, scene: "7.3" })]);
    await rig.clock.advance(19_000);
    expect(rig.dir.advanceScene("x")).toMatchObject({ kind: "refused", why: "too_young" });
  });

  it("[NEG-9] a cut missed while the link was down is adopted from drama_state, with nothing carried over", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.act({ actId: "p1", verb: "punch", actor: A, with: B, outcome: "landed" });
    rig.hotel([dramaStateFrame({ run: RUN, room: ROOM, scene: "7.2", optIn: [H] })]);
    expect(rig.dir.scene).toBe("7.2");
    expect(rig.dir.snapshot()).toMatchObject({ highestRung: 0, lastPhysicalAt: undefined });
  });

  it("[NEG-9] one drama_state per room: each room keeps its own calm and opt-in", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.world.put(C, { room: 14, tile: [1, 1] });
    rig.hotel([dramaStateFrame({ run: RUN, room: 14, scene: "7.1", calm: true, optIn: [] })]);
    expect(rig.dir.decide({ actor: C, proposal: { verb: "glare", with: A, origin: "scenario" } })).toMatchObject({ kind: "pass", why: "target_gone" });
    rig.world.put(B, { room: 14, tile: [1, 2] });
    expect(rig.dir.decide({ actor: C, proposal: { verb: "hug", with: B, origin: "model" } })).toMatchObject({ kind: "veto", reason: "calm_room" });
    expect(rig.dir.decide({ actor: A, proposal: { verb: "hug", with: H, origin: "model" } })).toMatchObject({ kind: "approve" });
  });

  it("[NEG-8] hello.drama.dead replaces the dead set: an id missing from it is alive again", () => {
    const rig = makeRig({ block: WIDE_BLOCK, session: { ...SESSION, dead: [B, C] } });
    expect(rig.dir.snapshot().fallen).toEqual([C, B]);
    rig.dir.onSession({ ...SESSION, dead: [C] });
    expect(rig.dir.snapshot().fallen).toEqual([C]);
    rig.dir.onSession(null);
    expect(rig.dir.active).toBe(false);
  });
});

describe("routing (FRM-4) and the replay filter (REPLAY-1)", () => {
  const frame = (f: Record<string, unknown>, seq = 1): DramaFrame => ({ ...f, seq }) as unknown as DramaFrame;

  it("[FRM-4] the hub hands each frame to the director of the run it names, and the session to all, also to one that attaches later", () => {
    const hub = new DramaRunHub();
    const calls: string[] = [];
    const sink = (name: string): DramaFrameSink => ({ ...NOOP_DRAMA_SINK, onSession: (s) => void calls.push(`${name}:session:${s?.harmMax}`), onActStarted: (f) => void calls.push(`${name}:started:${f.run}`) });
    hub.onSession(SESSION);
    hub.attach(7, sink("a"));
    hub.attach(8, sink("b"));
    for (const f of actFrames({ actId: "x", verb: "glare", with: -702, run: 8, outcome: "landed" })) routeDramaFrame(frame(f), hub);
    expect(calls).toEqual(["a:session:3", "b:session:3", "b:started:8"]);
    hub.detach(8);
    for (const f of actFrames({ actId: "y", verb: "glare", with: -702, run: 8, outcome: "landed" })) routeDramaFrame(frame(f), hub);
    expect(calls).toHaveLength(3);
  });

  it("[FRM-4] a director ignores the frames of another run, and composed sinks all see every frame", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.hotel(actFrames({ actId: "z", verb: "punch", actor: A, with: B, run: 99, outcome: "landed" }));
    expect(rig.dir.snapshot().highestRung).toBe(0);
    const seen: string[] = [];
    const both = composeDramaSinks({ ...NOOP_DRAMA_SINK, onActDone: () => void seen.push("one") }, { ...NOOP_DRAMA_SINK, onActDone: () => void seen.push("two") });
    for (const f of actFrames({ actId: "q", verb: "glare", with: B, outcome: "landed" })) routeDramaFrame(frame(f), both);
    expect(seen).toEqual(["one", "two"]);
  });

  it("[REPLAY-1] a replay plan built from a run with acts and scene advances contains none of them, and keeps a pair, a chat and a ui cut", () => {
    const at = (atMs: number, ref: string, cmd: unknown) => ({ atMs, dir: "out", room: "12", kind: "actor_cmd", data: { actor: ref, cmd } });
    const frames = [
      at(1000, "a", { k: "walk", x: 3, y: 3 }),
      at(2000, "a", { k: "act", act_id: "d1", verb: "slap", with: 9, origin: "model" }),
      at(2500, "b", { k: "pair", kind: "hug", with: -101, pair: "p1" }),
      at(3000, "b", { k: "chat", mode: "say", text: "oi" }),
      { atMs: 4000, dir: "out", room: "12", kind: "scene_advance", data: { reason: "scenario_beat_4" } },
      at(5000, "a", { k: "act", act_id: "d2", verb: "kill", with: -102, origin: "scenario" }),
    ] as never;
    const manifest = { run: 1, scenarioVersion: 1, startedAt: 500, home: 12, actors: { a: -101, b: -102 } } as never;
    const plan = buildReplayPlan({ manifest, frames, track: [{ t: 0, k: "start", run: 1, room: 12, lang: "en" }, { t: 100, k: "cut", room: 13, from: 12 }] as never, events: [] }, { cinematic: true });
    const kinds = plan.steps.map((s) => (s.k === "cmd" ? s.cmd.k : `ui:${s.ui.k}`));
    expect(kinds).toContain("pair");
    expect(kinds).toContain("chat");
    expect(kinds).toContain("ui:cut");
    expect(kinds).not.toContain("act");
    expect(plan.warnings).toContain("3 recorded act and scene_advance commands were not replayed");
    expect(isRecordedDramaCmd({ atMs: 0, dir: "out", kind: "actor_cmd", data: { cmd: { k: "act" } } })).toBe(true);
    expect(isRecordedDramaCmd({ atMs: 0, dir: "out", kind: "actor_cmd", data: { cmd: { k: "pair" } } })).toBe(false);
  });
});
