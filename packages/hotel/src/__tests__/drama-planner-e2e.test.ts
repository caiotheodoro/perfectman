import { afterEach, describe, expect, it } from "vitest";
import type { Sidecar } from "../sidecar.js";
import { FakeDirector } from "../testing/fake-director.js";
import { TEST_SECRET, bootSidecar, waitFor } from "../testing/helpers.js";

let fake: FakeDirector | undefined;
const sidecars: Sidecar[] = [];
afterEach(async () => {
  for (const s of sidecars.splice(0)) await s.close();
  await fake?.stop();
  fake = undefined;
});

/** A dialect 2 sidecar against the fake hotel with a run of three in room 12: Duda (person-1), Rafa (person-2), Gabi (person-3). */
async function started() {
  fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4, drama: { dead: [] } });
  fake.addRoom(12);
  fake.addHuman(12, 9, "ana", 6, 5);
  const booted = await bootSidecar({ fake, config: { drama: true } });
  sidecars.push(booted.sidecar);
  await waitFor(() => fake?.dialect === 2, "dialect 2");
  fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
  await waitFor(() => fake?.received.find((f) => f.t === "run_ack" && f.ok), "run_ack");
  await waitFor(() => fake?.received.filter((f) => f.t === "actor_spawn").length === 3, "three spawns");
  const ids = await waitFor(() => {
    const a = ["person-1", "person-2", "person-3"].map((r) => fake?.avatarByRef(r, 7)?.id);
    return a.every((x) => x !== undefined) ? (a as number[]) : undefined;
  }, "three actors in the room");
  const run = booted.sidecar.manager?.getRun(7);
  if (!run) throw new Error("no run");
  fake.scriptDramaState({ run: 7, room: 12, enabled: true });
  await waitFor(() => run.dramaSink.active, "the planner side to be on");
  const [duda, rafa, gabi] = ids as [number, number, number];
  return { hotel: fake, run, duda, rafa, gabi };
}

describe("the planner side of the drama contract against the fake hotel", () => {
  it("[REA-1] [REA-3] a witness the hotel says owes a reaction answers with a qualifying command inside its window, and the hotel's frames are read from the run's own sink", async () => {
    const { hotel, gabi, duda, rafa } = await started();
    const before = hotel.received.filter((f) => f.t === "actor_cmd").length;
    const beatAt = Date.now();
    hotel.scriptAct({ actId: "e1", verb: "slap", actor: duda, with: rafa, run: 7, outcome: "landed", witnesses: [gabi], owed: [{ who: gabi, role: "witness" }] });
    const reply = await waitFor(
      () => hotel.received.slice(before).find((f) => f.t === "actor_cmd" && f.actor === gabi && ["face", "expression", "action", "act"].includes(f.cmd.k)),
      "gabi's reaction",
      3000,
    );
    expect(reply).toBeDefined();
    expect(Date.now() - beatAt).toBeLessThan(3000);
  });

  it("[REA-2] nothing owed, nothing sent: a human target and a witness list with no owed row leave the cast without a single act", async () => {
    const { hotel, gabi, duda } = await started();
    hotel.scriptAct({ actId: "e2", verb: "slap", actor: duda, with: 9, run: 7, outcome: "landed", chip: true, answer: "take", witnesses: [gabi, 9], owed: [] });
    await new Promise((r) => setTimeout(r, 900));
    expect(hotel.received.filter((f) => f.t === "actor_cmd" && f.cmd.k === "act")).toEqual([]);
  });

  it("[DEATH-2] [DEATH-7] a killed actor is out of the speaker pool until its revive: the run's ledger and executor say so, and it speaks again after", async () => {
    const { hotel, run, duda, rafa } = await started();
    hotel.scriptAct({ actId: "e3", verb: "kill", actor: duda, with: rafa, run: 7, outcome: "landed", death: { victim: rafa, killer: duda } });
    await waitFor(() => run.dramaSink.isDead("person-2"), "person-2 dead");
    const quiet = hotel.received.length;
    await new Promise((r) => setTimeout(r, 700));
    expect(hotel.received.slice(quiet).filter((f) => f.t === "actor_cmd" && f.actor === rafa)).toEqual([]);
    hotel.scriptSceneCut({ run: 7, room: 12, scene: "7.3", prev: "7.2", revived: [rafa] });
    await waitFor(() => !run.dramaSink.isDead("person-2"), "person-2 alive again");
  });
});
