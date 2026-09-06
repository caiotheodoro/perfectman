/**
 * The HTTP surface, driven the way the browser drives it: real sockets, real
 * SSE, mock provider so it finishes in milliseconds.
 */
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LiveEvent } from "@perfectman/shared";
import { createWebServer } from "../server.js";

const FIXTURES = join(__dirname, "../../authoring/__tests__/fixtures");

async function markdownInputs() {
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

/** Reads an SSE stream to completion, returning the parsed events. */
async function readSse(url: string, until: (events: LiveEvent[]) => boolean): Promise<LiveEvent[]> {
  const response = await fetch(url);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("no stream body");
  const decoder = new TextDecoder();
  const events: LiveEvent[] = [];
  let buffer = "";

  while (!until(events)) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)) as LiveEvent);
      }
    }
  }
  await reader.cancel().catch(() => undefined);
  return events;
}

describe("web server", () => {
  const runsRoot = join(tmpdir(), `perfectman-http-${Date.now()}`);
  let base: string;
  let web: ReturnType<typeof createWebServer>;

  beforeAll(async () => {
    web = createWebServer({ runsRoot });
    const port = await web.listen(0);
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await web.close();
    await rm(runsRoot, { recursive: true, force: true });
  });

  it("answers a health check", async () => {
    const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("compiles markdown without starting anything", async () => {
    const response = await fetch(`${base}/api/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs: await markdownInputs() }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.ok).toBe(true);
    expect(body.summary.agents.map((a: { id: string }) => a.id).sort()).toEqual([
      "bruno",
      "iris",
      "marcela",
    ]);
    expect(body.summary.channels).toHaveLength(2);
    // The preview shows the detected language with its provenance.
    expect(body.summary.languages["iris.persona.md"]).toMatchObject({ language: "pt-BR" });
    // Nothing was started.
    const status = await (await fetch(`${base}/api/runs/current`)).json();
    expect(status.state).toBe("idle");
  });

  it("reports compile errors as diagnostics, not a crash", async () => {
    const response = await fetch(`${base}/api/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        inputs: {
          kind: "markdown",
          personas: [],
          scenario: { filename: "broken.md", text: "---\nname: x\n---\n" },
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.diagnostics.some((d: { level: string }) => d.level === "error")).toBe(true);
  });

  it("runs a simulation end to end and streams it", async () => {
    const start = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        inputs: await markdownInputs(),
        llm: { providerType: "mock", modelName: "mock" },
        limits: { maxPulses: 5 },
      }),
    });
    expect(start.status).toBe(201);
    const { runId, streamUrl } = await start.json();
    expect(runId).toMatch(/^run_/);

    const events = await readSse(`${base}${streamUrl}`, (e) => e.some((x) => x.type === "stopped"));

    const hello = events.find((e) => e.type === "hello");
    expect(hello).toBeDefined();
    expect(events.filter((e) => e.type === "pulse").length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "stopped")).toBe(true);

    // The replay the stopped frame points at actually resolves.
    const replay = await (await fetch(`${base}/api/runs/${runId}/replay`)).json();
    expect(replay.pulses).toHaveLength(5);
    expect(replay.agentIds.sort()).toEqual(["bruno", "iris", "marcela"]);

    const runs = await (await fetch(`${base}/api/runs`)).json();
    expect(runs.runs.some((r: { runId: string }) => r.runId === runId)).toBe(true);
  }, 60_000);

  it("refuses a second run while one is active, with the current status", async () => {
    const body = JSON.stringify({
      inputs: await markdownInputs(),
      llm: { providerType: "mock", modelName: "mock" },
      limits: { maxPulses: 100 },
    });
    const first = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(first.status).toBe(201);
    const { runId } = await first.json();

    const second = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(second.status).toBe(409);
    expect((await second.json()).error.message).toMatch(/already active/);

    const stop = await fetch(`${base}/api/runs/${runId}/stop`, { method: "POST" });
    expect(stop.status).toBe(202);
    await web.controller.completion();
  }, 60_000);

  it("404s an unknown run's replay rather than returning empty JSON", async () => {
    const response = await fetch(`${base}/api/runs/nope/replay`);
    expect(response.status).toBe(404);
  });

  it("422s inputs that do not compile, without starting a run", async () => {
    const response = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        inputs: { kind: "markdown", personas: [], scenario: { filename: "b.md", text: "---\n---\n" } },
        llm: { providerType: "mock" },
      }),
    });
    expect(response.status).toBe(422);
    expect(web.controller.getStatus().state).not.toBe("running");
  });

  it("404s an unknown API endpoint", async () => {
    const response = await fetch(`${base}/api/nonsense`);
    expect(response.status).toBe(404);
  });
});
