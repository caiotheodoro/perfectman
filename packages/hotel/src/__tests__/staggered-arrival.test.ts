import { afterEach, describe, expect, it } from "vitest";
import { parseStart } from "../authoring/scenario-form.js";
import { arrivalSchedule } from "../run/run.js";
import { parseScenarioBody } from "../run/scenario-body.js";
import type { Sidecar } from "../sidecar.js";
import type { FakeDirector } from "../testing/fake-director.js";
import { bootSidecar, compiledScenario, waitFor } from "../testing/helpers.js";
import { ManualClock } from "../testing/manual-clock.js";

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;
let manual: ManualClock | undefined;

afterEach(async () => {
  // A run that is shut down walks its cast out on the clock, so a manual one has to keep moving until the close is done.
  let closing = true;
  const pump = (async () => {
    while (closing && manual) {
      await manual.advance(100);
      await new Promise((r) => setTimeout(r, 5));
    }
  })();
  await sidecar?.close();
  closing = false;
  await pump;
  await fake?.stop();
  sidecar = fake = manual = undefined;
});

/** How many times each actor_spawn frame reached the hotel, by name. */
function spawnCounts(hotel: FakeDirector): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of hotel.received) if (f.t === "actor_spawn") out[f.name] = (out[f.name] ?? 0) + 1;
  return out;
}

/** Names in the order their actor_spawn frames reached the hotel. */
const spawned = (hotel: FakeDirector): string[] => hotel.received.flatMap((f) => (f.t === "actor_spawn" ? [f.name] : []));


/**
 * The sidecar on a manual clock: every entrance timer, spawn pause and pulse waits for `clock.advance`, so the gaps
 * between entrances are the schedule's own numbers and no load on the machine can stretch or squeeze them. Only the
 * socket to the fake hotel is real, and `waitFor` polls it with real time while the clock stands still.
 */
async function bootOnManualClock(over: Parameters<typeof bootSidecar>[0] = {}) {
  const clock = (manual = new ManualClock());
  const booted = await bootSidecar({ ...over, clock, timing: { spawnIntervalMs: 0, ...over.timing } });
  fake = booted.fake;
  sidecar = booted.sidecar;
  fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
  const run = await waitFor(() => booted.sidecar.manager?.getRun(7), "the run");
  // The first cast member spawns at once. Her spawn pause is a zero-length timer set only after the hotel's answer reaches the
  // sidecar, so keep asking the clock for what is due now (it never moves) until the run turns "running": in that same step the
  // entrance timers are set, so from here the clock reads the run's own zero and every time below is relative to it.
  await waitFor(() => spawned(booted.fake).length >= 1, "the first spawn");
  const t0 = Date.now();
  while (run.state !== "running") {
    if (Date.now() - t0 > 8000) throw new Error("timed out waiting for the run to be running");
    await clock.advance(0);
    await new Promise((r) => setTimeout(r, 1));
  }
  return { ...booted, clock, run };
}

/** Moves the manual clock on in small steps while the real sockets and the mock model get their turn, until `fn` is truthy. */
async function pumpUntil<T>(clock: ManualClock, fn: () => T | undefined | false | Promise<T | undefined | false>, what: string, budgetClockMs = 20_000, stepMs = 25): Promise<T> {
  for (let spent = 0; spent <= budgetClockMs; spent += stepMs) {
    const v = await fn();
    if (v) return v;
    await clock.advance(stepMs);
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`${what}: not within ${budgetClockMs} ms of manual-clock time`);
}

const scheduleOf = (agents: Array<{ id: string; arrivalPulse?: number | null }>, arrivals: Record<string, number> | undefined, rng: () => number) =>
  arrivalSchedule(agents, arrivals, [1000, 3000], rng);

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

  // The stagger is [150, 250] ms; the rng picks the gap inside it, so its two ends give the two exact gaps.
  it.each([
    { rng: 0, gapMs: 150 },
    { rng: 0.999999, gapMs: 250 },
  ])("with no entrance times the cast walks in one after another, $gapMs ms apart, not all at once", async ({ rng, gapMs }) => {
    const { fake: hotel, clock } = await bootOnManualClock({ rng: () => rng, timing: { arrivalStaggerMs: [150, 250] } });
    // Only the first is here when the run starts running; nobody else is early.
    expect(spawned(hotel)).toEqual(["Duda"]);
    await clock.advance(gapMs - 1);
    expect(spawned(hotel)).toEqual(["Duda"]);
    await clock.advance(1);
    await waitFor(() => spawned(hotel).length >= 2, "the second to walk in");
    expect(spawned(hotel)).toEqual(["Duda", "Rafa"]);
    // The third is a full gap after the second.
    await clock.advance(gapMs - 1);
    expect(spawned(hotel)).toEqual(["Duda", "Rafa"]);
    await clock.advance(1);
    await pumpUntil(clock, () => spawned(hotel).length >= 3, "the third to walk in", 500, 1);
    expect(spawned(hotel)).toEqual(["Duda", "Rafa", "Gabi"]);
    expect(spawnCounts(hotel)).toEqual({ Duda: 1, Rafa: 1, Gabi: 1 });
    await pumpUntil(clock, () => new Set(hotel.chats.map((x) => x.actor)).size >= 2, "two different speakers");
  }, 30_000);

  it("an actor who has not arrived is not consulted: nothing is decided for her until she walks in", async () => {
    const { body } = compiledScenario();
    const ENTRANCE_MS = 30_000;
    const late = { ...(body as object), arrivals: { "person-3": ENTRANCE_MS } };
    const { fake: hotel, clock, run } = await bootOnManualClock({ versions: { 31: late }, timing: { arrivalStaggerMs: [10, 20] }, rng: () => 0 });
    const entranceAt = clock.now() + ENTRANCE_MS;
    const handle = await waitFor(() => run.simulation, "the simulation");
    const actorsWhoActed = async (): Promise<Set<string>> => {
      const events = await handle.repositories.eventRepo.getAfter(handle.simulationId);
      return new Set(events.filter((e) => e.type === "message_sent" || e.type === "no_op_recorded").map((e) => e.actorId));
    };
    // The two who are due come in, and the scene plays on without her, for as much of the clock as it takes someone to act.
    let before = new Set<string>();
    await pumpUntil(clock, async () => spawned(hotel).length >= 2 && (before = await actorsWhoActed()).size > 0, "the two who are due to come in and act");
    expect(clock.now()).toBeLessThan(entranceAt);
    expect(spawned(hotel)).toEqual(["Duda", "Rafa"]);
    expect(before.has("person-3")).toBe(false);
    expect(run.state).toBe("running");
    // Right up to the instant before her entrance she is still outside and never decided for.
    await clock.advance(entranceAt - clock.now() - 1);
    expect(spawned(hotel)).toEqual(["Duda", "Rafa"]);
    expect((await actorsWhoActed()).has("person-3")).toBe(false);
    await clock.advance(1);
    await pumpUntil(clock, () => spawned(hotel).length === 3, "her entrance", 500, 1);
    await pumpUntil(clock, async () => (await actorsWhoActed()).has("person-3"), "her first decision");
    expect(hotel.avatarByRef("person-3")?.name).toBe("Gabi");
  }, 30_000);

  it("honours a fixed entrance time: 'after 1s' spawns exactly a second after the first", async () => {
    const { body } = compiledScenario();
    const fixed = { ...(body as object), arrivals: { "person-2": 1000, "person-3": 1000 } };
    const { fake: hotel, clock } = await bootOnManualClock({ versions: { 31: fixed }, timing: { arrivalStaggerMs: [10, 20] } });
    expect(spawned(hotel)).toEqual(["Duda"]);
    await clock.advance(999);
    expect(spawned(hotel)).toEqual(["Duda"]);
    await clock.advance(1);
    await waitFor(() => spawned(hotel).length >= 2, "the second entrance");
    expect(spawned(hotel)[1]).toBe("Rafa");
    // Her timer is due at the same instant; she spawns once the second's own spawn is done.
    await pumpUntil(clock, () => spawned(hotel).length >= 3, "the third entrance", 500, 1);
    expect(spawned(hotel)).toEqual(["Duda", "Rafa", "Gabi"]);
  }, 30_000);

  it("a stop before the late ones arrive cancels their entrance", async () => {
    const { body } = compiledScenario();
    const fixed = { ...(body as object), arrivals: { "person-2": 5000, "person-3": 6000 } };
    const { fake: hotel, clock, sidecar: side } = await bootOnManualClock({ versions: { 31: fixed } });
    expect(spawned(hotel)).toEqual(["Duda"]);
    hotel.pmCommand(7, 12, "stop");
    await pumpUntil(clock, () => hotel.received.find((f) => f.t === "run_end"), "run_end", 4000);
    // Their turns come and go with nobody left to walk in.
    await clock.advance(20_000);
    expect(spawned(hotel)).toEqual(["Duda"]);
    expect(side.manager?.runCount).toBe(0);
  }, 30_000);
});
