/**
 * The slim KB's runtime feed inside a run: with `PERFECTMAN_KB_CRAFT=1` (off by default, independent of the draft prompt) and `PERFECTMAN_KB_SLIM`
 * pointing at a slim file, an authored beat's actor sees style lines, in the scene's own language, in its view while the beat is near, and nobody
 * else does; with the flag off, without the file, or without a line in the scene's language, nothing changes. The lines live in memory for the run: not in the body, not in the
 * frame log. (The pure parts, the window and the budget, are tested in shared; the prompt text in server.)
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BEAT_CRAFT_MAX_CHARS, slimFixture } from "@perfectman/shared";
import { KB_CRAFT_ENV, KB_SLIM_ENV } from "@perfectman/server/hotel";
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
  delete process.env[KB_CRAFT_ENV];
  rmSync(dir, { recursive: true, force: true });
  await sidecar?.close();
  await fake?.stop();
  sidecar = fake = undefined;
});

const insult: ScenarioBeat = { id: "b1", at_ms: 1200, kind: "act", actor: "person-1", verb: "insult", with: "person-2", authored_skip: true };

/** The scenario is pt-BR (the helper's default). `slim` is the file, `craft` the value of the flag; either may be absent. */
async function boot(slim?: string, craft?: string) {
  if (slim !== undefined) process.env[KB_SLIM_ENV] = slim;
  if (craft !== undefined) process.env[KB_CRAFT_ENV] = craft;
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
  // The run's own window on the shared mirror: private, read here the way the pulse scheduler reads it.
  const space: { view(ref: string, now: number): { craft?: string; drama?: true } | undefined } = Reflect.get(run, "space");
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

async function stop(): Promise<void> {
  await sidecar?.close();
  await fake?.stop();
  sidecar = fake = undefined;
  delete process.env[KB_SLIM_ENV];
  delete process.env[KB_CRAFT_ENV];
}

describe("the KB's runtime feed in a run", () => {
  it("with the flag on, shows the beat's actor style lines in the scene's language while the beat is near, and nobody else, and keeps them out of the body and the frame log", async () => {
    const file = path.join(dir, "kb-slim.json");
    writeFileSync(file, JSON.stringify(slimFixture()));
    const { run, space } = await boot(file, "1");
    const mine = await waitFor(() => space.view("person-1", Date.now())?.craft, "the actor's style lines");
    expect(mine).toMatch(/^Referência de estilo/);
    expect(mine).toContain("CC BY-SA");
    expect(mine).not.toContain("public domain");
    expect(mine.length).toBeLessThanOrEqual(BEAT_CRAFT_MAX_CHARS);
    expect("craft" in space.view("person-2", Date.now())!).toBe(false);
    // Long after the beat, and the lines are gone.
    expect("craft" in space.view("person-1", Date.now() + 60_000)!).toBe(false);
    const quip = mine.split("\n")[1]!.slice(2).split(" (")[0]!.split(" / ")[0]!;
    expect(JSON.stringify(run.frameLog.frames)).not.toContain(quip);
    expect(JSON.stringify(run.frameLog.frames)).not.toContain("Referência de estilo");
    expect(JSON.stringify(compiledScenario().body)).not.toContain(quip);
  });

  it("with the flag off, which is its default and anything but exactly 1, changes nothing even though the slim file is loaded", async () => {
    const file = path.join(dir, "kb-slim.json");
    writeFileSync(file, JSON.stringify(slimFixture()));
    for (const craft of [undefined, "0", "", "true", "yes"]) {
      const { space } = await boot(file, craft);
      expect("craft" in space.view("person-1", Date.now())!).toBe(false);
      await stop();
    }
  });

  it("changes nothing when the flag is on but there is no usable file: not set, missing, or not a slim file", async () => {
    for (const slim of [undefined, path.join(dir, "missing.json")]) {
      const { space } = await boot(slim, "1");
      expect("craft" in space.view("person-1", Date.now())!).toBe(false);
      await stop();
    }
    const junk = path.join(dir, "junk.json");
    writeFileSync(junk, JSON.stringify({ format: "other" }));
    const { space } = await boot(junk, "1");
    expect("craft" in space.view("person-1", Date.now())!).toBe(false);
  });

  it("injects nothing when the KB has no line in the scene's language, rather than a line in another", async () => {
    const english = { ...slimFixture(), beats: slimFixture().beats.filter((b) => b.language === "en") };
    const file = path.join(dir, "kb-en-only.json");
    writeFileSync(file, JSON.stringify(english));
    const { space } = await boot(file, "1");
    expect("craft" in space.view("person-1", Date.now())!).toBe(false);
  });
});
