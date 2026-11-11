/**
 * The beat sheet inside a real run against the fake hotel (Contract A, "Runtime"): a body with a valid sheet plays it instead of the generic spine, the climax
 * lands through the director as a scenario act, the run summary says what became of it, and a scene without a sheet logs `beat_sheet_fallback` and plays the
 * spine as it always did. The sheet here is the contract's shape squeezed into five seconds so the real clock can play it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BeatSheet } from "@perfectman/shared";
import { defaultSceneDrama } from "../authoring/scenario-drama.js";
import type { ScenarioBody } from "../run/scenario-body.js";
import type { Sidecar } from "../sidecar.js";
import { FakeDirector } from "../testing/fake-director.js";
import { TEST_SECRET, bootSidecar, compiledScenario, waitFor } from "../testing/helpers.js";

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;
afterEach(async () => {
  await sidecar?.close();
  await fake?.stop();
  sidecar = fake = undefined;
});

/** Squeezed: inciting 300 ms, climax 2500 ms, aftermath until 5000 ms. Valid: one peak with the authored skip, a setup note, three non-talk beats, an aftermath. */
const SHEET: BeatSheet = {
  version: 1,
  premise: "A cobra de B o que ficou por dizer.",
  stakes: "A confiança entre os dois.",
  arc: { inciting_at_ms: 300, climax_at_ms: 2500, aftermath_until_ms: 5000 },
  beats: [
    { id: "s1", at_ms: 0, phase: "setup", kind: "note", actor: "person-1", objective: "Quer uma resposta de B.", gist: "Chegam achando que é conversa comum." },
    { id: "s2", at_ms: 100, phase: "setup", kind: "camera", intent: { shot: "establishing" } },
    { id: "s3", at_ms: 200, phase: "setup", kind: "block", actor: "person-1", to: { near: "person-2" }, how: "walk" },
    { id: "s4", at_ms: 300, phase: "inciting", kind: "reveal", fact: "A descobriu algo sobre B.", to: ["person-1"], via: "show" },
    { id: "s5", at_ms: 600, phase: "escalation", kind: "prop", actor: "person-1", prop: "envelope", op: "show", to: "person-2" },
    { id: "s6", at_ms: 900, phase: "escalation", kind: "expression", actor: "person-2", face: "fear", ms: 1500 },
    { id: "s7", at_ms: 2500, phase: "climax", kind: "act", actor: "person-1", verb: "slap", with: "person-2", authored_skip: true, climax: true },
    { id: "s8", at_ms: 3000, phase: "aftermath", kind: "pause", ms: 800 },
    { id: "s9", at_ms: 3200, phase: "aftermath", kind: "camera", intent: { shot: "reaction", on: "person-2" } },
  ],
  generated_by: { model: "mock", cost_usd: 0, ms: 0, mock: true },
};

async function boot(o: { sheet?: BeatSheet; body?: Partial<ScenarioBody> } = {}) {
  fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4, autoAct: true, drama: {} });
  fake.addRoom(12);
  fake.addHuman(12, 9, "ana", 6, 5);
  fake.optIn.set(12, [9]);
  const base = compiledScenario().body as ScenarioBody;
  const body: ScenarioBody = { ...base, drama: defaultSceneDrama(["person-1", "person-2", "person-3"])!, drama_mode: "default", ...(o.sheet ? { beat_sheet: o.sheet } : {}), ...o.body };
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

type Summary = { counters: Record<string, number>; scene_spine?: unknown; beat_sheet?: { arc: Record<string, number>; beats: number; played: number; dropped: Record<string, number>; climax: { outcome: string; planned_ms: number; at_ms?: number }; generated_by?: { model: string } } };
async function summary(hotel: FakeDirector, cfg: { dataDir: string }): Promise<Summary> {
  hotel.pmCommand(7, 12, "stop");
  await waitFor(() => hotel.received.find((f) => f.t === "run_end"), "run_end", 6000);
  return JSON.parse(readFileSync(join(cfg.dataDir, "runs", "7", "replay.json"), "utf8")) as Summary;
}
const acts = (hotel: FakeDirector) => hotel.received.flatMap((f) => (f.t === "actor_cmd" && f.cmd.k === "act" && f.cmd.origin === "scenario" ? [f] : []));

describe("a scene with a beat sheet, in a run", () => {
  it("[hard] plays the climax as a scenario act through the director, and the summary says it landed, when, and how the sheet fared", async () => {
    const { hotel, cfg } = await boot({ sheet: SHEET });
    const slap = await waitFor(() => acts(hotel).find((f) => f.cmd.k === "act" && f.cmd.verb === "slap"), "the climax on the wire", 8000);
    expect(slap.cmd).toMatchObject({ verb: "slap", origin: "scenario", authored_skip: true });
    await new Promise((r) => setTimeout(r, 3200));
    const done = await summary(hotel, cfg);
    expect(done.beat_sheet).toMatchObject({ arc: { climax_at_ms: 2500 }, beats: 9, generated_by: { model: "mock" }, climax: { outcome: "played", planned_ms: 2500 } });
    expect(done.beat_sheet?.climax.at_ms).toBeGreaterThanOrEqual(2400);
    expect(done.beat_sheet?.climax.at_ms).toBeLessThan(4500);
    expect(done.beat_sheet?.played).toBeGreaterThanOrEqual(8);
    expect(done.counters["beats_played"]).toBeGreaterThanOrEqual(8);
    // the sheet replaces the spine, and a scene that plays a sheet does not log the fallback
    expect(done.scene_spine).toBeUndefined();
    expect(done.counters["beat_sheet_fallback"]).toBeUndefined();
  }, 25_000);

  it("walks the actor to the person the block names, and records the camera intent and the silence in the frame log", async () => {
    const { hotel, run } = await boot({ sheet: SHEET });
    await waitFor(() => acts(hotel)[0], "the climax", 8000);
    await new Promise((r) => setTimeout(r, 1500));
    expect(hotel.received.some((f) => f.t === "actor_cmd" && f.cmd.k === "walk")).toBe(true);
    const kinds = run.frameLog.frames.map((f) => f.kind);
    expect(kinds).toContain("sheet_camera");
    expect(kinds).toContain("sheet_pause");
    expect(kinds.filter((k) => k === "sheet_beat").length).toBeGreaterThanOrEqual(7);
  }, 25_000);

  it("a fear face goes out as the wire's own fear style, not as surprised", async () => {
    const { hotel } = await boot({ sheet: SHEET });
    await waitFor(() => hotel.received.find((f) => f.t === "actor_cmd" && f.cmd.k === "expression" && f.cmd.face === "fear"), "the fear face", 8000);
  }, 25_000);
});

describe("a scene without a sheet", () => {
  it("plays the generic spine as before and logs beat_sheet_fallback with the reason, in the summary's counters too", async () => {
    const { hotel, cfg } = await boot();
    await new Promise((r) => setTimeout(r, 500));
    const done = await summary(hotel, cfg);
    expect(done.scene_spine).toBeDefined();
    expect(done.counters["beat_sheet_fallback"]).toBe(1);
    expect(done.beat_sheet).toBeUndefined();
  }, 20_000);

  it("a body whose compile could not write a sheet says why, and still plays", async () => {
    const { hotel, cfg } = await boot({ body: { beat_sheet_error: "timeout: strong: timed out after 25 s" } });
    const done = await summary(hotel, cfg);
    expect(done.scene_spine).toBeDefined();
    expect(done.counters["beat_sheet_fallback"]).toBe(1);
  }, 20_000);

  it("a sheet that does not hold when read is dropped and the spine plays instead", async () => {
    const broken: BeatSheet = { ...SHEET, beats: SHEET.beats.map((b) => (b.id === "s7" && b.kind === "act" ? { ...b, at_ms: 400_000 } : b)) };
    const { hotel, cfg } = await boot({ sheet: broken });
    const done = await summary(hotel, cfg);
    expect(done.beat_sheet).toBeUndefined();
    expect(done.scene_spine).toBeDefined();
    expect(done.counters["beat_sheet_fallback"]).toBe(1);
  }, 20_000);
});
