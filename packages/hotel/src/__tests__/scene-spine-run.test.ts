/**
 * The scene spine and the run's script-likeness inside a run: a scene with no authored beats gets one steering note per actor, shown only to that
 * actor, with its first step now; it is inert when the scene has beats, when drama is off, with the process switch off; and the run's replay manifest
 * carries the script-likeness score, the spine's step and the new guard counters. (The pure parts, the arc and its gate, are tested in shared; the
 * checks in the actor loop in server.)
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DRAMA_OFF } from "../authoring/scenario-drama.js";
import type { ScenarioBeat } from "../authoring/scenario-beats.js";
import type { LlmEnv } from "../config.js";
import type { ScenarioBody } from "../run/scenario-body.js";
import { SCENE_SPINE_ENV } from "../run/scene-recorder.js";
import { SPINE_ESCALATE_ENV, SpineEscalation } from "../run/spine-escalation.js";
import type { Sidecar } from "../sidecar.js";
import { FakeDirector } from "../testing/fake-director.js";
import { TEST_SECRET, bootSidecar, compiledScenario, waitFor } from "../testing/helpers.js";

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;
let llm: Server | undefined;
afterEach(async () => {
  delete process.env[SCENE_SPINE_ENV];
  delete process.env[SPINE_ESCALATE_ENV];
  delete process.env["TEST_LINK_A_KEY"];
  await sidecar?.close();
  await fake?.stop();
  await new Promise<void>((r) => (llm ? llm.close(() => r()) : r()));
  sidecar = fake = llm = undefined;
});

const insult: ScenarioBeat = { id: "b1", at_ms: 1200, kind: "act", actor: "person-1", verb: "insult", with: "person-2", authored_skip: true };
const DRAMA = { max_rung: 2, may_target: [], may_die: [], permadeath: false };

async function boot(patch: Partial<ScenarioBody>) {
  fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4, autoAct: true, drama: {} });
  fake.addRoom(12);
  fake.addHuman(12, 9, "ana", 6, 5);
  fake.optIn.set(12, [9]);
  const body: ScenarioBody = { ...(compiledScenario().body as ScenarioBody), drama: DRAMA, ...patch };
  const booted = await bootSidecar({ fake, versions: { 31: body } });
  sidecar = booted.sidecar;
  booted.fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
  await waitFor(() => booted.fake.received.find((f) => f.t === "run_ack" && f.ok), "run_ack");
  await waitFor(() => booted.fake.received.filter((f) => f.t === "actor_spawn").length === 3, "three spawns");
  const run = await waitFor(() => booted.sidecar.manager!.getRun(7), "the run");
  await waitFor(() => run.state === "running", "a running run");
  const space: { view(ref: string, now: number): { craft?: string; drama?: true } | undefined } = Reflect.get(run, "space");
  return { run, space };
}

describe("the scene spine in a run", () => {
  it("shows each actor its own pressure note from the start, and only that actor", async () => {
    const { space } = await boot({});
    const one = await waitFor(() => space.view("person-1", Date.now())?.craft, "the first actor's note");
    const two = await waitFor(() => space.view("person-2", Date.now())?.craft, "the second actor's note");
    expect(one).toContain("A cena, agora: pressão");
    expect(one).toContain("UMA jogada que mude a posição de");
    expect(two).toContain("A cena, agora: pressão");
    expect(one).not.toBe(two);
    expect(one.length).toBeLessThanOrEqual(600);
  });

  it("stays out of a scene that has authored beats", async () => {
    const { space } = await boot({ beats: [insult] });
    expect("craft" in space.view("person-1", Date.now())!).toBe(false);
  });

  it("stays out when drama is off", async () => {
    const { space } = await boot({ drama: DRAMA_OFF, drama_mode: "off" });
    expect("craft" in space.view("person-1", Date.now())!).toBe(false);
  });

  it("stays out with the process switch off", async () => {
    process.env[SCENE_SPINE_ENV] = "0";
    const { space } = await boot({});
    expect("craft" in space.view("person-1", Date.now())!).toBe(false);
  });
});

/** The spine's coupling to the ladder (errata P8): built with the spine, and gone with it or with its own switch. */
describe("the spine's coupling to the ladder in a run", () => {
  const escalationOf = (run: object): unknown => Reflect.get(run, "escalation");

  it("is built with the spine of a scene that has no authored beats", async () => {
    const { run } = await boot({});
    expect(escalationOf(run)).toBeInstanceOf(SpineEscalation);
  });

  it("is off with PERFECTMAN_SPINE_ESCALATE=0 while the spine still writes its notes: the old spine", async () => {
    process.env[SPINE_ESCALATE_ENV] = "0";
    const { run, space } = await boot({});
    expect(escalationOf(run)).toBeUndefined();
    const note = await waitFor(() => space.view("person-1", Date.now())?.craft, "the first actor's note");
    expect(note).toContain("A cena, agora: pressão");
  });

  it("is not there for a scene with authored beats or with drama off", async () => {
    expect(escalationOf((await boot({ beats: [insult] })).run)).toBeUndefined();
    await sidecar?.close();
    await fake?.stop();
    expect(escalationOf((await boot({ drama: DRAMA_OFF, drama_mode: "off" })).run)).toBeUndefined();
  });
});

describe("the run's manifest", () => {
  it("carries the script-likeness score, the spine's step and every new counter", async () => {
    let n = 0;
    const words = ["balcão", "gaveta", "janela", "corredor", "cofre", "escada", "telhado", "mochila", "relógio", "carteira", "lanterna", "sapato"];
    llm = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}") as { max_tokens?: number };
        const i = ++n;
        const line = `Achei o ${words[i % words.length]} perto do ${words[(i * 5 + 3) % words.length]}, número ${i}.`;
        const intent = JSON.stringify({ intentType: "send_message", visibleContent: line, channelTarget: "", personTargets: [], privateMotiveSummary: "responder" });
        res.writeHead(200, { "content-type": "application/json" }).end(parsed.max_tokens === 1 ? "{}" : JSON.stringify({ choices: [{ message: { content: intent } }], usage: { prompt_tokens: 900, completion_tokens: 50 }, model: "small" }));
      });
    });
    await new Promise<void>((r) => llm?.listen(0, "127.0.0.1", () => r()));
    const addr = llm.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    process.env["TEST_LINK_A_KEY"] = "key-a";
    const chain = [{ name: "small", baseUrl: `http://127.0.0.1:${port}/v1`, apiKeyEnv: "TEST_LINK_A_KEY", model: "small", maxContextTokens: 4096 }];
    const llmEnv: LlmEnv = { provider: "openai-compatible", baseUrl: chain[0]!.baseUrl, apiKeyEnv: "TEST_LINK_A_KEY", models: ["small"], chain, prices: {}, concurrency: 3, softCallsPerMin: 600, softTokensPerHour: 5_000_000 };
    const b = await bootSidecar({ config: { llm: llmEnv }, timing: { baseIntervalMs: 60_000 } });
    fake = b.fake;
    sidecar = b.sidecar;
    b.fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    await waitFor(() => b.fake.received.some((f) => f.t === "actor_cmd" && f.cmd.k === "walk"), "the cast walking in");
    await new Promise((r) => setTimeout(r, 600));
    for (let k = 0; k < 6; k++) {
      b.fake.humanSay(12, 9, `Duda, e o ${words[k]}?`);
      await new Promise((r) => setTimeout(r, 250));
    }
    await waitFor(() => (sidecar?.manager?.getRun(7)?.llmChain()?.snapshot().links[0]?.served ?? 0) >= 6, "enough calls", 10_000);
    b.fake.pmCommand(7, 12, "stop");
    await waitFor(() => b.fake.received.find((f) => f.t === "run_end"), "run_end", 6000);
    await waitFor(() => b.http.registered.length > 0, "artifact registration");
    const manifest = JSON.parse(readFileSync(join(b.cfg.dataDir, "runs", "7", "replay.json"), "utf8")) as {
      counters: Record<string, number>;
      script_likeness?: { score: number; percentile: number; sub: Record<string, number>; language: string; medium: string; say_turns: number; norms_built?: string };
      scene_spine?: { step: number; unlocks?: { shove: number; slap: number; skipped_no_evidence: number; grants: unknown[] } };
    };
    for (const key of ["llm_len_retry", "llm_len_trimmed", "llm_motif_retry", "llm_novelty_retry", "llm_motif_reaction", "llm_debt_note", "llm_debt_retry", "llm_debt_stripped", "llm_len_trim_free", "llm_guard_tic", "llm_guard_tic_stripped", "llm_guard_echo_repaired"]) {
      expect(manifest.counters[key], key).toEqual(expect.any(Number));
    }
    expect(manifest.script_likeness?.score).toEqual(expect.any(Number));
    expect(manifest.script_likeness?.language).toBe("pt");
    expect(manifest.script_likeness?.say_turns).toBeGreaterThan(0);
    expect(manifest.script_likeness?.norms_built).toBeDefined();
    expect(manifest.counters["script_likeness_score"]).toBe(Math.round(manifest.script_likeness!.score));
    expect(manifest.scene_spine?.step).toEqual(expect.any(Number));
    expect(manifest.counters["scene_spine_step"]).toBe(manifest.scene_spine!.step);
    // The coupling's own account (errata P8): nothing was opened by a human asking about a lantern.
    expect(manifest.scene_spine?.unlocks).toMatchObject({ shove: 0, slap: 0, grants: [] });
  }, 30_000);
});
