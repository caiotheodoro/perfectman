import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

async function boot() {
  const b = await bootSidecar();
  fake = b.fake;
  sidecar = b.sidecar;
  await waitFor(() => fake?.received.some((f) => f.t === "hello_ack"), "hello_ack");
  return b;
}

describe("one run end to end on the fake Director with the mock provider", () => {
  it("hello, snapshot, spawn, an addressed human line gets a typed reply, stop walks everyone out", async () => {
    const { fake: hotel, http, cfg } = await boot();
    hotel.startRun({ run: 7, room: 12, scenarioVersion: 31 });

    const ack = await waitFor(() => hotel.received.find((f) => f.t === "run_ack"), "run_ack");
    expect(ack).toMatchObject({ t: "run_ack", run: 7, ok: true });
    await waitFor(() => hotel.received.filter((f) => f.t === "actor_spawn").length === 3, "3 spawns");
    expect(hotel.received.some((f) => f.t === "subscribe_room" && f.room === 12)).toBe(true);
    await waitFor(() => hotel.received.some((f) => f.t === "actor_cmd" && f.cmd.k === "walk"), "the cast walking in");

    hotel.humanSay(12, 9, "oi Duda, tudo bem?");
    const reply = await waitFor(() => hotel.chats.find((c) => c.mode === "say"), "a spoken reply", 6000);
    expect(reply.text.length).toBeGreaterThan(0);
    // Typing started before the line landed and was switched off by it.
    const first = hotel.received.findIndex((f) => f.t === "actor_cmd" && f.cmd.k === "typing" && f.cmd.on);
    const spoke = hotel.received.findIndex((f) => f.t === "actor_cmd" && f.cmd.k === "chat" && f.cmd.mode === "say");
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(spoke);

    hotel.pmCommand(7, 12, "stop");
    await waitFor(() => hotel.received.find((f) => f.t === "run_end"), "run_end", 6000);
    expect(hotel.actorsLeft()).toBe(0);
    expect(hotel.received.filter((f) => f.t === "actor_despawn").every((f) => f.t === "actor_despawn" && f.mode === "walk_out")).toBe(true);
    await waitFor(() => http.registered.length > 0, "artifact registration");
    const manifest = JSON.parse(readFileSync(join(cfg.dataDir, "runs", "7", "replay.json"), "utf8")) as { stopReason: string };
    expect(manifest.stopReason).toBe("stopped");
  });
});
