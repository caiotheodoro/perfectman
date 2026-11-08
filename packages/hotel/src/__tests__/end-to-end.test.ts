import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Sidecar } from "../sidecar.js";
import { FakeDirector } from "../testing/fake-director.js";
import { bootSidecar, TEST_SECRET, waitFor } from "../testing/helpers.js";

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

/** Resolves once the sidecar has sent nothing for a beat (arrival wakes and their replies have settled). */
async function quiet(hotel: FakeDirector, ms = 400): Promise<void> {
  const count = (): number => hotel.received.filter((f) => f.t !== "run_status").length;
  let seen = -1;
  let since = Date.now();
  while (Date.now() - since < ms) {
    if (count() !== seen) {
      seen = count();
      since = Date.now();
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function bootWith(over: Parameters<typeof bootSidecar>[0], setup?: (f: FakeDirector) => void) {
  const f = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4 });
  f.addRoom(12);
  f.addHuman(12, 9, "ana", 6, 5);
  setup?.(f);
  const b = await bootSidecar({ ...over, fake: f });
  fake = b.fake;
  sidecar = b.sidecar;
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

  it("with no base pulse in reach, an addressed line is answered through the focus lane, and typing starts at onConsult", async () => {
    // One base pulse a minute: the only thing that can consult a model within the test is a focused pulse.
    const { fake: hotel } = await bootWith({ timing: { baseIntervalMs: 60_000 } });
    hotel.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    await waitFor(() => hotel.received.filter((f) => f.t === "actor_spawn").length === 3, "3 spawns");
    await waitFor(() => hotel.received.some((f) => f.t === "actor_cmd" && f.cmd.k === "walk"), "the cast walking in");
    await quiet(hotel);
    const status = () => hotel.received.filter((f) => f.t === "run_status").at(-1);
    const calls = status()?.llm_calls ?? 0;
    const pulse = status()?.pulse ?? 0;
    const typedBefore = hotel.typingLog.length;
    const duda = hotel.avatarByRef("person-1")?.id;
    expect(duda).toBeDefined();

    hotel.humanSay(12, 9, "oi Duda, tudo bem?");
    // Typing is switched on the moment the addressee takes its generate slot, long before the model answers.
    await waitFor(() => hotel.typingLog.slice(typedBefore).some((t) => t.on), "typing at consult", 3000);
    await quiet(hotel);
    const typers = new Set(hotel.typingLog.slice(typedBefore).filter((t) => t.on).map((t) => t.actor));
    expect([...typers]).toEqual([duda]);
    // The model was called and answered by focused pulses only: the base pulse index did not move.
    await waitFor(() => (status()?.llm_calls ?? 0) > calls, "the status to count the call");
    expect(status()?.pulse).toBe(pulse);
    // D53: the run panel's latency travels as p50/p95; lag_ms is the sidecar's own loop lag.
    expect(status()).toMatchObject({ llm_p50_ms: expect.any(Number), llm_p95_ms: expect.any(Number), lag_ms: expect.any(Number) });
  });

  it("a room change moves the actor's channel membership and records moved_room on the destination channel", async () => {
    const { fake: hotel, sidecar: sc, cfg } = await bootWith({ timing: { baseIntervalMs: 60_000 } }, (f) => f.addRoom(13));
    hotel.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    await waitFor(() => hotel.received.filter((f) => f.t === "actor_spawn").length === 3, "3 spawns");
    const registry = sc.manager?.getRun(7)?.simulation?.runtime.getChannelRegistry();
    await waitFor(() => registry, "the runtime");
    expect(await registry?.isMember("person-1", "room:12")).toBe(true);

    // D24: every room the hotel listed is reachable by the door, so move_room has a target.
    const mirror = sc.manager!.mirror.scoped(7);
    const adj = mirror.view("person-1", Date.now())?.adjacency ?? [];
    expect(adj).toEqual([expect.objectContaining({ roomId: "13", name: "Room 13", travelS: expect.any(Number), viaDoor: expect.any(Array) })]);
    expect(adj[0]?.travelS).toBeGreaterThan(0);

    hotel.moveActorToRoom("person-1", 13);
    // The sidecar mirrors the room it just entered, or the actor would be in transit for good.
    await waitFor(() => hotel.received.some((f) => f.t === "subscribe_room" && f.room === 13), "a subscription to room 13");
    await waitFor(() => mirror.roomOfRef("person-1") === "13", "person-1 mirrored in room 13");
    expect(mirror.view("person-1", Date.now())?.adjacency.map((a) => a.roomId)).toEqual(["12"]);
    const moved = async (): Promise<boolean> => (await registry?.isMember("person-1", "room:13")) === true && (await registry?.isMember("person-1", "room:12")) === false;
    const t0 = Date.now();
    while (!(await moved())) {
      if (Date.now() - t0 > 4000) throw new Error("membership did not follow the actor");
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(await registry?.isMember("person-2", "room:12")).toBe(true);

    hotel.pmCommand(7, 12, "stop");
    await waitFor(() => hotel.received.find((f) => f.t === "run_end"), "run_end", 6000);
    const events = readFileSync(join(cfg.dataDir, "runs", "7", "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { type: string; channelId: string; actorId: string; payload: Record<string, unknown> });
    const hop = events.find((e) => e.type === "moved_room");
    expect(hop).toMatchObject({ channelId: "room:13", actorId: "person-1", payload: { from: "12", to: "13" } });
  });
  it("hello's rooms are all reachable (D24): an actor takes a door into a room of the Perfectman wing that no run is in", async () => {
    const { fake: hotel, sidecar: sc } = await bootWith({ timing: { baseIntervalMs: 60_000 } }, (f) => {
      f.addRoom(13);
      f.addRoom(40, 10, 8, { name: "Perfectman Lobby", official: true, section: "Perfectman" });
    });
    hotel.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    await waitFor(() => hotel.received.filter((f) => f.t === "actor_spawn").length === 3, "3 spawns");
    const mirror = sc.manager!.mirror.scoped(7);
    const adj = mirror.view("person-1", Date.now())?.adjacency ?? [];
    expect(adj.map((a) => a.roomId).sort()).toEqual(["13", "40"]);
    expect(adj.find((a) => a.roomId === "40")).toMatchObject({ name: "Perfectman Lobby", travelS: expect.any(Number) });

    // the sidecar asks for the hop on the wire, like the body executor does for a `move_room`
    const manager = sc.manager!;
    const actor = hotel.avatarByRef("person-1")!;
    expect(manager.send({ t: "actor_cmd", run: 7, lease: manager.leaseOf(7) ?? 0, cid: manager.nextCid(7), actor: actor.id, cmd: { k: "move_room", room: 40, via: "door" } })).toBe(true);
    await waitFor(() => hotel.received.some((f) => f.t === "subscribe_room" && f.room === 40), "a subscription to the wing room");
    await waitFor(() => mirror.roomOfRef("person-1") === "40", "person-1 mirrored in the wing room");
    expect(hotel.rooms.get(40)?.avatars.has(actor.id)).toBe(true);
    // and a way back
    expect(mirror.view("person-1", Date.now())?.adjacency.map((a) => a.roomId).sort()).toEqual(["12", "13"]);
  });

  it("eventRetention keeps a window in memory and streams the evicted events to events.jsonl, so the artifact stays complete", async () => {
    const { fake: hotel, sidecar: sc, cfg } = await bootWith({ config: { eventRetention: 20 }, timing: { baseIntervalMs: 60_000 } });
    hotel.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    await waitFor(() => hotel.received.filter((f) => f.t === "actor_spawn").length === 3, "3 spawns");
    const run = await waitFor(() => sc.manager?.getRun(7), "the run");
    const runtime = await waitFor(() => run.simulation?.runtime, "the runtime");
    const sim = run.simulation!.simulationId;
    const marker = (i: number) => ({ type: "message_sent" as const, simulationId: sim, channelId: "room:12", actorId: "person-1", payload: { text: `filler ${i}` }, visibility: { visibleToAgents: [], visibilityReason: "channel_member" as const }, pulseIndex: 0 });
    for (let i = 0; i < 300; i++) await runtime.getEventLog().append(sim, [marker(i) as never]);
    const inMemory = (await run.simulation!.repositories.eventRepo.getCommittedThrough(sim, Number.MAX_SAFE_INTEGER)).length;
    expect(inMemory).toBeLessThan(150);

    hotel.pmCommand(7, 12, "stop");
    await waitFor(() => hotel.received.find((f) => f.t === "run_end"), "run_end", 6000);
    const lines = readFileSync(join(cfg.dataDir, "runs", "7", "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { payload: { text?: string } });
    const filler = lines.filter((e) => e.payload.text?.startsWith("filler ")).map((e) => e.payload.text);
    expect(filler).toEqual(Array.from({ length: 300 }, (_, i) => `filler ${i}`));
  });
  it("the mock provider gives some actors a body: an actor sits on the seat and the sit command reaches the hotel", async () => {
    const { fake: hotel } = await bootWith({ timing: { baseIntervalMs: 40, coalesceMs: 10 } });
    hotel.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    const sit = await waitFor(() => hotel.received.find((f) => f.t === "actor_cmd" && f.cmd.k === "sit"), "a sit command", 20_000);
    expect(sit).toMatchObject({ t: "actor_cmd", cmd: { k: "sit", furni: 1 } });
  }, 30_000);
});
