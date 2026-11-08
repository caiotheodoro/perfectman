import { readFileSync } from "node:fs";
import { join } from "node:path";
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

async function liveRun() {
  fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4 });
  fake.addRoom(12);
  fake.addHuman(12, 9, "ana", 6, 5);
  const first = await bootSidecar({ fake });
  sidecars.push(first.sidecar);
  fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
  await waitFor(() => fake?.received.find((f) => f.t === "run_ack" && f.ok), "run_ack");
  await waitFor(() => fake?.received.filter((f) => f.t === "actor_spawn").length === 3, "three spawns");
  await waitFor(() => fake?.received.some((f) => f.t === "actor_cmd" && f.cmd.k === "walk"), "the cast walking in");
  return { hotel: fake, first };
}

describe("a sidecar restart (scenario e, D41)", () => {
  it("walks the actors out and leaves the run to the hotel to mark interrupted, not ended", async () => {
    const { hotel, first } = await liveRun();
    await first.sidecar.close(); // what SIGTERM does
    sidecars.splice(sidecars.indexOf(first.sidecar), 1);

    // the room is clean, the notice told the admin, and the run was not reported ended
    expect(hotel.actorsLeft()).toBe(0);
    expect(hotel.received.filter((f) => f.t === "actor_despawn").every((f) => f.t === "actor_despawn" && f.mode === "walk_out")).toBe(true);
    expect(hotel.received.some((f) => f.t === "ui_push" && f.run === 7 && f.ui.k === "notice" && f.ui.code === "shutting_down")).toBe(true);
    expect(hotel.received.some((f) => f.t === "run_end")).toBe(false);
    expect(hotel.endedRuns).toEqual([]);

    // the artifacts are written as for any stop, so the run can be replayed, and say it was interrupted
    const manifest = JSON.parse(readFileSync(join(first.cfg.dataDir, "runs", "7", "replay.json"), "utf8")) as { finalState: string; stopReason: string };
    expect(manifest).toMatchObject({ finalState: "interrupted", stopReason: "sidecar_shutdown" });
    await waitFor(() => first.http.registered.length > 0, "artifact registration");

    // the next sidecar does not resume it: the hotel marks it interrupted
    const second = await bootSidecar({ fake: hotel });
    sidecars.push(second.sidecar);
    expect(hotel.interruptedRuns).toEqual([7]);
    expect(hotel.endedRuns).toEqual([]);
  }, 30_000);

  it("a deliberate stop is still reported ended", async () => {
    const { hotel } = await liveRun();
    hotel.pmCommand(7, 12, "stop");
    await waitFor(() => hotel.received.find((f) => f.t === "run_end"), "run_end", 8000);
    expect(hotel.endedRuns).toEqual([{ run: 7, reason: "stopped" }]);
    const second = await bootSidecar({ fake: hotel });
    sidecars.push(second.sidecar);
    expect(hotel.interruptedRuns).toEqual([]);
  }, 30_000);
});
