import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeMetrics } from "../director/cine/metrics.js";
import { parseTrack } from "../director/cine/track.js";
import type { CineConfig } from "../director/cine/types.js";
import type { Sidecar } from "../sidecar.js";
import { FakeDirector } from "../testing/fake-director.js";
import { bootSidecar, waitFor } from "../testing/helpers.js";

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;

afterEach(async () => {
  await sidecar?.close();
  await fake?.stop();
  sidecar = fake = undefined;
});

/** Playback scaled down ~50x so a real-time run fits a test; the order and the rules are the same. */
const FAST_CINE: Partial<CineConfig> = {
  readingScale: 0.02, introMs: 300, sceneCardMs: 200, fillerAfterMs: 250, fillerMs: 150, minShotMs: 40,
  easeMs: { establishing: 20, two_shot: 20, close_up: 10, tracking: 20, reaction: 10 },
  beatGapMs: 20, cueLeadMs: 10, typingLeadMs: 20, narratorWaitMs: 50, drainMs: 500, pulseMs: 150,
};

describe("a cinematic run on the fake hotel with the mock provider", () => {
  it("films the run: letterbox and title first, a camera cue before the first spoken line, the HUD closed on stop, the track on disk", async () => {
    const { fake: hotel, cfg, sidecar: s } = await bootSidecar({ timing: { cine: FAST_CINE } });
    fake = hotel;
    sidecar = s;
    hotel.startRun({ run: 7, room: 12, scenarioVersion: 31, mode: "cinematic" });
    await waitFor(() => hotel.received.find((f) => f.t === "run_ack" && f.ok), "run_ack");
    await waitFor(() => hotel.chats.length >= 2, "two spoken lines", 8000);

    const frames = hotel.received;
    const ui = frames.flatMap((f, i) => (f.t === "ui_push" ? [{ i, ui: f.ui }] : []));
    expect(ui[0]?.ui).toMatchObject({ k: "hud", letterbox: true });
    expect(ui.some((u) => u.ui.k === "card" && u.ui.kind === "title")).toBe(true);
    const firstChat = frames.findIndex((f) => f.t === "actor_cmd" && f.cmd.k === "chat");
    const firstCamera = ui.find((u) => u.ui.k === "camera" && u.ui.shot !== "establishing");
    expect(firstCamera?.i).toBeLessThan(firstChat);

    hotel.pmCommand(7, 12, "stop");
    await waitFor(() => hotel.received.find((f) => f.t === "run_end"), "run_end", 6000);
    const closed = hotel.received.some((f) => f.t === "ui_push" && f.ui.k === "hud" && f.ui.letterbox === false);
    expect(closed).toBe(true);

    const track = parseTrack(readFileSync(join(cfg.dataDir, "runs", "7", "director-track.jsonl"), "utf8"));
    expect(track[0]).toMatchObject({ k: "start", room: 12 });
    expect(track.at(-1)).toMatchObject({ k: "end", reason: "stopped" });
    const m = computeMetrics(track);
    expect(m.lines).toBeGreaterThanOrEqual(2);
    expect(m.shotOnSpeaker.ratio).toBeGreaterThanOrEqual(0.9);
  }, 30_000);

  it("a default-mode run is unchanged: speech goes out straight away and the hotel sees no cinematic cues", async () => {
    const { fake: hotel, sidecar: s } = await bootSidecar();
    fake = hotel;
    sidecar = s;
    hotel.startRun({ run: 8, room: 12, scenarioVersion: 31 });
    await waitFor(() => hotel.received.find((f) => f.t === "run_ack" && f.ok), "run_ack");
    await waitFor(() => hotel.chats.length >= 1, "a spoken line", 8000);
    expect(hotel.received.some((f) => f.t === "ui_push" && f.ui.k === "camera")).toBe(false);
  }, 30_000);
});
