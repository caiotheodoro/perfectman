/**
 * The human layer inside a real run against the fake hotel (cinematic revamp B5): the dial is read from the environment, the run builds the layer, logs what it decided to
 * `body-log.jsonl` (registered as `body_log`), and writes nothing at 0.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CineConfig } from "../director/cine/types.js";
import type { Sidecar } from "../sidecar.js";
import { FakeDirector } from "../testing/fake-director.js";
import { TEST_SECRET, bootSidecar, waitFor } from "../testing/helpers.js";

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  await sidecar?.close();
  await fake?.stop();
  sidecar = fake = undefined;
});

/** Playback scaled down so a real-time film fits a test (the same as cinematic-run.test.ts). */
const FAST_CINE: Partial<CineConfig> = {
  readingScale: 0.02, introMs: 300, sceneCardMs: 200, fillerAfterMs: 250, fillerMs: 150, minShotMs: 40,
  easeMs: { establishing: 20, two_shot: 20, close_up: 10, tracking: 20, reaction: 10 },
  beatGapMs: 20, cueLeadMs: 10, typingLeadMs: 20, narratorWaitMs: 50, drainMs: 500, pulseMs: 150,
};

async function runAndStop(cinematic = false): Promise<{ dir: string; files: Record<string, string> }> {
  fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4 });
  fake.addRoom(12);
  fake.addHuman(12, 9, "ana", 6, 5);
  const booted = await bootSidecar({ fake, ...(cinematic ? { timing: { cine: FAST_CINE } } : {}) });
  sidecar = booted.sidecar;
  booted.fake.startRun({ run: 7, room: 12, scenarioVersion: 31, ...(cinematic ? { mode: "cinematic" as const } : {}) });
  await waitFor(() => booted.fake.received.filter((f) => f.t === "actor_spawn").length === 3, "three spawns");
  const run = await waitFor(() => booted.sidecar.manager?.getRun(7), "the run");
  await waitFor(() => run.state === "running", "a running run");
  await waitFor(() => booted.fake.chats.length >= 3, "a few lines", 8000);
  booted.fake.pmCommand(7, 12, "stop");
  await waitFor(() => booted.fake.received.find((f) => f.t === "run_end"), "run_end", 6000);
  const dir = join(booted.cfg.dataDir, "runs", "7");
  const manifest = JSON.parse(readFileSync(join(dir, "replay.json"), "utf8")) as { files: Record<string, string> };
  return { dir, files: manifest.files };
}

describe("the human layer in a run", () => {
  it("at 0.6 it logs its decisions to body-log.jsonl and registers the file", async () => {
    vi.stubEnv("PERFECTMAN_HUMAN_LIKENESS", "0.6");
    const { dir, files } = await runAndStop();
    expect(files["body_log"]).toBe("body-log.jsonl");
    const lines = readFileSync(join(dir, "body-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { t_ms: number; actor: string; kind: string; rule: string });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => typeof l.t_ms === "number" && l.actor.startsWith("person-") && l.rule.length > 0)).toBe(true);
    expect(lines.some((l) => l.kind === "latency" || l.kind === "typing")).toBe(true);
  }, 30_000);

  it("in a film it reacts when the line plays: the people in the room turn, and the log says why", async () => {
    vi.stubEnv("PERFECTMAN_HUMAN_LIKENESS", "1");
    const { dir } = await runAndStop(true);
    const rules = readFileSync(join(dir, "body-log.jsonl"), "utf8").trim().split("\n").map((l) => (JSON.parse(l) as { rule: string }).rule);
    expect(rules.some((r) => /^(face:|avert:|glance:|backchannel:|emphasis:|hold:)/.test(r))).toBe(true);
  }, 30_000);

  it("at 0 it writes no body log and leaves the run as it was", async () => {
    vi.stubEnv("PERFECTMAN_HUMAN_LIKENESS", "0");
    const { dir, files } = await runAndStop();
    expect(files["body_log"]).toBeUndefined();
    expect(existsSync(join(dir, "body-log.jsonl"))).toBe(false);
  }, 30_000);
});
