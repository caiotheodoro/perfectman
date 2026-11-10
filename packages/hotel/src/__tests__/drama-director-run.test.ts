import { afterEach, describe, expect, it } from "vitest";
import type { CineConfig } from "../director/cine/types.js";
import type { DramaApproval } from "../director/drama/index.js";
import type { Sidecar } from "../sidecar.js";
import { FakeDirector } from "../testing/fake-director.js";
import type { FakeDramaOffer } from "../testing/fake-director.js";
import { emotion } from "../testing/drama-rig.js";
import { TEST_SECRET, bootSidecar, waitFor } from "../testing/helpers.js";

const FAST_CINE: Partial<CineConfig> = {
  readingScale: 0.02, introMs: 300, sceneCardMs: 200, fillerAfterMs: 250, fillerMs: 150, minShotMs: 40,
  easeMs: { establishing: 20, two_shot: 20, close_up: 10, tracking: 20, reaction: 10 },
  beatGapMs: 20, cueLeadMs: 10, typingLeadMs: 20, narratorWaitMs: 50, drainMs: 500, pulseMs: 150,
};

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;
afterEach(async () => {
  await sidecar?.close();
  await fake?.stop();
  sidecar = fake = undefined;
});

/** The sidecar against a fake hotel (room 12, human 9 opted in) with a three-person scenario running as run 7. */
async function boot(o: { offer?: FakeDramaOffer; mode?: "default" | "cinematic" }) {
  fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4, autoAct: true, ...(o.offer ? { drama: o.offer } : {}) });
  fake.addRoom(12);
  fake.addHuman(12, 9, "ana", 6, 5);
  fake.optIn.set(12, [9]);
  const booted = await bootSidecar({ fake, timing: { cine: FAST_CINE } });
  sidecar = booted.sidecar;
  const hotel = booted.fake;
  hotel.startRun({ run: 7, room: 12, scenarioVersion: 31, ...(o.mode ? { mode: o.mode } : {}) });
  await waitFor(() => hotel.received.find((f) => f.t === "run_ack" && f.ok), "run_ack");
  await waitFor(() => hotel.received.filter((f) => f.t === "actor_spawn").length === 3, "three spawns");
  const manager = booted.sidecar.manager!;
  const run = await waitFor(() => manager.getRun(7), "the run");
  const one = await waitFor(() => hotel.avatarByRef("person-1", 7), "person-1 in the room");
  const two = await waitFor(() => hotel.avatarByRef("person-2", 7), "person-2 in the room");
  await waitFor(() => run.state === "running", "a running run");
  return { hotel, run, a: one.id, b: two.id };
}

const acts = (hotel: FakeDirector) => hotel.received.flatMap((f) => (f.t === "actor_cmd" && f.cmd.k === "act" ? [f] : []));

describe("the director inside a run, against the fake hotel", () => {
  it("[NEG-4] on a dialect 1 link (a hotel that does not offer drama) the director exists but is inert: it passes and sends nothing", async () => {
    const { hotel, run, a, b } = await boot({});
    expect(run.dramaPort?.active).toBe(false);
    expect(run.advanceScene("x")).toEqual({ kind: "refused", why: "inert" });
    expect(run.dramaPort?.decide({ actor: a, proposal: { verb: "glare", with: b, origin: "model" }, emotion: emotion({ resentfulColdness: 1 }) })).toEqual({ kind: "pass", why: "inert" });
    expect(acts(hotel)).toHaveLength(0);
  });

  it("[FRM-1] [HYBRID] an approved proposal goes out as origin model, is held busy until the hotel's act_done, and is in the frame log", async () => {
    const { hotel, run, a, b } = await boot({ offer: {} });
    hotel.scriptDramaState({ run: 7, room: 12, scene: "7.1", optIn: [9] });
    const port = run.dramaPort!;
    await waitFor(() => port.active, "an active director");
    const d = port.decide({ actor: a, proposal: { verb: "glare", with: b, origin: "model" }, emotion: emotion({ resentfulColdness: 1 }, { toward: [b] }) }) as DramaApproval;
    expect(d).toMatchObject({ kind: "approve", verb: "glare", origin: "model" });
    await waitFor(() => acts(hotel).length === 1, "the act on the wire");
    expect(acts(hotel)[0]?.cmd).toMatchObject({ k: "act", act_id: d.actId, verb: "glare", with: b, origin: "model" });
    await waitFor(() => port.busyActId(a) === undefined, "the act_done to free the actor");
    expect(run.frameLog.frames.some((f) => f.kind === "actor_cmd" && f.dir === "out" && (f.data["cmd"] as { k?: string }).k === "act")).toBe(true);
  });

  it("[FRM-1] a passive model is given a beat by the director, as origin director", async () => {
    const { hotel, run, a, b } = await boot({ offer: {} });
    const port = run.dramaPort!;
    await waitFor(() => port.active, "an active director");
    const d = port.decide({ actor: a, emotion: emotion({ resentfulColdness: 1, contemptuousDismissal: 1 }, { toward: [b] }) });
    expect(d).toMatchObject({ kind: "initiate", origin: "director", with: b });
    await waitFor(() => acts(hotel).length === 1, "the act on the wire");
    expect(acts(hotel)[0]?.cmd).toMatchObject({ origin: "director" });
  });

  it("[SCENE-5] the run's scene_advance is refused while the scene is young and nothing reaches the hotel", async () => {
    const { hotel, run } = await boot({ offer: {} });
    await waitFor(() => run.dramaPort?.active, "an active director");
    expect(run.advanceScene("scenario_beat_1")).toMatchObject({ kind: "refused", why: "too_young" });
    expect(hotel.received.some((f) => f.t === "scene_advance")).toBe(false);
  });

  it("[SCENE-2] a cinematic run films cuts and cues and never sends a scene_advance", async () => {
    const { hotel, run } = await boot({ offer: {}, mode: "cinematic" });
    await waitFor(() => run.dramaPort?.active, "an active director");
    await waitFor(() => hotel.received.some((f) => f.t === "ui_push"), "the audience's frames", 8000);
    await new Promise((r) => setTimeout(r, 300));
    expect(hotel.received.some((f) => f.t === "scene_advance")).toBe(false);
    expect(run.dramaPort?.scene).toBe("7.1");
  }, 15_000);
});
