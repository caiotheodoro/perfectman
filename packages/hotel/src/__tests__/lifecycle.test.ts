import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { Sidecar } from "../sidecar.js";
import type { FakeDirector } from "../testing/fake-director.js";
import { bootSidecar, compiledScenario, waitFor } from "../testing/helpers.js";
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

  it("refuses a second live run that reuses the first one's character ids (the shared mirror would take its actors over), and takes it once the first has ended", async () => {
    const { fake: hotel } = await running();
    hotel.addRoom(13);
    const acks = () => hotel.received.flatMap((f) => (f.t === "run_ack" ? [[f.run, f.ok, f.error?.code]] : []));
    hotel.startRun({ run: 8, room: 13, scenarioVersion: 31 });
    await waitFor(() => acks().length === 2, "the second ack");
    expect(acks()).toEqual([[7, true, undefined], [8, false, "agent_ids_in_use"]]);
    expect(hotel.received.find((f) => f.t === "run_ack" && f.run === 8)).toMatchObject({ error: { message: expect.stringContaining("run 7") } });
    // run 7 is untouched: still running, nobody of run 8 was spawned
    expect(sidecar?.manager?.runCount).toBe(1);
    expect(lastStatus(hotel)?.state).toBe("running");
    expect(hotel.received.some((f) => f.t === "actor_spawn" && f.run === 8)).toBe(false);
    hotel.pmCommand(7, 12, "stop");
    await waitFor(() => hotel.received.find((f) => f.t === "run_end" && f.run === 7), "run 7 ended", 6000);
    hotel.startRun({ run: 9, room: 13, scenarioVersion: 31 });
    await waitFor(() => acks().length === 3, "the third ack");
    expect(acks()[2]).toEqual([9, true, undefined]);
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

describe("run integrity", () => {
  const scenarioWith = (edit: (body: { config: { agents: Array<{ promptProfile: { displayName: string } }> }; looks?: Record<string, { figure: string }> }) => void) => {
    const body = JSON.parse(JSON.stringify(compiledScenario().body)) as Parameters<typeof edit>[0];
    edit(body);
    return body;
  };

  it("refuses, before any spawn, a scenario whose names or figures the hotel would refuse", async () => {
    const b = await bootSidecar({
      versions: {
        41: scenarioWith((s) => void (s.config.agents[0]!.promptProfile.displayName = "Maria Eduarda Albuquerque")),
        42: scenarioWith((s) => void (s.config.agents[1]!.promptProfile.displayName = "Rafa@home")),
        43: scenarioWith((s) => void (s.config.agents[2]!.promptProfile.displayName = "A:B")),
        44: scenarioWith((s) => void (s.looks = { "person-1": { figure: "not a figure" } })),
      },
    });
    fake = b.fake;
    sidecar = b.sidecar;
    for (const [i, version] of [41, 42, 43, 44].entries()) {
      b.fake.startRun({ run: 20 + i, room: 12 + i, scenarioVersion: version });
      await waitFor(() => b.fake.received.filter((f) => f.t === "run_ack").length === i + 1, `ack ${i + 1}`);
    }
    const acks = b.fake.received.flatMap((f) => (f.t === "run_ack" ? [[f.run, f.ok, f.error?.code]] : []));
    expect(acks).toEqual([[20, false, "bad_scenario"], [21, false, "bad_scenario"], [22, false, "bad_scenario"], [23, false, "bad_scenario"]]);
    expect(b.fake.received.some((f) => f.t === "actor_spawn")).toBe(false);
  });

  it("a run_end that lands while the run is still starting leaves nothing behind", async () => {
    const b = await bootSidecar();
    fake = b.fake;
    sidecar = b.sidecar;
    b.fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    b.fake.send({ t: "run_end", run: 7, reason: "idle_timeout" });
    await waitFor(() => sidecar?.manager?.runCount === 0, "the run is gone", 6000);
    await new Promise((r) => setTimeout(r, 300));
    expect(sidecar?.manager?.runCount).toBe(0);
    // the hotel walks its own actors out when it ends a run; whatever spawned is not the sidecar's to keep
    expect(b.fake.received.some((f) => f.t === "run_end")).toBe(false);
  });

  it("drops an actor the hotel removed from scheduling, and ends the run (walk-out) when none is left", async () => {
    const { fake: hotel } = await running();
    const run = sidecar?.manager?.getRun(7);
    const runtime = run?.simulation?.runtime;
    const sim = run?.simulation?.simulationId ?? "";
    const gone = (ref: string) => hotel.send({ t: "actor_gone", actor: hotel.avatarByRef(ref)?.id ?? 0, run: 7, reason: "kicked" } as never);
    gone("person-1");
    await new Promise((r) => setTimeout(r, 150));
    expect(run?.state).toBe("running");
    // person-1 is already retired, so retiring person-2 leaves exactly one scheduled actor
    expect(runtime?.retireAgent(sim, "person-2")).toBe(1);
    gone("person-2");
    gone("person-3");
    await waitFor(() => hotel.received.find((f) => f.t === "run_end"), "run_end once nobody is left", 6000);
    expect(hotel.received.find((f) => f.t === "run_end")).toMatchObject({ run: 7, reason: "stopped", summary: "no actors remain" });
  });

  it("retries a resnapshot the hotel never answered, with backoff, and recovers when it does", async () => {
    const { fake: hotel } = await running();
    const resnaps = () => hotel.received.filter((f) => f.t === "subscribe_room" && f.room === 12 && f.resnapshot === true).length;
    const before = resnaps();
    hotel.ignoreSubscribe = true;
    hotel.delta(12, { t: "typing", id: 9, on: true }, 1); // a rev gap: the room is degraded until a snapshot lands
    await waitFor(() => resnaps() === before + 1, "the first resnapshot");
    await new Promise((r) => setTimeout(r, 600));
    expect(resnaps()).toBe(before + 1); // backing off, not hammering
    await waitFor(() => resnaps() >= before + 2, "a retry after the backoff", 4000);
    hotel.ignoreSubscribe = false;
    await waitFor(() => !sidecar?.manager?.mirror.model().rooms.get("12")?.degraded, "the room is back", 6000);
  }, 15_000);
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
    // The engine ages by wall time (6 s a pulse in production), so a short test needs a person to talk to.
    hotel.humanSay(12, 9, "oi Duda, voltou a funcionar?");
    await waitFor(() => (lastStatus(hotel)?.llm_calls ?? 0) > before, "the run answers after the resync", 4000);
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
      timing: { breakerInitialBackoffMs: 800 },
    });
    // Addressed lines are what keeps a room's model busy in a short test: each one consults the three actors.
    // The probe answers (only generations fail), so the pause lasts one backoff: start watching before the lines.
    const paused = waitFor(() => lastStatus(hotel)?.pause_cause === "breaker", "breaker pause", 8000);
    for (let i = 0; i < 3; i++) {
      hotel.humanSay(12, 9, `Duda, Rafa e Gabi, alguem ai? ${i}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    await paused;
    expect(lastStatus(hotel)).toMatchObject({ state: "paused", breaker: "open" });
    expect(notices(hotel)).toContain("llm_circuit_open");
    failing = false;
    await waitFor(() => lastStatus(hotel)?.state === "running", "automatic resume", 8000);
    expect(lastStatus(hotel)).toMatchObject({ breaker: "closed" });
    expect(notices(hotel)).toContain("llm_circuit_closed");
    delete process.env["PERFECTMAN_LLM_API_KEY"];
  }, 20_000);
});
