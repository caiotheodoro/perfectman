/**
 * The slim KB's runtime feed inside a run: with `PERFECTMAN_KB_SLIM` pointing at a slim file, an authored beat's actor sees style lines in its view
 * while the beat is near, and nobody else does; without the file nothing changes. The lines live in memory for the run: not in the body, not in the
 * frame log. (The pure parts, the window and the budget, are tested in shared; the prompt text in server.)
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BEAT_CRAFT_MAX_CHARS, slimFixture } from "@perfectman/shared";
import { KB_SLIM_ENV } from "@perfectman/server/hotel";
import type { ScenarioBeat } from "../authoring/scenario-beats.js";
import type { ScenarioBody } from "../run/scenario-body.js";
import type { Sidecar } from "../sidecar.js";
import { HotelSpaceMirror } from "../space/space-mirror.js";
import { avatar, snapshot } from "../testing/fixtures.js";
import { FakeDirector } from "../testing/fake-director.js";
import { TEST_SECRET, bootSidecar, compiledScenario, waitFor } from "../testing/helpers.js";

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "beat-craft-"));
});
afterEach(async () => {
  delete process.env[KB_SLIM_ENV];
  rmSync(dir, { recursive: true, force: true });
  await sidecar?.close();
  await fake?.stop();
  sidecar = fake = undefined;
});

const insult: ScenarioBeat = { id: "b1", at_ms: 1200, kind: "act", actor: "person-1", verb: "insult", with: "person-2", authored_skip: true };
const STYLE = /^(Style reference|Referência de estilo)/;

async function boot(slim?: string) {
  if (slim !== undefined) process.env[KB_SLIM_ENV] = slim;
  fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4, autoAct: true, drama: {} });
  fake.addRoom(12);
  fake.addHuman(12, 9, "ana", 6, 5);
  fake.optIn.set(12, [9]);
  const body: ScenarioBody = { ...(compiledScenario().body as ScenarioBody), drama: { max_rung: 2, may_target: [], may_die: [], permadeath: false }, beats: [insult] };
  const booted = await bootSidecar({ fake, versions: { 31: body } });
  sidecar = booted.sidecar;
  booted.fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
  await waitFor(() => booted.fake.received.find((f) => f.t === "run_ack" && f.ok), "run_ack");
  await waitFor(() => booted.fake.received.filter((f) => f.t === "actor_spawn").length === 3, "three spawns");
  const run = await waitFor(() => booted.sidecar.manager!.getRun(7), "the run");
  await waitFor(() => run.state === "running", "a running run");
  const space = (run as unknown as { space: { view(ref: string, now: number): { craft?: string; drama?: true } | undefined } }).space;
  return { run, space };
}

describe("a scoped view with a craft source", () => {
  it("carries `craft` only while the source says so, and leaves no key behind otherwise", () => {
    const m = new HotelSpaceMirror();
    m.applySnapshot(snapshot(12, 1, [avatar(9, "ana", 6, 5), avatar(-701, "Duda", 1, 4)]), 5_000_000);
    const scoped = m.scoped(7);
    scoped.registerActor({ ref: "duda", id: -701, run: 7, name: "Duda" }, "12", 5_000_000);
    expect("craft" in scoped.view("duda", 5_000_000)!).toBe(false);
    scoped.setCraft((agent, now) => (agent === "duda" && now >= 5_000_100 ? "lines" : undefined));
    expect("craft" in scoped.view("duda", 5_000_000)!).toBe(false);
    expect(scoped.view("duda", 5_000_100)?.craft).toBe("lines");
    scoped.setCraft(undefined);
    expect("craft" in scoped.view("duda", 5_000_100)!).toBe(false);
  });
});

describe("the KB's runtime feed in a run", () => {
  it("shows the beat's actor style lines while the beat is near, and nobody else, and keeps them out of the body and the frame log", async () => {
    const file = path.join(dir, "kb-slim.json");
    writeFileSync(file, JSON.stringify(slimFixture()));
    const { run, space } = await boot(file);
    const mine = await waitFor(() => space.view("person-1", Date.now())?.craft, "the actor's style lines");
    expect(mine).toMatch(STYLE);
    expect(mine.length).toBeLessThanOrEqual(BEAT_CRAFT_MAX_CHARS);
    expect("craft" in space.view("person-2", Date.now())!).toBe(false);
    // Long after the beat, and the lines are gone.
    expect("craft" in space.view("person-1", Date.now() + 60_000)!).toBe(false);
    const quip = mine.split("\n")[1]!.slice(2).split(" (")[0]!.split(" / ")[0]!;
    expect(JSON.stringify(run.frameLog.frames)).not.toContain(quip);
    expect(JSON.stringify(run.frameLog.frames)).not.toContain("Style reference");
    expect(JSON.stringify(compiledScenario().body)).not.toContain(quip);
  });

  it("changes nothing when there is no file: not set, missing, or not a slim file", async () => {
    for (const slim of [undefined, path.join(dir, "missing.json")]) {
      const { space } = await boot(slim);
      expect("craft" in space.view("person-1", Date.now())!).toBe(false);
      await sidecar?.close();
      await fake?.stop();
      sidecar = fake = undefined;
      delete process.env[KB_SLIM_ENV];
    }
    const junk = path.join(dir, "junk.json");
    writeFileSync(junk, JSON.stringify({ format: "other" }));
    const { space } = await boot(junk);
    expect("craft" in space.view("person-1", Date.now())!).toBe(false);
  });
});
