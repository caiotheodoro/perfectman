/**
 * The drama bench: every scenario passes on the stack as it is, and each one fails when the thing it guards is broken (a mutation of the run's own
 * events, applied by a fixed rule, then judged again by the same checks and the same probes). The gate script reads the report and turns red on a failure.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DRAMA_SCENARIOS, runDramaBench } from "../bench/drama-bench.js";
import type { DramaScenario } from "../bench/drama-bench.js";
import type { DramaEvent } from "../drama/index.js";
import { runDramaSim } from "../embodiment/drama-sim.js";
import type { SimResult } from "../embodiment/drama-sim.js";
import { runDramaProbes } from "../probes/drama.js";

const byId = (id: string): DramaScenario => DRAMA_SCENARIOS.find((s) => s.id === id)!;
const cache = new Map<string, SimResult>();
async function result(id: string): Promise<SimResult> {
  if (!cache.has(id)) cache.set(id, runDramaSim(await byId(id).build()));
  return cache.get(id)!;
}

/** The scenario's own checks and every probe, over a result whose events were edited and whose probes were run again. */
function judge(id: string, r: SimResult, edit: (events: DramaEvent[]) => DramaEvent[] = (e) => e, proposals: SimResult["proposals"] = r.proposals): { checks: string[]; probes: string[] } {
  const events = edit([...r.events]);
  const probes = runDramaProbes({ events, actorIds: r.actors, durationMs: r.durationMs });
  const mutated: SimResult = { ...r, events, probes, proposals };
  return { checks: byId(id).check(mutated).filter((c) => !c.ok).map((c) => c.name), probes: probes.filter((p) => !p.passed).map((p) => p.probe) };
}

describe("the drama bench on the stack as it is", () => {
  it("runs the nine scenarios of the act contract and every one passes, with every check and every probe", async () => {
    const report = await runDramaBench();
    expect(report.perScenario.map((e) => e.id)).toEqual(DRAMA_SCENARIOS.map((s) => s.id));
    expect(report.perScenario.filter((e) => !e.passed).map((e) => ({ id: e.id, failed: e.failed, probes: e.probesFailed, checks: e.checks.filter((c) => !c.ok).map((c) => c.name) }))).toEqual([]);
    expect({ run: report.scenariosRun, failed: report.scenariosFailed, rate: report.passRate }).toEqual({ run: 9, failed: 0, rate: 1 });
    expect(report.checksFailed).toBe(0);
  });

  it("covers what the contract asks of it: the ladder, a veto, budget spacing, one kill a scene, reaction obligations, the dead, consent, calm, drama off", () => {
    expect(DRAMA_SCENARIOS.map((s) => s.id)).toEqual([
      "drama_ladder_full",
      "drama_veto_skipped_rung",
      "drama_budget_spacing",
      "drama_kill_once_per_scene",
      "drama_reaction_obligations",
      "drama_dead_silent_until_revive",
      "drama_consent_human_target",
      "drama_calm_room",
      "drama_off_unchanged",
    ]);
  });

  it("a scenario that cannot be built is a failure with its reason, not a crash", async () => {
    const report = await runDramaBench(["nothing"]);
    expect(report.scenariosRun).toBe(0);
    const broken = await (await import("../bench/drama-bench.js")).runDramaScenario({ id: "x", name: "x", build: () => Promise.reject(new Error("no such scene")), check: () => [] });
    expect(broken).toMatchObject({ passed: false, failed: "no such scene" });
  });
});

describe("each scenario fails when what it guards is broken", () => {
  it("[LAD-1] the full ladder: a punch that never happened is a miss", async () => {
    const r = await result("drama_ladder_full");
    expect(judge("drama_ladder_full", r)).toEqual({ checks: [], probes: [] });
    const verdict = judge("drama_ladder_full", r, (e) => e.filter((x) => !(x.kind === "act_started" && x.verb === "punch")));
    expect(verdict.checks).toContain("ana walks the whole ladder toward bia, in order");
  });

  it("[LAD-1] a skip that the hotel let through is a miss (the ladder probe and the scenario both see it)", async () => {
    const r = await result("drama_ladder_full");
    const verdict = judge("drama_ladder_full", r, (e) => e.filter((x) => !(x.kind === "act_started" && (x.verb === "insult" || x.verb === "shove"))));
    expect(verdict.probes).toContain("ladder-compliance");
    expect(verdict.checks.length).toBeGreaterThan(0);
  });

  it("[LAD-1] the veto scenario: no veto in the log is a miss", async () => {
    const r = await result("drama_veto_skipped_rung");
    expect(judge("drama_veto_skipped_rung", r).checks).toEqual([]);
    expect(judge("drama_veto_skipped_rung", r, (e) => e, r.proposals.filter((p) => !p.decision.includes("veto"))).checks).toContain("the slap after a glare is vetoed as a skipped rung (LAD-1)");
  });

  it("[LAD-3] budget spacing: two physical beats 5 s apart are a miss, in the scenario and in the ladder probe", async () => {
    const r = await result("drama_budget_spacing");
    const physical = r.events.filter((e) => e.kind === "act_started" && ["shove", "slap", "punch"].includes(e.verb));
    const second = physical[1]!;
    const verdict = judge("drama_budget_spacing", r, (e) => e.map((x) => (x === second && second.kind === "act_started" && physical[0]!.kind === "act_started" ? { ...second, atMs: physical[0]!.atMs + 5000, hotelAt: (physical[0]!.hotelAt ?? 0) + 5000 } : x)));
    expect(verdict.checks).toContain("two physical beats are never closer than 20 s");
    expect(verdict.probes).toContain("ladder-compliance");
  });

  it("[LAD-4] one kill per scene: a second death in the first scene is a miss", async () => {
    const r = await result("drama_kill_once_per_scene");
    expect(judge("drama_kill_once_per_scene", r)).toEqual({ checks: [], probes: [] });
    const deaths = r.events.filter((e) => e.kind === "actor_death");
    const verdict = judge("drama_kill_once_per_scene", r, (e) => e.map((x) => (x === deaths[1] && x.kind === "actor_death" ? { ...x, scene: deaths[0]!.kind === "actor_death" ? (deaths[0]!.scene ?? "") : "" } : x)));
    expect(verdict.checks).toContain("two kills landed in all, one in each scene");
  });

  it("[REA-1] reaction obligations: a witness that never reacts is a miss", async () => {
    const r = await result("drama_reaction_obligations");
    expect(judge("drama_reaction_obligations", r)).toEqual({ checks: [], probes: [] });
    const verdict = judge("drama_reaction_obligations", r, (e) => e.filter((x) => !(x.kind === "act_reaction" && x.role === "witness")));
    expect(verdict.probes).toContain("witness-coverage");
    expect(verdict.checks).toContain("every owed witness reacted (witness-coverage 1) and nothing was left owed");
  });

  it("[DEATH-5] the dead: speech between the death and the revive is a miss", async () => {
    const r = await result("drama_dead_silent_until_revive");
    expect(judge("drama_dead_silent_until_revive", r)).toEqual({ checks: [], probes: [] });
    const death = r.events.find((e) => e.kind === "actor_death")!;
    const verdict = judge("drama_dead_silent_until_revive", r, (e) => [...e, { kind: "speech", atMs: death.atMs + 5000, actor: "bia", mode: "say", text: "estou aqui" } as DramaEvent].sort((a, b) => a.atMs - b.atMs));
    expect(verdict.probes).toContain("dead-speech");
    expect(verdict.checks).toContain("bia said nothing between her death and her revive (dead-speech 0)");
  });

  it("[CHIP-6] consent: a violent act that landed on a human who never took it is a miss", async () => {
    const r = await result("drama_consent_human_target");
    expect(judge("drama_consent_human_target", r)).toEqual({ checks: [], probes: [] });
    const verdict = judge("drama_consent_human_target", r, (e) => e.filter((x) => !(x.kind === "consent_chip" && x.phase === "answered")));
    expect(verdict.probes).toEqual(expect.arrayContaining(["human-untouched-without-take"]));
    expect(verdict.checks.length).toBeGreaterThan(0);
  });

  it("[GATE-2] calm: a contact verb that started in a calm room is a miss", async () => {
    const r = await result("drama_calm_room");
    expect(judge("drama_calm_room", r)).toEqual({ checks: [], probes: [] });
    const shove = r.proposals.find((p) => p.verb === "shove")!;
    const verdict = judge("drama_calm_room", r, (e) => [...e, { kind: "act_started", atMs: shove.atMs, actId: "mut", verb: "shove", actor: "ana", with: "bia", room: "12" } as DramaEvent]);
    expect(verdict.checks).toContain("the shove while calm was on is refused (calm_room) and never started");
  });

  it("[NEG-2] drama off: an act command in the log is a miss", async () => {
    const r = await result("drama_off_unchanged");
    expect(byId("drama_off_unchanged").check(r).filter((c) => !c.ok)).toEqual([]);
    const leaked: SimResult = { ...r, lines: [...r.lines, { conn: 4, dir: "in", frame: { t: "actor_cmd", cmd: { k: "act", act_id: "x", verb: "glare" } }, run: 7, ts_ms: 1 }] };
    expect(byId("drama_off_unchanged").check(leaked).filter((c) => !c.ok).map((c) => c.name)).toContain("no act command was sent");
    expect(byId("drama_off_unchanged").check({ ...r, offDeviations: 2 }).filter((c) => !c.ok).map((c) => c.name)).toContain("the planner's commands equal the plain planner's on every consult (offDeviations 0)");
  });
});

describe("the bench gate (scripts/ci/check-bench-gate.mjs)", () => {
  const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../../../../scripts/ci/check-bench-gate.mjs");
  const base = { version: "bench-report-v1", scenariosRun: 3, scenariosFailed: 0, signalPassRate: 1, probePassRate: 0.937, perScenario: [] };
  const entry = (passed: boolean) => ({ id: "drama_x", name: "x", passed, checks: passed ? [] : [{ name: "the thing it guards", ok: false }], probesFailed: [], acts: 1 });
  const gate = (report: unknown, ...flags: string[]): { code: number; out: string } => {
    const file = join(mkdtempSync(join(tmpdir(), "gate-")), "bench.json");
    writeFileSync(file, JSON.stringify(report));
    try {
      return { code: 0, out: execFileSync("node", [SCRIPT, ...flags, file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      return { code: e.status, out: `${e.stdout}${e.stderr}` };
    }
  };

  it("passes a report whose drama bench held, and says how many scenarios", () => {
    const g = gate({ ...base, drama: { scenariosRun: 9, scenariosFailed: 0, passRate: 1, perScenario: [entry(true)] } });
    expect(g.code).toBe(0);
    expect(g.out).toContain("drama bench 9/9");
  });

  it("fails on a drama scenario that failed, naming it and the check that broke", () => {
    const g = gate({ ...base, drama: { scenariosRun: 9, scenariosFailed: 1, passRate: 8 / 9, perScenario: [entry(false)] } });
    expect(g.code).toBe(1);
    expect(g.out).toContain("drama_x");
    expect(g.out).toContain("the thing it guards");
  });

  it("fails a report with no drama bench only when it is asked to require one", () => {
    expect(gate(base).code).toBe(0);
    const g = gate(base, "--require-drama");
    expect(g.code).toBe(1);
    expect(g.out).toContain("no drama bench");
  });

  it("the roleplay gate still stands on its own: a signal below 100% fails whatever the drama bench says", () => {
    expect(gate({ ...base, signalPassRate: 0.98, drama: { scenariosRun: 9, scenariosFailed: 0, passRate: 1, perScenario: [] } }).code).toBe(1);
  });
});
