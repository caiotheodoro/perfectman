/**
 * The end-to-end anchor: markdown in, a real simulation run, artifacts out.
 *
 * Uses the mock provider, so it talks to nothing and finishes in milliseconds
 * while still exercising the whole path — compile, assemble, build, seed, pulse
 * loop, gateway fan-out, teardown, artifact write.
 */
import { readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LiveEvent } from "@perfectman/shared";
import { compileRunInputs } from "../../authoring/compile-run-inputs.js";
import type { LLMConfig } from "../../llm/llm-config.js";
import { RunController } from "../run/run-controller.js";
import type { SseSink } from "../sse-hub.js";
import { readManifest, readReplay } from "../run/run-artifacts.js";

const FIXTURES = join(__dirname, "../../authoring/__tests__/fixtures");

const MOCK_LLM: LLMConfig = {
  providerType: "mock",
  modelName: "mock",
  maxInputTokens: 2048,
  maxOutputTokens: 512,
  temperature: 0.7,
  timeoutMs: 5000,
  retryCount: 1,
};

/** Captures the SSE stream without a socket. */
function recordingSink(): { sink: SseSink; events: LiveEvent[] } {
  const events: LiveEvent[] = [];
  const listeners = new Map<string, () => void>();
  const sink: SseSink = {
    write(chunk) {
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)) as LiveEvent);
      }
      return true;
    },
    end() {},
    on(event, listener) {
      listeners.set(event, listener);
    },
    off(event) {
      listeners.delete(event);
    },
    writableLength: 0,
  };
  return { sink, events };
}

async function readFixtures() {
  const persona = await readFile(join(FIXTURES, "iris.persona.md"), "utf8");
  const scenario = await readFile(join(FIXTURES, "dinner.scenario.md"), "utf8");
  return {
    kind: "markdown" as const,
    personas: [
      { filename: "iris.persona.md", text: persona },
      {
        filename: "bruno.persona.md",
        text: persona
          .replace("personaId: iris", "personaId: bruno")
          .replace("displayName: Íris", "displayName: Bruno"),
      },
    ],
    scenario: { filename: "dinner.scenario.md", text: scenario },
  };
}

describe("RunController — a full mock run", () => {
  const runsRoot = join(tmpdir(), `perfectman-web-test-${Date.now()}`);
  const runId = "run_e2e_1";
  let events: LiveEvent[] = [];
  let controller: RunController;

  beforeAll(async () => {
    const inputs = await readFixtures();
    const compiled = compileRunInputs(inputs, { llm: MOCK_LLM, simulationId: runId });
    if (!compiled.ok || !compiled.config) {
      throw new Error(
        `fixtures failed to compile: ${compiled.diagnostics.filter((d) => d.level === "error").map((d) => d.message).join("; ")}`,
      );
    }

    controller = new RunController(runsRoot);
    const recorder = recordingSink();
    events = recorder.events;
    // Subscribe before starting so the hello frame is captured.
    controller.currentHub().subscribe(recorder.sink);

    await controller.start({
      runId,
      config: compiled.config,
      seeds: compiled.seeds,
      maxPulses: 6,
      wallClockCapMs: 60_000,
      diagnostics: compiled.diagnostics,
      inputFiles: [inputs.scenario, ...inputs.personas],
      skipHealthCheck: true,
    });
    await controller.completion();
  }, 60_000);

  afterAll(async () => {
    await rm(runsRoot, { recursive: true, force: true });
  });

  it("reaches a terminal state without error", () => {
    const status = controller.getStatus();
    expect(status.error).toBeUndefined();
    expect(status.state).toBe("done");
    expect(status.stopReason).toBe("completed");
  });

  it("runs exactly the requested number of pulses", () => {
    expect(controller.getStatus().pulseIndex).toBeGreaterThan(0);
    const pulses = events.filter((e) => e.type === "pulse");
    expect(pulses).toHaveLength(6);
  });

  it("writes a replay containing what the database could not have told us", async () => {
    const replay = await readReplay(runsRoot, runId);
    expect(replay).not.toBeNull();
    expect(replay?.pulses.length).toBe(6);

    // Thinking and per-pulse emotion are operator events with no table behind
    // them; if they survived the round trip, the stream-fed receiver worked.
    const withThinking = replay?.pulses.filter((p) => Object.keys(p.agentThinking).length > 0) ?? [];
    expect(withThinking.length).toBeGreaterThan(0);
    const withStates = replay?.pulses.filter((p) => Object.keys(p.agentStates).length > 0) ?? [];
    expect(withStates.length).toBe(6);
  });

  it("writes the snapshot HTML and a manifest alongside it", async () => {
    expect(existsSync(join(runsRoot, runId, "snapshot.html"))).toBe(true);
    const manifest = await readManifest(runsRoot, runId);
    expect(manifest).toMatchObject({ runId, state: "done", maxPulses: 6 });
    expect(manifest?.dirty).toBeUndefined();
  });

  it("archives the uploaded markdown so the run is reproducible", () => {
    expect(existsSync(join(runsRoot, runId, "inputs", "dinner.scenario.md"))).toBe(true);
    expect(existsSync(join(runsRoot, runId, "inputs", "iris.persona.md"))).toBe(true);
  });

  it("opens the stream with a hello frame describing the cast and channels", () => {
    const hello = events.find((e) => e.type === "hello");
    expect(hello).toBeDefined();
    if (hello?.type !== "hello") throw new Error("unreachable");
    expect(hello.agents.map((a) => a.id).sort()).toEqual(["bruno", "iris", "marcela"]);
    expect(hello.channels.map((c) => c.id)).toEqual(["geral", "iris_marcela"]);
  });

  it("hands seeded history to the viewer, which the gateway never sees", () => {
    const hello = events.find((e) => e.type === "hello");
    if (hello?.type !== "hello") throw new Error("unreachable");
    // Prior events are written straight to the repository, bypassing the
    // projections — without the hello frame carrying them the live view would
    // start blank where the stored replay has history.
    expect(hello.priorEvents).toHaveLength(1);
    expect(hello.priorEvents[0]?.text).toBe("vou pensar e volto");
  });

  it("ends the stream with a stopped frame pointing at the replay", () => {
    const stopped = events.find((e) => e.type === "stopped");
    expect(stopped).toBeDefined();
    if (stopped?.type !== "stopped") throw new Error("unreachable");
    expect(stopped.replayUrl).toBe(`/api/runs/${runId}/replay`);
  });

  it("never wrote a config that could leak a key", async () => {
    const config = await readFile(join(runsRoot, runId, "config.json"), "utf8");
    expect(config).not.toContain("sk-");
    expect(JSON.parse(config).simulation.id).toBe(runId);
  });
});

describe("RunController — stopping", () => {
  const runsRoot = join(tmpdir(), `perfectman-web-stop-${Date.now()}`);

  afterAll(async () => {
    await rm(runsRoot, { recursive: true, force: true });
  });

  it("stops early on request and still writes a usable replay", async () => {
    const inputs = await readFixtures();
    const compiled = compileRunInputs(inputs, { llm: MOCK_LLM, simulationId: "run_stop" });
    const controller = new RunController(runsRoot);

    await controller.start({
      runId: "run_stop",
      config: compiled.config!,
      seeds: compiled.seeds,
      maxPulses: 200,
      wallClockCapMs: 60_000,
      diagnostics: [],
      inputFiles: [],
      skipHealthCheck: true,
    });

    // Let a couple of pulses land, then ask it to stop.
    await new Promise((resolve) => setTimeout(resolve, 40));
    controller.stop();
    await controller.completion();

    const status = controller.getStatus();
    expect(status.state).toBe("done");
    expect(status.stopReason).toBe("stopped");
    expect(status.pulseIndex).toBeLessThan(200);

    const replay = await readReplay(runsRoot, "run_stop");
    expect(replay?.pulses.length).toBeGreaterThan(0);
  }, 60_000);

  it("refuses a second run while one is active", async () => {
    const inputs = await readFixtures();
    const compiled = compileRunInputs(inputs, { llm: MOCK_LLM, simulationId: "run_a" });
    const controller = new RunController(runsRoot);
    const params = {
      config: compiled.config!,
      seeds: compiled.seeds,
      maxPulses: 50,
      wallClockCapMs: 60_000,
      diagnostics: [],
      inputFiles: [],
      skipHealthCheck: true,
    };

    await controller.start({ runId: "run_a", ...params });
    await expect(controller.start({ runId: "run_b", ...params })).rejects.toThrow(/already active/);

    controller.stop();
    await controller.completion();
  }, 60_000);
});
