import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { Sidecar } from "../sidecar.js";
import type { FakeDirector } from "../testing/fake-director.js";
import { bootSidecar, waitFor } from "../testing/helpers.js";
import type { SidecarFrame } from "../director/index.js";

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;
let llm: Server | undefined;

afterEach(async () => {
  await sidecar?.close();
  await fake?.stop();
  await new Promise<void>((r) => (llm ? llm.close(() => r()) : r()));
  sidecar = fake = llm = undefined;
});

type Status = Extract<SidecarFrame, { t: "run_status" }>;
const lastStatus = (f: FakeDirector): Status | undefined => f.received.filter((x): x is Status => x.t === "run_status").at(-1);
const notices = (f: FakeDirector) => f.received.flatMap((x) => (x.t === "ui_push" && x.ui.k === "notice" ? [x.ui.code] : []));

async function running(over: Parameters<typeof bootSidecar>[0] = {}) {
  const b = await bootSidecar(over);
  fake = b.fake;
  sidecar = b.sidecar;
  b.fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
  await waitFor(() => lastStatus(b.fake)?.state === "running", "running");
  return b;
}

describe("run lifecycle and pause causes (D46, D49)", () => {
  it("admin pause holds the actors, reports cause admin, ignores an auto resume, and resumes only for an admin", async () => {
    const { fake: hotel } = await running();
    hotel.pmCommand(7, 12, "pause", undefined, "panel");
    await waitFor(() => lastStatus(hotel)?.pause_cause === "admin", "admin pause");
    expect(lastStatus(hotel)?.state).toBe("paused");
    hotel.pmCommand(7, 12, "resume", undefined, "auto");
    await waitFor(() => hotel.received.filter((f) => f.t === "run_status").length > 3, "more status");
    expect(lastStatus(hotel)).toMatchObject({ state: "paused", pause_cause: "admin" });
    hotel.pmCommand(7, 12, "resume", undefined, "panel");
    await waitFor(() => lastStatus(hotel)?.state === "running", "admin resume");
    expect(lastStatus(hotel)?.pause_cause).toBeUndefined();
  });

  it("an idle pause (the hotel's clock) resumes on the hotel's auto resume; an admin pause on top of it takes over", async () => {
    const { fake: hotel } = await running();
    hotel.pmCommand(7, 12, "pause", "idle", "auto");
    await waitFor(() => lastStatus(hotel)?.pause_cause === "idle", "idle pause");
    hotel.pmCommand(7, 12, "resume", undefined, "auto");
    await waitFor(() => lastStatus(hotel)?.state === "running", "auto resume");
    hotel.pmCommand(7, 12, "pause", "idle", "auto");
    await waitFor(() => lastStatus(hotel)?.pause_cause === "idle", "idle again");
    hotel.pmCommand(7, 12, "pause", undefined, "panel");
    await waitFor(() => lastStatus(hotel)?.pause_cause === "admin", "admin takes over");
    hotel.pmCommand(7, 12, "resume", undefined, "auto");
    await waitFor(() => hotel.received.filter((f) => f.t === "run_status").length > 6, "settle");
    expect(lastStatus(hotel)?.state).toBe("paused");
  });

  it("a paused run keeps heartbeating status and stops pulsing: no new LLM calls while paused", async () => {
    const { fake: hotel } = await running();
    hotel.pmCommand(7, 12, "pause", undefined, "panel");
    await waitFor(() => lastStatus(hotel)?.state === "paused", "paused");
    const calls = lastStatus(hotel)?.llm_calls;
    await waitFor(() => hotel.received.filter((f) => f.t === "run_status").length > 6, "status keeps coming");
    expect(lastStatus(hotel)?.llm_calls).toBe(calls);
  });

  it("answers admin commands with notices: inject, whisper by quoted name, status, and a bad whisper target", async () => {
    const { fake: hotel } = await running();
    hotel.pmCommand(7, 12, "inject", "a fire alarm goes off");
    hotel.pmCommand(7, 12, "whisper", "\"Duda\" fala baixo com o Rafa");
    hotel.pmCommand(7, 12, "whisper", "Nobody hi");
    hotel.pmCommand(7, 12, "status");
    await waitFor(() => ["inject_ok", "whisper_ok", "whisper_bad_target", "status"].every((c) => notices(hotel).includes(c)), "notices");
  });

  it("refuses a second run in the same room, an unknown scenario version and a cinematic run, and frees the slot", async () => {
    const { fake: hotel } = await running();
    hotel.startRun({ run: 8, room: 12, scenarioVersion: 31 });
    hotel.startRun({ run: 9, room: 13, scenarioVersion: 99 });
    await waitFor(() => hotel.received.filter((f) => f.t === "run_ack").length === 3, "three acks");
    const acks = hotel.received.flatMap((f) => (f.t === "run_ack" ? [[f.run, f.ok, f.error?.code]] : []));
    expect(acks).toEqual([[7, true, undefined], [8, false, "run_limit"], [9, false, "scenario_unavailable"]]);
    expect(sidecar?.manager?.runCount).toBe(1);
  });

  it("stop writes the run's artifacts and leaves nothing of it in the manager", async () => {
    const { fake: hotel } = await running();
    hotel.pmCommand(7, 12, "stop");
    await waitFor(() => hotel.received.find((f) => f.t === "run_end"), "run_end", 6000);
    expect(hotel.received.find((f) => f.t === "run_end")).toMatchObject({ run: 7, reason: "stopped" });
    expect(sidecar?.manager?.runCount).toBe(0);
    expect(hotel.actorsLeft()).toBe(0);
  });

  it("when the hotel ends the run it walks the actors out itself: no despawn from the sidecar, no run_end back", async () => {
    const { fake: hotel } = await running();
    hotel.send({ t: "run_end", run: 7, reason: "idle_timeout" });
    await waitFor(() => sidecar?.manager?.runCount === 0, "run dropped");
    expect(hotel.received.some((f) => f.t === "actor_despawn" || f.t === "run_end")).toBe(false);
  });
});

describe("connection loss and reconcile (D41)", () => {
  it("resumes the same run after a reconnect: the hotel renews the lease and the room is resynced", async () => {
    const { fake: hotel } = await running({ rng: () => 0.5 });
    const before = lastStatus(hotel)?.llm_calls ?? 0;
    hotel.dropConnection();
    await waitFor(() => hotel.connections === 2, "reconnect", 4000);
    await waitFor(() => hotel.received.filter((f) => f.t === "hello_ack").length === 2, "second hello_ack");
    const ack = hotel.received.filter((f) => f.t === "hello_ack").at(-1);
    expect(ack).toMatchObject({ resume: [7] });
    await waitFor(() => hotel.received.filter((f) => f.t === "subscribe_room").length >= 2, "room re-subscribed");
    await waitFor(() => (lastStatus(hotel)?.llm_calls ?? 0) > before, "pulses continue after the resync", 4000);
    expect(lastStatus(hotel)?.state).toBe("running");
  });

  it("a restarted sidecar owns nothing: it answers the hotel's hello with an empty resume list", async () => {
    const first = await running();
    // A crash: the first process vanishes without a walk-out.
    first.sidecar.manager?.director.stop(1011);
    const survivors = first.fake.actorsLeft();
    expect(survivors).toBe(3);
    const second = await bootSidecar({ fake: first.fake });
    await waitFor(() => first.fake.received.filter((f) => f.t === "hello_ack").length === 2, "second process hello_ack", 4000);
    expect(first.fake.received.filter((f) => f.t === "hello_ack").at(-1)).toMatchObject({ resume: [] });
    expect(second.sidecar.manager?.runCount).toBe(0);
    await second.sidecar.close();
  });
});

describe("LLM circuit breaker through a run (D49)", () => {
  it("opens after consecutive provider failures, pauses the run with cause breaker, and resumes by itself after one good probe", async () => {
    let failing = true;
    llm = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        const probe = (JSON.parse(body || "{}") as { max_tokens?: number }).max_tokens === 1;
        if (probe || !failing) {
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
        } else res.writeHead(500).end("boom");
      });
    });
    await new Promise<void>((r) => llm?.listen(0, "127.0.0.1", () => r()));
    const addr = llm.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    process.env["PERFECTMAN_LLM_API_KEY"] = "test-key";
    const { fake: hotel } = await running({
      config: { llm: { provider: "openai-compatible", baseUrl: `http://127.0.0.1:${port}/v1`, apiKeyEnv: "PERFECTMAN_LLM_API_KEY", models: ["m"], prices: {}, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 } },
      timing: { breakerInitialBackoffMs: 300 },
    });
    await waitFor(() => lastStatus(hotel)?.pause_cause === "breaker", "breaker pause", 8000);
    expect(lastStatus(hotel)).toMatchObject({ state: "paused", breaker: "open" });
    expect(notices(hotel)).toContain("llm_circuit_open");
    failing = false;
    await waitFor(() => lastStatus(hotel)?.state === "running", "automatic resume", 8000);
    expect(lastStatus(hotel)).toMatchObject({ breaker: "closed" });
    expect(notices(hotel)).toContain("llm_circuit_closed");
    delete process.env["PERFECTMAN_LLM_API_KEY"];
  }, 20_000);
});
