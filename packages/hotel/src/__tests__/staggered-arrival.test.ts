import { afterEach, describe, expect, it } from "vitest";
import { parseStart } from "../authoring/scenario-form.js";
import { Run } from "../run/run.js";
import type { RunDeps } from "../run/run.js";
import { parseScenarioBody } from "../run/scenario-body.js";
import type { Sidecar } from "../sidecar.js";
import type { FakeDirector } from "../testing/fake-director.js";
import { bootSidecar, compiledScenario, waitFor } from "../testing/helpers.js";

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;

afterEach(async () => {
  await sidecar?.close();
  await fake?.stop();
  sidecar = fake = undefined;
});

/** When (ms since the first) each actor_spawn frame reached the hotel, by name. */
function spawnTimes(hotel: FakeDirector): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of hotel.received) if (f.t === "actor_spawn") out[f.name] = (out[f.name] ?? 0) + 1;
  return out;
}

async function watchSpawns(hotel: FakeDirector, count: number): Promise<Array<{ name: string; at: number }>> {
  const seen = new Map<string, number>();
  const t0 = Date.now();
  await waitFor(() => {
    for (const f of hotel.received) if (f.t === "actor_spawn" && !seen.has(f.name)) seen.set(f.name, Date.now() - t0);
    return seen.size >= count;
  }, `${count} spawns`, 8000);
  return [...seen].map(([name, at]) => ({ name, at }));
}

/** A run that has read its body but not started: enough to ask it for the entrance schedule. */
function scheduleOf(agents: Array<{ id: string; arrivalPulse?: number | null }>, arrivals: Record<string, number> | undefined, rng: () => number) {
  const deps = { hotel: { llm: { prices: {} } }, clock: { now: () => 0, setTimer: () => ({ cancel: () => undefined }) }, rng, timing: { arrivalStaggerMs: [1000, 3000] as const } } as unknown as RunDeps;
  const run = new Run({ run: 1, lease: 1, mode: "default", room: 12, scenarioVersion: 1, admin: { id: 9, name: "caio" }, capActors: 12 }, deps);
  const internals = run as unknown as { body: unknown; agents: Map<string, unknown> };
  internals.body = { config: { agents }, ...(arrivals ? { arrivals } : {}) };
  internals.agents = new Map(agents.map((a) => [a.id, { name: a.id, spawned: false, gone: false }]));
  return run.arrivalSchedule();
}

describe("the entrance schedule", () => {
  it("walks the cast in one after another, 1 to 3 s apart by default, the first at once", () => {
    const s = scheduleOf([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], undefined, () => 0.5);
    expect(s.map((x) => x.ref)).toEqual(["a", "b", "c", "d"]);
    expect(s.map((x) => x.atMs)).toEqual([0, 2000, 4000, 6000]);
    const wide = scheduleOf([{ id: "a" }, { id: "b" }, { id: "c" }], undefined, () => 0.99);
    expect(wide[1]!.atMs).toBeGreaterThanOrEqual(1000);
    expect(wide[1]!.atMs).toBeLessThanOrEqual(3000);
  });

  it("a form time wins over arrivalPulse, which wins over the stagger; the earliest is always 0", () => {
    const s = scheduleOf([{ id: "a" }, { id: "b", arrivalPulse: 4 }, { id: "c" }, { id: "d" }], { d: 9000 }, () => 0);
    expect(Object.fromEntries(s.map((x) => [x.ref, x.atMs]))).toEqual({ a: 0, c: 1000, d: 9000, b: 24_000 });
    const shifted = scheduleOf([{ id: "a" }, { id: "b" }], { a: 5000, b: 8000 }, () => 0);
    expect(shifted.map((x) => x.atMs)).toEqual([0, 3000]);
  });
});

describe("staggered arrival", () => {
  it("parses the builder's entrance: 'after N s' is a time, 'start' and 'on cue' are left to the natural stagger", () => {
    expect(parseStart("after 10s")).toBe(10_000);
    expect(parseStart("after 1.5 s")).toBe(1500);
    expect(parseStart("After 3 seconds")).toBe(3000);
    expect(parseStart("depois de 8 s")).toBe(8000);
    expect(parseStart("after 99999s")).toBe(600_000);
    for (const v of ["start", "at start", "on cue", "", undefined, 5]) expect(parseStart(v)).toBeUndefined();
  });

  it("keeps a compiled body's arrivals and drops junk entries", () => {
    const { body } = compiledScenario();
    const parsed = parseScenarioBody({ ...(body as object), arrivals: { "person-1": 2000, "person-2": -5, "person-3": "soon" } });
    expect(parsed.ok && parsed.body.arrivals).toEqual({ "person-1": 2000 });
  });

  it("with no entrance times the cast walks in one after another with a gap, not all at once", async () => {
    const booted = await bootSidecar({ timing: { arrivalStaggerMs: [150, 250], spawnIntervalMs: 5 } });
    fake = booted.fake;
    sidecar = booted.sidecar;
    fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    const spawns = await watchSpawns(fake, 3);
    expect(spawns.map((s) => s.name)).toEqual(["Duda", "Rafa", "Gabi"]);
    const [a, b, c] = spawns.map((s) => s.at) as [number, number, number];
    expect(b - a).toBeGreaterThanOrEqual(120);
    expect(c - b).toBeGreaterThanOrEqual(120);
    expect(spawnTimes(fake)).toEqual({ Duda: 1, Rafa: 1, Gabi: 1 });
    // everyone ends up in the room and takes part
    await waitFor(() => new Set(fake?.chats.map((x) => x.actor)).size >= 2, "two different speakers", 8000);
  }, 30_000);

  it("an actor who has not arrived is not consulted: nothing is decided for her until she walks in", async () => {
    const { body } = compiledScenario();
    const late = { ...(body as object), arrivals: { "person-3": 1500 } };
    const booted = await bootSidecar({ versions: { 31: late }, timing: { arrivalStaggerMs: [10, 20] } });
    fake = booted.fake;
    sidecar = booted.sidecar;
    fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    const run = await waitFor(() => booted.sidecar.manager?.getRun(7), "the run");
    const handle = await waitFor(() => run.simulation, "the simulation");
    const actorsWhoActed = async (): Promise<Set<string>> => {
      const events = await handle.repositories.eventRepo.getAfter(handle.simulationId);
      return new Set(events.filter((e) => e.type === "message_sent" || e.type === "no_op_recorded").map((e) => e.actorId));
    };
    // two people are on the stage and the model is running for them; the third is on her way
    await waitFor(() => fake?.received.filter((f) => f.t === "actor_spawn").length === 2, "the two who are due", 4000);
    await new Promise((r) => setTimeout(r, 700));
    expect(fake.received.filter((f) => f.t === "actor_spawn")).toHaveLength(2);
    const before = await actorsWhoActed();
    expect(before.size).toBeGreaterThan(0);
    expect(before.has("person-3")).toBe(false);
    expect(run.state).toBe("running");
    // she walks in, is admitted, and from then on is part of the pulses
    await waitFor(() => fake?.received.filter((f) => f.t === "actor_spawn").length === 3, "her entrance", 4000);
    const deadline = Date.now() + 8000;
    while (!(await actorsWhoActed()).has("person-3") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect((await actorsWhoActed()).has("person-3")).toBe(true);
    expect(fake.avatarByRef("person-3")).toBeDefined();
  }, 30_000);

  it("honours a fixed entrance time: 'after 1s' spawns about a second after the first", async () => {
    const { body } = compiledScenario();
    const fixed = { ...(body as object), arrivals: { "person-2": 1000, "person-3": 1000 } };
    const booted = await bootSidecar({ versions: { 31: fixed }, timing: { arrivalStaggerMs: [10, 20] } });
    fake = booted.fake;
    sidecar = booted.sidecar;
    fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    const spawns = await watchSpawns(fake, 3);
    const first = spawns.find((s) => s.name === "Duda")?.at ?? 0;
    const rafa = spawns.find((s) => s.name === "Rafa")?.at ?? 0;
    const gabi = spawns.find((s) => s.name === "Gabi")?.at ?? 0;
    expect(rafa - first).toBeGreaterThanOrEqual(900);
    expect(rafa - first).toBeLessThan(3000);
    expect(gabi - first).toBeGreaterThanOrEqual(900);
  }, 30_000);

  it("a stop before the late ones arrive cancels their entrance", async () => {
    const { body } = compiledScenario();
    const fixed = { ...(body as object), arrivals: { "person-2": 5000, "person-3": 6000 } };
    const booted = await bootSidecar({ versions: { 31: fixed } });
    fake = booted.fake;
    sidecar = booted.sidecar;
    fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    await waitFor(() => fake?.received.some((f) => f.t === "actor_spawn"), "the first spawn");
    fake.pmCommand(7, 12, "stop");
    await waitFor(() => fake?.received.find((f) => f.t === "run_end"), "run_end", 6000);
    await new Promise((r) => setTimeout(r, 300));
    expect(fake.received.filter((f) => f.t === "actor_spawn")).toHaveLength(1);
    expect(booted.sidecar.manager?.runCount).toBe(0);
  }, 30_000);
});
