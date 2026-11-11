/**
 * The authored script inside a real run against the fake hotel (errata P4-01): a body with `beats` has them played on the run's clock through
 * the run's director as scenario-origin acts, only when drama is negotiated.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ScenarioBeat } from "../authoring/scenario-beats.js";
import { DRAMA_OFF, defaultSceneDrama } from "../authoring/scenario-drama.js";
import type { ScenarioBody } from "../run/scenario-body.js";
import type { Sidecar } from "../sidecar.js";
import { FakeDirector } from "../testing/fake-director.js";
import type { FakeDramaOffer } from "../testing/fake-director.js";
import { TEST_SECRET, bootSidecar, compiledScenario, waitFor } from "../testing/helpers.js";

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;
afterEach(async () => {
  await sidecar?.close();
  await fake?.stop();
  sidecar = fake = undefined;
});

const insult: ScenarioBeat = { id: "b1", at_ms: 1200, kind: "act", actor: "person-1", verb: "insult", with: "person-2", authored_skip: true };

async function boot(o: { offer?: FakeDramaOffer; beats: ScenarioBeat[]; body?: Partial<ScenarioBody> }) {
  fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4, autoAct: true, ...(o.offer ? { drama: o.offer } : {}) });
  fake.addRoom(12);
  fake.addHuman(12, 9, "ana", 6, 5);
  fake.optIn.set(12, [9]);
  const body: ScenarioBody = { ...(compiledScenario().body as ScenarioBody), drama: { max_rung: 2, may_target: [], may_die: [], permadeath: false }, beats: o.beats, ...o.body };
  const booted = await bootSidecar({ fake, versions: { 31: body } });
  sidecar = booted.sidecar;
  const hotel = booted.fake;
  hotel.startRun({ run: 7, room: 12, scenarioVersion: 31 });
  await waitFor(() => hotel.received.find((f) => f.t === "run_ack" && f.ok), "run_ack");
  await waitFor(() => hotel.received.filter((f) => f.t === "actor_spawn").length === 3, "three spawns");
  const run = await waitFor(() => booted.sidecar.manager!.getRun(7), "the run");
  await waitFor(() => run.state === "running", "a running run");
  return { hotel, run, cfg: booted.cfg };
}

/** Stops the run the way an admin does and reads the summary the run leaves (`replay.json`). */
async function summary(hotel: FakeDirector, cfg: { dataDir: string }) {
  hotel.pmCommand(7, 12, "stop");
  await waitFor(() => hotel.received.find((f) => f.t === "run_end"), "run_end", 6000);
  return JSON.parse(readFileSync(join(cfg.dataDir, "runs", "7", "replay.json"), "utf8")) as { counters: Record<string, number>; drama?: Record<string, unknown> };
}

/** The acts the script sent: the run's mock model and its director may start acts of their own too, with another origin. */
const acts = (hotel: FakeDirector) => hotel.received.flatMap((f) => (f.t === "actor_cmd" && f.cmd.k === "act" && f.cmd.origin === "scenario" ? [f] : []));

describe("the authored script inside a run", () => {
  it("[SCN-4] plays an authored act as a scenario act with the skip flag, from the director's own port, and records it in the frame log", async () => {
    const { hotel, run } = await boot({ offer: {}, beats: [insult] });
    const sent = await waitFor(() => acts(hotel)[0], "the authored act on the wire");
    expect(sent.cmd).toMatchObject({ k: "act", verb: "insult", origin: "scenario", authored_skip: true });
    const a = (await waitFor(() => hotel.avatarByRef("person-1", 7), "person-1")).id;
    const b = (await waitFor(() => hotel.avatarByRef("person-2", 7), "person-2")).id;
    expect(sent.actor).toBe(a);
    expect(sent.cmd).toMatchObject({ with: b });
    expect(run.frameLog.frames.some((f) => f.kind === "actor_cmd" && f.dir === "out" && (f.data["cmd"] as { origin?: string }).origin === "scenario")).toBe(true);
  });

  it("[NEG-5] plays nothing on a dialect 1 link (a hotel that does not offer drama)", async () => {
    const v1 = await boot({ beats: [insult] });
    await new Promise((r) => setTimeout(r, 1800));
    expect(acts(v1.hotel)).toHaveLength(0);
  });

  it("a script with a beat for someone who is not in the room drops that beat and plays the rest", async () => {
    const stranger: ScenarioBeat = { id: "b0", at_ms: 300, kind: "act", actor: "person-9", verb: "insult", with: "person-2" };
    const { hotel } = await boot({ offer: {}, beats: [stranger, insult] });
    await waitFor(() => acts(hotel).length >= 1, "the authored act on the wire");
    expect(acts(hotel)).toHaveLength(1);
    expect(acts(hotel)[0]?.cmd).toMatchObject({ verb: "insult", origin: "scenario" });
  });

  it("the run summary says where the drama block came from and what the script did: played, dropped and why", async () => {
    // The default block lets nobody die, so an authored kill is refused before the director is asked.
    const kill: ScenarioBeat = { id: "b0", at_ms: 300, kind: "act", actor: "person-1", verb: "kill", with: "person-2", authored_skip: true };
    const drama = defaultSceneDrama(["person-1", "person-2", "person-3"])!;
    const { hotel, cfg } = await boot({ offer: {}, beats: [kill, insult], body: { drama, drama_mode: "default" } });
    await waitFor(() => acts(hotel).length >= 1, "the authored act on the wire");
    expect(acts(hotel)).toHaveLength(1);
    const done = await summary(hotel, cfg);
    expect(done.drama).toEqual({ source: "default", max_rung: 4, may_target_pairs: 6, may_die: 0, permadeath: false });
    expect(done.counters).toMatchObject({ beats_played: 1, beats_dropped: 1, beats_dropped_may_die: 1 });
  });

  it("a block the author wrote is told apart from the default, and a body saved before the default says free_play", async () => {
    const authored = await boot({ offer: {}, beats: [insult] });
    expect((await summary(authored.hotel, authored.cfg)).drama).toMatchObject({ source: "authored", max_rung: 2, may_target_pairs: 0 });
    await sidecar?.close();
    await fake?.stop();
    const { drama: _d, ...legacy } = compiledScenario().body as ScenarioBody;
    const free = await boot({ offer: {}, beats: [], body: { ...legacy, drama: undefined } as never });
    expect((await summary(free.hotel, free.cfg)).drama).toMatchObject({ source: "free_play", max_rung: 3 });
  });

  it("[off] drama: off in a real run starts no act of any kind, and an authored beat of it is dropped as inert", async () => {
    const { hotel, cfg } = await boot({ offer: {}, beats: [insult], body: { drama: DRAMA_OFF, drama_mode: "off" } });
    await new Promise((r) => setTimeout(r, 2500));
    expect(hotel.received.filter((f) => f.t === "actor_cmd" && f.cmd.k === "act")).toEqual([]);
    const done = await summary(hotel, cfg);
    expect(done.drama).toEqual({ source: "off", max_rung: 0, may_target_pairs: 0, may_die: 0, permadeath: false, humans_targetable: false });
    expect(done.counters).toMatchObject({ beats_played: 0, beats_dropped: 1, beats_dropped_inert: 1 });
  }, 20_000);
});
