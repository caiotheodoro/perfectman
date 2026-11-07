import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cueViolations } from "../director/cine/cue-vocab.js";
import type { ActorCmd, PerfectmanUi, SidecarFrame } from "../director/index.js";
import type { CineConfig } from "../director/cine/types.js";
import { ReplayError, buildReplayPlan, loadReplayArtifacts } from "../run/replay-plan.js";
import { parseReplayArgs } from "../run/replay-run.js";
import type { Sidecar } from "../sidecar.js";
import type { FakeDirector } from "../testing/fake-director.js";
import { bootSidecar, waitFor } from "../testing/helpers.js";

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;
afterEach(async () => {
  await sidecar?.close();
  await fake?.stop();
  sidecar = fake = undefined;
});

const FAST_CINE: Partial<CineConfig> = {
  readingScale: 0.02, introMs: 300, sceneCardMs: 200, fillerAfterMs: 250, fillerMs: 150, minShotMs: 40,
  easeMs: { establishing: 20, two_shot: 20, close_up: 10, tracking: 20, reaction: 10 },
  beatGapMs: 20, cueLeadMs: 10, typingLeadMs: 20, narratorWaitMs: 50, drainMs: 500, pulseMs: 150,
};

type Cmd = Extract<SidecarFrame, { t: "actor_cmd" }>;
const cmdsOfRun = (hotel: FakeDirector, run: number): Cmd[] => hotel.received.filter((f): f is Cmd & SidecarFrame => f.t === "actor_cmd" && f.run === run);
const spoken = (hotel: FakeDirector, run: number): string[] => cmdsOfRun(hotel, run).flatMap((c) => (c.cmd.k === "chat" && c.cmd.mode !== "thought" ? [c.cmd.text] : []));
const uiOfRun = (hotel: FakeDirector, run: number): PerfectmanUi[] => hotel.received.flatMap((f) => (f.t === "ui_push" && f.run === run ? [f.ui] : []));

/** Records a short run with the mock model, stops it, and returns once its artifacts are on the volume. */
async function record(opts: { run: number; mode?: "default" | "cinematic"; lines?: number }) {
  const booted = await bootSidecar({ timing: { cine: FAST_CINE, replayTailMs: 100 } });
  fake = booted.fake;
  sidecar = booted.sidecar;
  fake.addRoom(14);
  fake.startRun({ run: opts.run, room: 12, scenarioVersion: 31, mode: opts.mode ?? "default" });
  await waitFor(() => fake?.received.find((f) => f.t === "run_ack" && f.ok), "run_ack");
  await waitFor(() => spoken(booted.fake, opts.run).length >= (opts.lines ?? 3), "the recorded lines", 10_000);
  booted.fake.pmCommand(opts.run, 12, "stop");
  await waitFor(() => booted.fake.received.find((f) => f.t === "run_end" && f.run === opts.run), "run_end", 8000);
  return booted;
}

describe("replay arguments", () => {
  it("reads '<run> [default|cinematic] [Nx]' and refuses anything else", () => {
    expect(parseReplayArgs("7 cinematic", "default")).toEqual({ source: 7, mode: "cinematic", speed: 1 });
    expect(parseReplayArgs(" 7 ", "cinematic")).toEqual({ source: 7, mode: "cinematic", speed: 1 });
    expect(parseReplayArgs("7 default 2x", "cinematic")).toEqual({ source: 7, mode: "default", speed: 2 });
    expect(parseReplayArgs("7 default 99x", "default").speed).toBe(8);
    for (const bad of ["", "abc", "0", "7 loud", "-3"]) expect(() => parseReplayArgs(bad, "default")).toThrow(ReplayError);
  });
});

describe("replay plan from artifacts", () => {
  it("says run_not_found for a run that left nothing, and corrupt for a manifest that is not one", async () => {
    const booted = await bootSidecar();
    fake = booted.fake;
    sidecar = booted.sidecar;
    await expect(loadReplayArtifacts(booted.cfg.dataDir, 99)).rejects.toMatchObject({ code: "replay_not_found" });
    mkdirSync(join(booted.cfg.dataDir, "runs", "98"), { recursive: true });
    writeFileSync(join(booted.cfg.dataDir, "runs", "98", "replay.json"), "{nope");
    await expect(loadReplayArtifacts(booted.cfg.dataDir, 98)).rejects.toMatchObject({ code: "replay_corrupt" });
    expect(() => buildReplayPlan({ manifest: { scenarioVersion: 1, startedAt: 0 } as never, frames: [], track: [], events: [] }, { cinematic: false })).toThrow(/nothing to replay/);
  });

  it("keeps the recorded timing exactly, lines the film clock up with the frame log, and lets cues lead by in_ms", () => {
    const frame = (atMs: number, ref: string, cmd: unknown, room = 12) => ({ atMs, dir: "out", room: String(room), kind: "actor_cmd", data: { actor: ref, cmd } });
    const manifest = { run: 1, scenarioVersion: 1, startedAt: 40_000, home: 12, mode: "cinematic", actors: { a: -101, b: -102 } } as never;
    const frames = [
      frame(50_000, "a", { k: "walk", x: 3, y: 3 }),
      frame(51_000, "a", { k: "chat", mode: "say", text: "um" }),
      frame(53_500, "b", { k: "chat", mode: "say", text: "dois" }),
    ] as never;
    // the film's clock started at 50_500: its first line (t=500) is the frame at 51_000
    const track = [
      { t: 0, k: "start", run: 1, room: 12, lang: "en" },
      { t: 400, k: "cue", room: 12, ui: { k: "camera", shot: "close_up", target: { avatar: -101 }, zoom: 2, ease_ms: 10, hold_ms: 100, in_ms: 40 } },
      { t: 500, k: "line", room: 12, beat: "b1", ref: "a", avatar: -101, mode: "say", text: "um", ms: 900 },
      { t: 3000, k: "line", room: 12, beat: "b2", ref: "b", avatar: -102, mode: "say", text: "dois", ms: 900 },
      { t: 3100, k: "cut", room: 13, from: 12 },
    ] as never;
    const plan = buildReplayPlan({ manifest, frames, track, events: [] }, { cinematic: true });
    const at = (pred: (s: (typeof plan.steps)[number]) => boolean): number | undefined => plan.steps.find(pred)?.at;
    expect(at((s) => s.k === "cmd" && s.cmd.k === "walk")).toBe(0);
    expect(at((s) => s.k === "cmd" && s.cmd.k === "chat" && s.cmd.text === "um")).toBe(1000);
    expect(at((s) => s.k === "cmd" && s.cmd.k === "chat" && s.cmd.text === "dois")).toBe(3500);
    // film start = frame time 51_000 - track t 500 = 50_500: the cue is seen at 50_900 and was sent 40 ms before that
    expect(at((s) => s.k === "ui" && s.ui.k === "camera")).toBe(860);
    expect(at((s) => s.k === "ui" && s.ui.k === "cut")).toBe(3600);
    expect(plan.cast).toEqual([{ ref: "a", firstAt: 0 }, { ref: "b", firstAt: 3500 }]);
    expect(plan.avatarRefs).toEqual({ [-101]: "a", [-102]: "b" });
    expect(plan.home).toBe(12);
    // default mode: no cues at all
    expect(buildReplayPlan({ manifest, frames, track, events: [] }, { cinematic: false }).steps.every((s) => s.k === "cmd")).toBe(true);
  });

  it("falls back to the track's lines, then to the events' lines, when the frame log is gone", () => {
    const manifest = { run: 1, scenarioVersion: 1, startedAt: 1000, actors: { a: -101 } } as never;
    const track = [{ t: 0, k: "start", run: 1, room: 12, lang: "en" }, { t: 500, k: "line", room: 12, beat: "b1", ref: "a", avatar: -101, mode: "say", text: "hello there", ms: 900 }] as never;
    const fromTrack = buildReplayPlan({ manifest, frames: [], track, events: [] }, { cinematic: false });
    expect(fromTrack.linesFrom).toBe("track");
    expect(fromTrack.steps).toMatchObject([{ k: "cmd", ref: "a", cmd: { k: "chat", text: "hello there" } }]);
    const events = [{ id: "e1", type: "message_sent", actorId: "a", createdAt: 5000, pulseIndex: 1, payload: { content: "first" } }, { id: "e2", type: "reply_sent", actorId: "a", createdAt: 7000, pulseIndex: 2, payload: { content: "second" } }, { id: "e3", type: "message_sent", actorId: "h:9", createdAt: 7500, pulseIndex: 2, payload: { content: "human" } }] as never;
    const fromEvents = buildReplayPlan({ manifest, frames: [], track: [], events }, { cinematic: false });
    expect(fromEvents.linesFrom).toBe("events");
    expect(fromEvents.steps.map((s) => (s.k === "cmd" && s.cmd.k === "chat" ? [s.at, s.cmd.text] : null))).toEqual([[0, "first"], [2000, "second"]]);
  });
});

describe("replaying a default run into another room, with no model", () => {
  it("spawns fresh actors in the target room and re-sends the recorded lines and moves in order, on the original timing", async () => {
    const booted = await record({ run: 7, lines: 3 });
    const live = cmdsOfRun(booted.fake, 7);
    const liveChats = booted.fake.chats.filter((c) => c.actor < -700 && c.actor > -800);
    expect(liveChats.length).toBeGreaterThanOrEqual(3);

    booted.fake.grantLease(20, 5);
    booted.fake.pmCommand(20, 14, "replay", "7 default", "chat");
    await waitFor(() => booted.fake.received.find((f) => f.t === "run_end" && f.run === 20), "the replay's run_end", 20_000);

    // fresh actors, under the replay's run, in the target room
    const spawns = booted.fake.received.filter((f) => f.t === "actor_spawn" && f.run === 20);
    expect(spawns.length).toBeGreaterThanOrEqual(2);
    expect(spawns.every((f) => f.t === "actor_spawn" && f.room === 14 && f.lease === 5)).toBe(true);
    expect(new Set(spawns.map((f) => (f.t === "actor_spawn" ? f.ref : ""))).size).toBe(spawns.length);
    // the same lines, in the same order, nobody else's
    expect(spoken(booted.fake, 20)).toEqual(spoken(booted.fake, 7));
    // the moves went too (retargeted into room 14's coordinates, all inside it)
    const replayWalks = cmdsOfRun(booted.fake, 20).filter((c) => c.cmd.k === "walk");
    expect(replayWalks.length).toBeGreaterThan(0);
    expect(replayWalks.length).toBeLessThanOrEqual(live.filter((c) => c.cmd.k === "walk").length);
    for (const w of replayWalks) expect((w.cmd as Extract<ActorCmd, { k: "walk" }>).x).toBeLessThan(10);
    // timing: the lines are as far apart as they were (generous: the replay starts each actor just before its first act)
    const replayChats = booted.fake.chats.filter((c) => c.actor <= -2000 && c.actor > -2100);
    const gaps = (xs: Array<{ at: number }>): number[] => xs.slice(1).map((x, i) => x.at - (xs[i]?.at ?? 0));
    const a = gaps(liveChats);
    const b = gaps(replayChats);
    expect(b).toHaveLength(a.length);
    a.forEach((gap, i) => expect(Math.abs((b[i] ?? 0) - gap)).toBeLessThan(400));
    // no model: the replay's own status says so, and it ended itself after walking everyone out
    const status = booted.fake.received.filter((f) => f.t === "run_status" && f.run === 20);
    expect(status.every((f) => f.t === "run_status" && f.llm_calls === 0 && f.tokens_in === 0 && f.cost_usd === 0)).toBe(true);
    expect(booted.fake.received.find((f) => f.t === "run_end" && f.run === 20)).toMatchObject({ reason: "completed" });
    await waitFor(() => booted.fake.rooms.get(14)?.avatars.size === 0, "the actors walked out", 5000);
    expect(booted.sidecar.manager?.runCount).toBe(0);
    // default mode shows the audience no film
    expect(uiOfRun(booted.fake, 20).filter((u) => u.k !== "notice")).toEqual([]);
  }, 60_000);

  it("a replay is started the same way when the hotel also sent run_start (the run is claimed, never built live)", async () => {
    const booted = await record({ run: 7, lines: 3 });
    const before = booted.fake.received.filter((f) => f.t === "actor_spawn").length;
    booted.fake.startRun({ run: 21, room: 14, scenarioVersion: 31, lease: 3, mode: "default" });
    booted.fake.pmCommand(21, 14, "replay", "7 default", "chat");
    await waitFor(() => booted.fake.received.find((f) => f.t === "run_ack" && f.run === 21), "the replay's run_ack");
    expect(booted.fake.received.find((f) => f.t === "run_ack" && f.run === 21)).toMatchObject({ ok: true });
    await waitFor(() => booted.fake.received.find((f) => f.t === "run_end" && f.run === 21), "the replay's run_end", 20_000);
    expect(spoken(booted.fake, 21)).toEqual(spoken(booted.fake, 7));
    expect(booted.fake.received.filter((f) => f.t === "actor_spawn").length).toBeGreaterThan(before);
    // a live run for 21 was never built: no model call in its status, and its lines came from the recording
    const status = booted.fake.received.filter((f) => f.t === "run_status" && f.run === 21);
    expect(status.every((f) => f.t === "run_status" && f.llm_calls === 0)).toBe(true);
  }, 60_000);

  it("refuses with a notice and a failed run_end when there is nothing to replay or the arguments are wrong", async () => {
    const booted = await bootSidecar();
    fake = booted.fake;
    sidecar = booted.sidecar;
    fake.addRoom(14);
    fake.grantLease(30, 1);
    fake.pmCommand(30, 14, "replay", "404 default", "chat");
    await waitFor(() => fake?.received.find((f) => f.t === "run_end" && f.run === 30), "run_end for 30");
    expect(fake.received.find((f) => f.t === "run_end" && f.run === 30)).toMatchObject({ reason: "failed" });
    expect(uiOfRun(fake, 30).find((u) => u.k === "notice")).toMatchObject({ code: "replay_not_found", kind: "warn" });
    fake.pmCommand(31, 14, "replay", "seven", "chat");
    await waitFor(() => uiOfRun(fake!, 31).some((u) => u.k === "notice" && u.code === "replay_bad_args"), "the bad-args notice");
    expect(booted.sidecar.manager?.runCount).toBe(0);
  });

  it("pauses and stops like a live run, walking the actors out", async () => {
    const booted = await record({ run: 7, lines: 4 });
    booted.fake.grantLease(22, 1);
    booted.fake.pmCommand(22, 14, "replay", "7 default", "chat");
    await waitFor(() => spoken(booted.fake, 22).length >= 1, "the first replayed line", 15_000);
    booted.fake.pmCommand(22, 14, "pause");
    await waitFor(() => booted.sidecar.manager?.getReplay(22)?.state === "paused", "paused");
    const n = spoken(booted.fake, 22).length;
    await new Promise((r) => setTimeout(r, 700));
    expect(spoken(booted.fake, 22).length).toBe(n);
    booted.fake.pmCommand(22, 14, "resume");
    await waitFor(() => booted.sidecar.manager?.getReplay(22)?.state === "running", "running again");
    booted.fake.pmCommand(22, 14, "stop");
    await waitFor(() => booted.fake.received.find((f) => f.t === "run_end" && f.run === 22), "stopped", 8000);
    expect(booted.fake.received.find((f) => f.t === "run_end" && f.run === 22)).toMatchObject({ reason: "stopped" });
    await waitFor(() => booted.fake.rooms.get(14)?.avatars.size === 0, "everyone walked out", 5000);
  }, 60_000);
});

describe("replaying a cinematic run drives the audience exactly like live", () => {
  it("re-emits the director track's cues and cuts for the replay's avatars, canonical, on the replay's lease, before each line", async () => {
    const booted = await record({ run: 7, mode: "cinematic", lines: 3 });
    const liveUi = uiOfRun(booted.fake, 7).filter((u) => u.k !== "notice" && u.k !== "replay_ready");
    expect(liveUi.length).toBeGreaterThan(5);

    booted.fake.grantLease(23, 9);
    booted.fake.pmCommand(23, 14, "replay", "7 cinematic", "chat");
    await waitFor(() => booted.fake.received.find((f) => f.t === "run_end" && f.run === 23), "the replay's run_end", 30_000);

    const replayUi = uiOfRun(booted.fake, 23).filter((u) => u.k !== "notice" && u.k !== "replay_ready");
    // same film: the same kinds of cue in the same order (the ordering of cues that share an instant may differ)
    const bag = (xs: PerfectmanUi[]): string[] => xs.map((u) => (u.k === "camera" ? `camera:${u.shot}` : u.k === "sfx" ? `sfx:${u.cue}` : u.k)).sort();
    expect(bag(replayUi)).toEqual(bag(liveUi));
    expect(replayUi[0]).toMatchObject({ k: "hud", letterbox: true });
    expect(replayUi.flatMap((u) => cueViolations(u))).toEqual([]);
    // every cue carries the replay's lease, never the recorded run's
    const pushes = booted.fake.received.filter((f) => f.t === "ui_push" && f.run === 23);
    expect(pushes.every((f) => f.t === "ui_push" && f.lease === 9)).toBe(true);
    expect(booted.fake.staleUiPushes).toBe(0);
    // cues point at the replay's actors (run 23's ids), not at the recorded run's
    const replayIds = new Set(booted.fake.received.filter((f) => f.t === "actor_cmd" && f.run === 23).map((f) => (f.t === "actor_cmd" ? f.actor : 0)));
    const targeted = replayUi.flatMap((u) => (u.k === "camera" && "avatar" in u.target ? [u.target.avatar] : u.k === "cue" || u.k === "thought" ? [u.id] : []));
    expect(targeted.length).toBeGreaterThan(0);
    for (const id of targeted) expect(replayIds.has(id), String(id)).toBe(true);
    // the camera is on the speaker before the line, as it was live
    const frames = booted.fake.received.filter((f) => (f.t === "ui_push" || f.t === "actor_cmd") && f.run === 23);
    const firstLine = frames.findIndex((f) => f.t === "actor_cmd" && f.cmd.k === "chat" && f.cmd.mode !== "thought");
    const closeUp = frames.findIndex((f) => f.t === "ui_push" && f.ui.k === "camera" && f.ui.shot === "close_up");
    expect(closeUp).toBeGreaterThanOrEqual(0);
    expect(closeUp).toBeLessThan(firstLine);
    // and the film ends closed
    expect(replayUi.some((u) => u.k === "hud" && u.letterbox === false)).toBe(true);
    expect(spoken(booted.fake, 23)).toEqual(spoken(booted.fake, 7));
  }, 60_000);

  it("a default recording asked for as cinematic plays the world and says there is no film", async () => {
    const booted = await record({ run: 7, mode: "default", lines: 3 });
    booted.fake.grantLease(24, 1);
    booted.fake.pmCommand(24, 14, "replay", "7 cinematic", "chat");
    await waitFor(() => booted.fake.received.find((f) => f.t === "run_end" && f.run === 24), "run_end", 30_000);
    expect(spoken(booted.fake, 24)).toEqual(spoken(booted.fake, 7));
    expect(uiOfRun(booted.fake, 24).filter((u) => u.k !== "notice" && u.k !== "hud")).toEqual([]);
  }, 60_000);
});
