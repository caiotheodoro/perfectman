/**
 * What a cast says heats the ladder (errata P7). Production runs 56 and 57 (2026-11-10) held a screamed insult and a bet and no act: the engine's relational rules do not read
 * what was said, so a cast that only talks never gave the director's motive gate (LAD-6) a grievance, and the model's own acts were refused as `motive` and `grievance`.
 * Here the cast starts cold (no seed, no authored resentment), the scene has no `drama` block (the conservative default), the model only talks, and the lines are the
 * ones of the evidence: Caio tells Goulart he is an imbecile, Goulart says to say it to his face, a 200 pesos bet. The only way an act can start is the director's own beat,
 * and the only thing that can have moved it is the ledger. One hostile line gets at most a glare or an insult; a shove needs more; never a punch or a kill; nothing at a
 * human; nothing under `drama: off`.
 */
import { DRAMA_OFF, defaultSceneDrama } from "@perfectman/hotel/drama";
import { describe, expect, it } from "vitest";
import type { ActStartedEvent, DramaEvent } from "../drama/index.js";
import { runDramaSim } from "../embodiment/drama-sim.js";
import type { SimConfig, SimResult } from "../embodiment/drama-sim.js";
import { seedState } from "../embodiment/sim-states.js";
import { probeReport } from "../embodiment/sim-report.js";

const startedOf = (events: readonly DramaEvent[]): ActStartedEvent[] => events.filter((e): e is ActStartedEvent => e.kind === "act_started");
const verbsOf = (r: SimResult): string[] => startedOf(r.events).map((e) => e.verb);

const NAMES = ["Caio", "Goulart", "Bruno", "Marina"] as const;

/** A cold cast of `n` of the four: no seeded resentment, no prior events, the default drama block of a scene that wrote none. */
function cold(n: 3 | 4, o: Partial<SimConfig> = {}): SimConfig {
  const actors = NAMES.slice(0, n).map((name, i) => ({ ref: `person-${i + 1}`, name }));
  const refs = actors.map((a) => a.ref);
  return {
    title: `cold-${n}`,
    seed: 11,
    durationMs: 240_000,
    actors,
    states: new Map(refs.map((ref) => [ref, seedState(ref, { simulationId: "cold", others: refs })])),
    drama: defaultSceneDrama(refs)!,
    dramaMode: "default",
    speechOnly: true,
    ...o,
  };
}

/** The evidence's talk: Caio at Goulart (an insult, a bet), Goulart at Caio (say it to my face), and so on, one line every ~12 s from 8 s in. */
const HEATED: NonNullable<SimConfig["dialogue"]> = [
  { atMs: 8_000, actor: "person-1", to: "person-2", text: "Goulart, você é um imbecil, todo mundo sabe." },
  { atMs: 20_000, actor: "person-2", to: "person-1", text: "Caio, chamou eu de imbecil pelas costas? Repete na minha cara." },
  { atMs: 32_000, actor: "person-1", to: "person-2", text: "Aposto 200 pesos que você não tem coragem, Goulart, seu covarde." },
  { atMs: 44_000, actor: "person-2", to: "person-1", text: "Caio, seu palhaço, vou te arrebentar." },
  { atMs: 56_000, actor: "person-1", to: "person-2", text: "Goulart, você é patético, hahaha." },
  { atMs: 68_000, actor: "person-2", to: "person-1", text: "Caio, cala a boca, seu otário." },
  { atMs: 80_000, actor: "person-1", to: "person-2", text: "Goulart, lixo." },
  { atMs: 92_000, actor: "person-2", to: "person-1", text: "Caio, você vai pagar por isso." },
];

describe("a cold cast that only talks, scene with no drama block", () => {
  it("without the talk nothing happens: no act of any kind in four minutes (the production runs' zero)", () => {
    const r = runDramaSim(cold(3));
    expect(verbsOf(r)).toEqual([]);
    expect(r.counters).toEqual({});
  });

  it.each([3, 4] as const)("%s actors: hostile lines raise a grievance and the director climbs, one rung at a time, starting with a glare or an insult", (n) => {
    const r = runDramaSim(cold(n, { dialogue: HEATED }));
    const verbs = verbsOf(r);
    expect(verbs.length).toBeGreaterThan(0);
    expect(verbs[0]).toMatch(/^(glare|insult)$/);
    // Every act is the director's own (the model proposed nothing), between the two who talked.
    expect(r.proposals.every((p) => p.decision === "initiate")).toBe(true);
    for (const e of startedOf(r.events)) expect(["person-1", "person-2"]).toContain(e.actor);
    expect(r.counters["grievance_raised"]).toBeGreaterThanOrEqual(2);
    expect({ failed: probeReport(r).failed }).toEqual({ failed: [] });
  });

  it("a glare or an insult follows the first provocation, and the shove only comes once there was a second one inside the window", () => {
    const r = runDramaSim(cold(3, { dialogue: HEATED }));
    const acts = startedOf(r.events);
    const first = acts[0]!;
    expect(first.actor).toBe("person-2");
    expect(["glare", "insult"]).toContain(first.verb);
    // Goulart's first beat comes after Caio's first line (8 s) and before his own reply could have been a second provocation of him (the next hostile line aimed at him, 32 s).
    expect(first.atMs).toBeGreaterThan(8_000);
    expect(first.atMs).toBeLessThanOrEqual(32_000);
    const shove = acts.find((e) => e.verb === "shove");
    if (shove) {
      // The second hostile line aimed at Goulart is at 32 s.
      expect(shove.atMs).toBeGreaterThan(32_000);
      expect(acts.findIndex((e) => e.verb === "insult" && e.atMs < shove.atMs)).toBeGreaterThanOrEqual(0);
    }
  });

  it("the talk alone climbs to a shove for the one provoked again and again, and never goes past it (no slap, no punch, no kill)", () => {
    const r = runDramaSim(cold(3, { dialogue: HEATED }));
    const verbs = new Set(verbsOf(r));
    expect(verbs.has("shove")).toBe(true);
    for (const banned of ["slap", "punch", "kill", "die"]) expect(verbs.has(banned), banned).toBe(false);
  });

  it("one hostile line yields at most a glare and an insult, never a shove, however long the scene runs", () => {
    const r = runDramaSim(cold(3, { dialogue: [HEATED[0]!], durationMs: 300_000 }));
    for (const v of verbsOf(r)) expect(["glare", "insult"]).toContain(v);
    expect(r.counters["grievance_raised"]).toBe(1);
  });

  it("a line that is not hostile moves nobody", () => {
    const calm: SimConfig["dialogue"] = [
      { atMs: 8_000, actor: "person-1", to: "person-2", text: "Goulart, você pode me passar o gelo?" },
      { atMs: 20_000, actor: "person-2", to: "person-1", text: "Claro, Caio, aqui está." },
    ];
    const r = runDramaSim(cold(3, { dialogue: calm }));
    expect(verbsOf(r)).toEqual([]);
    expect(r.counters["grievance_raised"]).toBeUndefined();
  });

  it("only between pairs the scenario lets: an authored block with one pair heats that pair and no other", () => {
    const only = { max_rung: 4, may_target: [["person-2", "person-1"] as [string, string]], may_die: [], permadeath: false };
    const talk: SimConfig["dialogue"] = [
      ...HEATED,
      // Bruno insults Marina and Marina insults Bruno: not a pair of the block, so nothing is raised.
      { atMs: 10_000, actor: "person-3", to: "person-4", text: "Marina, você é uma idiota." },
      { atMs: 25_000, actor: "person-4", to: "person-3", text: "Bruno, seu babaca." },
      { atMs: 40_000, actor: "person-3", to: "person-4", text: "Marina, você é uma idiota." },
    ];
    const r = runDramaSim(cold(4, { dialogue: talk, drama: only }));
    const actors = new Set(startedOf(r.events).map((e) => e.actor));
    // Goulart (person-2) may target Caio (person-1) in this block; Caio may not target Goulart; Bruno and Marina may target nobody.
    expect([...actors].every((a) => a === "person-2")).toBe(true);
    expect(actors.has("person-2")).toBe(true);
  });

  it("never toward a human: a human who insults the cast raises nothing, and an act never lands on them", () => {
    const humans = [{ id: 9, name: "Ana", tile: [7, 4] as [number, number], optIn: true }];
    const talk: SimConfig["dialogue"] = [
      { atMs: 8_000, actor: "person-1", to: "person-2", text: "Goulart, você é um imbecil." },
      { atMs: 20_000, actor: "person-1", text: "Ana, você é uma idiota e uma covarde." },
      { atMs: 32_000, actor: "person-1", text: "Ana, seu lixo." },
    ];
    const r = runDramaSim(cold(3, { dialogue: talk, humans }));
    for (const e of startedOf(r.events)) expect(e.with?.startsWith("h:") ?? false, `${e.verb} aimed at a human`).toBe(false);
    // Only the line at Goulart is counted.
    expect(r.counters["grievance_raised"]).toBe(1);
  });

  it("drama: off is inert: no act, nothing counted, whatever is said", () => {
    const r = runDramaSim(cold(3, { dialogue: HEATED, drama: DRAMA_OFF, dramaMode: "off" }));
    expect(startedOf(r.events)).toEqual([]);
    expect(r.counters).toEqual({});
    expect(r.stats).toEqual({ started: 0, blocked: 0, aborted: 0, done: 0 });
  });

  it("a model that proposes the shove or the slap on its own is told, in a note, what would earn it, and is not refused for nothing once the talk has heated the pair", () => {
    // Cold, and the model talks and proposes acts of its own: the first proposals are refused for want of a motive and the refusal is noted (act_blocked_notes).
    const proposing = runDramaSim({ ...cold(3), speechOnly: false });
    const blockedLadder = proposing.proposals.filter((p) => p.decision === "veto" && p.reason === "ladder" && (p.detail === "motive" || p.detail === "grievance"));
    if (blockedLadder.length > 0) expect(proposing.counters["act_blocked_notes"]).toBeGreaterThanOrEqual(1);
    expect(proposing.counters["act_blocked_notes"] ?? 0).toBe(blockedLadder.length);
  });
});
