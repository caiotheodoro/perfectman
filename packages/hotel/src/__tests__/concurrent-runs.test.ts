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

type Cmd = Extract<SidecarFrame, { t: "actor_cmd" }>;
const cmdsOfRun = (hotel: FakeDirector, run: number): Cmd[] => hotel.received.filter((f): f is Cmd => f.t === "actor_cmd" && f.run === run);

/** Two live runs of one scenario, so the same cast ids (`person-1` .. `person-3`), in two rooms of one hotel. */
async function twoRuns() {
  fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4 });
  fake.addRoom(12);
  fake.addRoom(13);
  fake.addHuman(12, 9, "ana", 6, 5);
  fake.addHuman(13, 10, "beto", 6, 5);
  const booted = await bootSidecar({ fake });
  sidecar = booted.sidecar;
  fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
  fake.startRun({ run: 8, room: 13, scenarioVersion: 31 });
  await waitFor(() => fake?.received.filter((f) => f.t === "run_ack" && f.ok).length === 2, "both runs acked");
  await waitFor(() => fake?.received.filter((f) => f.t === "actor_spawn").length === 6, "six spawns");
  return { fake, sidecar: booted.sidecar };
}

describe("two live runs at once, with the same character ids (scenario d)", () => {
  it("keeps each run's actors apart: its own ids, its own room, every command answered", async () => {
    const { fake: hotel, sidecar: sc } = await twoRuns();
    const manager = sc.manager!;
    const a = manager.mirror.scoped(7);
    const b = manager.mirror.scoped(8);

    for (const ref of ["person-1", "person-2", "person-3"]) {
      expect(a.avatarId(ref)).toBe(hotel.avatarByRef(ref, 7)?.id);
      expect(b.avatarId(ref)).toBe(hotel.avatarByRef(ref, 8)?.id);
      expect(a.avatarId(ref)).not.toBe(b.avatarId(ref));
      expect(a.roomOfRef(ref)).toBe("12");
      expect(b.roomOfRef(ref)).toBe("13");
    }
    expect(manager.getRun(7)?.agentIds).toEqual(["person-1", "person-2", "person-3"]);
    expect(manager.getRun(8)?.agentIds).toEqual(["person-1", "person-2", "person-3"]);
    // Each run sees its own cast under the plain ref, and nobody from the other room.
    expect(a.view("person-1", Date.now())?.room?.occupants.map((p) => p.ref).sort()).toEqual(["h:9", "person-1", "person-2", "person-3"]);
    expect(b.view("person-1", Date.now())?.room?.occupants.map((p) => p.ref).sort()).toEqual(["h:10", "person-1", "person-2", "person-3"]);
  });

  it("answers the players of both runs, and no command goes to the other run's actors", async () => {
    const { fake: hotel } = await twoRuns();
    const ids = (run: number) => new Set([1, 2, 3].map((s) => -(run * 100 + s)));
    // let the first arrivals settle
    await waitFor(() => hotel.chats.length > 0, "the cast's first lines", 8000);

    const before = hotel.chats.length;
    hotel.humanSay(12, 9, "oi Duda, tudo bem?");
    hotel.humanSay(13, 10, "oi Duda, tudo bem?");
    await waitFor(() => hotel.chats.slice(before).some((c) => ids(7).has(c.actor) && c.mode === "say") && hotel.chats.slice(before).some((c) => ids(8).has(c.actor) && c.mode === "say"), "a reply in each room", 12_000);

    // The failure of scenario d: run A's commands went to run B's actors and came back `unknown_actor`.
    expect(hotel.errorsSent.filter((e) => e.code === "unknown_actor")).toEqual([]);
    for (const run of [7, 8]) {
      const sent = cmdsOfRun(hotel, run);
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.filter((c) => !ids(run).has(c.actor))).toEqual([]);
    }
    // And a line is heard in its own room only.
    for (const c of hotel.chats) expect(ids(7).has(c.actor) || ids(8).has(c.actor)).toBe(true);
  }, 30_000);

  it("takes the actors of a run out when it stops, and leaves the other run's alone", async () => {
    const { fake: hotel, sidecar: sc } = await twoRuns();
    hotel.pmCommand(7, 12, "stop");
    await waitFor(() => hotel.received.find((f) => f.t === "run_end" && f.run === 7), "run 7 ended", 8000);
    expect(hotel.avatarByRef("person-1", 7)).toBeUndefined();
    expect(hotel.avatarByRef("person-1", 8)).toBeDefined();
    expect(sc.manager?.mirror.scoped(8).roomOfRef("person-1")).toBe("13");
    expect(sc.manager?.mirror.scoped(7).roomOfRef("person-1")).toBeUndefined();
    hotel.pmCommand(8, 13, "stop");
    await waitFor(() => hotel.received.find((f) => f.t === "run_end" && f.run === 8), "run 8 ended", 8000);
    expect(hotel.actorsLeft()).toBe(0);
  }, 30_000);
});
