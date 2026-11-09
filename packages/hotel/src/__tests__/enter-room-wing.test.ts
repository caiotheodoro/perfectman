import { afterEach, describe, expect, it } from "vitest";
import type { SidecarFrame } from "../director/index.js";
import type { Sidecar } from "../sidecar.js";
import { FakeDirector } from "../testing/fake-director.js";
import { TEST_SECRET, bootSidecar, waitFor } from "../testing/helpers.js";

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;
afterEach(async () => {
  await sidecar?.close();
  await fake?.stop();
  sidecar = fake = undefined;
});

type Walk = { actor: number; x: number; y: number };
type ActorCmd = Extract<SidecarFrame, { t: "actor_cmd" }>;

const enterWalks = (hotel: FakeDirector): Walk[] =>
  hotel.received
    .filter((f): f is ActorCmd => f.t === "actor_cmd" && f.cmd.k === "walk" && f.cmd.plan?.endsWith(":enter") === true)
    .map((f) => ({ actor: f.actor, x: (f.cmd as { x: number }).x, y: (f.cmd as { y: number }).y }));

describe("enterRoom placement", () => {
  it("a wing room (45) walks the first two actors to its fixed tiles", async () => {
    fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4 });
    fake.addRoom(45);
    fake.addHuman(45, 9, "ana", 6, 5);
    const booted = await bootSidecar({ fake, timing: { baseIntervalMs: 60_000 } });
    sidecar = booted.sidecar;
    fake.startRun({ run: 7, room: 45, scenarioVersion: 31 });
    await waitFor(() => enterWalks(booted.fake).length >= 3, "the cast walking in");

    const [first, second] = enterWalks(booted.fake);
    expect(Math.max(Math.abs(first!.x - 3), Math.abs(first!.y - 1))).toBeLessThanOrEqual(1);
    expect(Math.max(Math.abs(second!.x - 4), Math.abs(second!.y - 5))).toBeLessThanOrEqual(1);
  });
});
