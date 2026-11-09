import { afterEach, describe, expect, it } from "vitest";
import type { Sidecar } from "../sidecar.js";
import { A, B, C, H, WIDE_BLOCK, emotion, makeRig } from "../testing/drama-rig.js";
import type { Rig } from "../testing/drama-rig.js";
import { FakeDirector } from "../testing/fake-director.js";
import { TEST_SECRET, bootSidecar, waitFor } from "../testing/helpers.js";
import { lifecycleFrames } from "../testing/hotel-fixtures.js";
import type { Lifecycle } from "../testing/hotel-fixtures.js";

/** Feeds the frames of a recorded lifecycle to the director in the order the hotel sent them; `until` stops after the first frame it matches. */
function feed(rig: Rig, life: Lifecycle, until?: (frame: Record<string, unknown>) => boolean): void {
  for (const frame of lifecycleFrames(life)) {
    rig.hotel([frame]);
    if (until?.(frame)) return;
  }
}

const hug = (rig: Rig, actor: number, target: number) => rig.dir.decide({ actor, proposal: { verb: "hug", with: target, origin: "model" }, emotion: emotion({ warmth: 1 }) });
const slap = (rig: Rig, actor: number, target: number) => rig.dir.decide({ actor, proposal: { verb: "slap", with: target, origin: "model" }, emotion: emotion({ dominanceAssertion: 1 }) });
const punch = (rig: Rig, actor: number, target: number) => rig.dir.decide({ actor, proposal: { verb: "punch", with: target, origin: "model" }, emotion: emotion({ dominanceAssertion: 1 }) });

describe("the director reads the hotel's recorded lifecycles", () => {
  it("[FRM-1] [LAD-3] a slap the human takes: the actor is busy until act_done, then the pair stands on rung 4 and the 20 s spacing of physical beats holds", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    feed(rig, "slap-human-take", (f) => f["t"] === "act_beat");
    expect(rig.dir.busyActId(A)).toBe("s1");
    feed(rig, "slap-human-take");
    expect(rig.dir.busyActId(A)).toBeUndefined();
    expect(punch(rig, A, H)).toMatchObject({ kind: "veto", reason: "budget", detail: "physical" });
  });

  it("[CHIP-9] a slap the human lands leaves no chip cooldown: a hug by someone else is not blocked for it", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    feed(rig, "slap-human-take");
    expect(hug(rig, C, H)).not.toMatchObject({ reason: "cooldown" });
  });

  it("[CHIP-9] a chip nobody answers ends dodged by timeout and leaves the human alone for a minute, for every actor", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    feed(rig, "slap-human-timeout");
    expect(rig.dir.busyActId(A)).toBeUndefined();
    expect(hug(rig, C, H)).toMatchObject({ kind: "veto", reason: "cooldown", detail: "chip_cooldown" });
  });

  it("[DEATH-1] [SCENE-3] a kill makes the target a body, and the scene cut that revives it starts the ladder over", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    feed(rig, "kill-actor-revive", (f) => f["t"] === "act_done");
    expect(slap(rig, A, B)).toMatchObject({ kind: "veto", reason: "dead_target" });
    feed(rig, "kill-actor-revive");
    expect(rig.dir.scene).toBe("7.2");
    expect(slap(rig, A, B)).toMatchObject({ kind: "veto", reason: "ladder", detail: "rung" });
  });

  it("[DOWN-1] [DOWN-3] a killed human is down until human_up, and the abort of the act in between does not stand them up", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    feed(rig, "down-human-abort", (f) => f["t"] === "act_done");
    expect(rig.dir.busyActId(A)).toBeUndefined();
    expect(hug(rig, A, H)).toMatchObject({ kind: "veto", reason: "dead_target" });
    feed(rig, "down-human-abort");
    expect(hug(rig, A, H)).not.toMatchObject({ reason: "dead_target" });
  });
});

describe("a sidecar on the fake hotel is fed the same frames", () => {
  let fake: FakeDirector | undefined;
  const sidecars: Sidecar[] = [];
  afterEach(async () => {
    for (const s of sidecars.splice(0)) await s.close();
    await fake?.stop();
    fake = undefined;
  });

  async function boot() {
    fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4, drama: { dead: [] } });
    fake.addRoom(12);
    fake.addHuman(12, 9, "ana", 6, 5);
    const booted = await bootSidecar({ fake, config: { drama: true } });
    sidecars.push(booted.sidecar);
    await waitFor(() => fake?.dialect === 2, "dialect 2");
    fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    await waitFor(() => fake?.avatarByRef("person-3", 7)?.id, "three actors");
    const run = booted.sidecar.manager?.getRun(7);
    if (!run) throw new Error("no run");
    fake.scriptDramaState({ run: 7, room: 12, enabled: true });
    await waitFor(() => run.dramaSink.active, "the planner side to be on");
    return { hotel: fake, run };
  }

  it("[DEATH-2] [SCENE-3] the hotel's actor_death makes the planner side treat the actor as dead, and its scene cut and actor_revive bring it back, frame for frame as recorded", async () => {
    const { hotel, run } = await boot();
    const ids = ["person-1", "person-2", "person-3"].map((r) => hotel.avatarByRef(r, 7)?.id);
    expect(ids).toEqual([-701, -702, -703]);
    const frames = lifecycleFrames("kill-actor-revive");
    const death = frames.findIndex((f) => f["t"] === "actor_death");
    for (const f of frames.slice(0, death + 1)) hotel.send(f);
    await waitFor(() => run.dramaSink.isDead("person-2"), "person-2 dead");
    for (const f of frames.slice(death + 1)) hotel.send(f);
    await waitFor(() => !run.dramaSink.isDead("person-2"), "person-2 alive again");
    expect(run.dramaPort?.scene).toBe("7.2");
  });

  it("[FRM-1] a whole recorded slap reaches the director and the planner side through the one hub: the director sees the act close, and nothing invalid goes back to the hotel", async () => {
    const { hotel, run } = await boot();
    const before = hotel.received.filter((f) => f.t === "actor_cmd" && f.cmd.k === "act").length;
    const [started, ...rest] = lifecycleFrames("slap-human-take");
    hotel.send(started ?? {});
    await waitFor(() => run.dramaPort?.busyActId(-701) === "s1", "the director to see the act open");
    for (const f of rest) hotel.send(f);
    await waitFor(() => run.dramaPort?.busyActId(-701) === undefined, "the director to see the act close");
    await new Promise((r) => setTimeout(r, 300));
    expect(hotel.rejectedActs).toEqual([]);
    expect(hotel.received.filter((f) => f.t === "actor_cmd" && f.cmd.k === "act")).toHaveLength(before);
  });
});
