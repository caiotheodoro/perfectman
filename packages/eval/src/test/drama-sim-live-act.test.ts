/**
 * Run 62 through the drama stack (errata P9). Production run 62 (2026-11-10, cinematic, Terraço, Heloísa, Otávio and Renato, the default drama block, no authored beats, the scene spine on,
 * deepseek-v4.1-flash, 45 minutes): the spine opened the ladder three times (the shove for Renato at Otávio at 334 s, the slap for the same pair at 393 s, the slap for Otávio at Renato at
 * 1216 s) and the run's artifacts show no blow after them. Its model proposed `glare` 79 times, 53 of them at Heloísa, and every one was refused for want of a motive.
 *
 * Staged here as far as the harness goes: the same three people, the default block, the spine as the run builds it, the model consulted every 21 s (staggered 7 s apart) and the run's idle
 * sweep planning the others every pulse, the model's own proposals (a glare at Heloísa, never anything else, whatever it is told), every actor walking on its own every 60 to 150 s,
 * feelings that move, run 62's own lines as the talk (`fixtures/run-62-lines.ts`) and the three grants put back at their seconds and pairs. The talk is spoken but not read by the grievance
 * ledger: the addressees of the live lines are not on record, and the sim's own reading of them grants other pairs at other seconds (the spine finds no evidence at its turn and its decision,
 * as it did live: `spine_unlock_skipped_no_evidence` 2), so the manifest's grants are the seam's.
 *
 * Not staged: a real model (its replies to a refusal, its prompt), the engine's own drift of what each person holds against each other, the hotel's room (the sim's grid is a lounge with
 * its own furniture, not the Terraço), a calm room, a hotel that refuses what the sidecar's copy of the gates lets through.
 */
import { DEFAULT_DRAMA_TUNING, defaultSceneDrama } from "@perfectman/hotel/drama";
import type { DramaTuning } from "@perfectman/hotel/drama";
import type { AgentState } from "@perfectman/shared";
import { describe, expect, it } from "vitest";
import type { ActStartedEvent } from "../drama/index.js";
import { runDramaSim } from "../embodiment/drama-sim.js";
import type { SimConfig, SimResult } from "../embodiment/drama-sim.js";
import { DRAMA_PRESETS, presetSimConfig } from "../embodiment/drama-sim-preset.js";
import { probeReport } from "../embodiment/sim-report.js";
import { seedState } from "../embodiment/sim-states.js";
import { RUN_62_LINES } from "./fixtures/run-62-lines.js";

const HELOISA = "person-1";
const OTAVIO = "person-2";
const RENATO = "person-3";
const REFS = [HELOISA, OTAVIO, RENATO];
const NAME_OF: Record<string, string> = { Heloísa: HELOISA, Otávio: OTAVIO, Renato: RENATO };

/** The manifest's `scene_spine.unlocks.grants` of run 62, by second. */
const GRANTS: NonNullable<SimConfig["grants"]> = [
  { atMs: 334_000, level: "shove", aggressor: RENATO, target: OTAVIO },
  { atMs: 393_000, level: "slap", aggressor: RENATO, target: OTAVIO },
  { atMs: 1_216_000, level: "slap", aggressor: OTAVIO, target: RENATO },
];

/** Feelings that move: each person's arousal swells and ebbs on its own phase (about every 4 minutes), its momentum with it. */
const drift = (ref: string, state: AgentState, atMs: number): AgentState => {
  const phase = REFS.indexOf(ref) * 2.1;
  const t = atMs / 41_000 + phase;
  return { ...state, coreMood: { ...state.coreMood, arousal: 0.55 + 0.3 * Math.sin(t), momentumArousal: 0.3 * Math.cos(t) } };
};

/** What the model did in run 62: a glare, every fifth turn (about 105 s, 79 in 45 minutes between the three), Otávio's and Renato's at Heloísa and Heloísa's at Otávio; a refusal changes nothing. */
const GLARES: NonNullable<SimConfig["model"]> = ({ ref, n, handleOf }) => {
  const at = n % 5 !== 0 ? undefined : ref === HELOISA ? OTAVIO : HELOISA;
  const handle = at ? handleOf(at) : undefined;
  return handle ? { act: { verb: "glare", target: handle } } : undefined;
};

/** Run 62's lines as the talk, read by nobody's grievance ledger (see the header). */
const TALK: NonNullable<SimConfig["dialogue"]> = RUN_62_LINES.map((l) => ({ atMs: l.t * 1000, actor: NAME_OF[l.name]!, text: l.text, read: false }));

function live(o: Partial<SimConfig> = {}): SimConfig {
  return {
    title: "run 62",
    seed: 5,
    durationMs: 1_330_000,
    consultMs: 21_000,
    sweep: { everyMs: 7000 },
    actors: Object.entries(NAME_OF).map(([name, ref]) => ({ ref, name })),
    states: new Map(REFS.map((ref) => [ref, seedState(ref, { simulationId: "run-62", others: REFS })])),
    drama: defaultSceneDrama(REFS)!,
    dramaMode: "default",
    model: GLARES,
    ownWalk: REFS.map((actor) => ({ actor, everyMs: [60_000, 150_000] as const })),
    drift,
    dialogue: TALK,
    grants: GRANTS,
    spine: {
      language: "pt-BR",
      cast: [
        { ref: HELOISA, objective: { description: "manter o cofre fechado até segunda", scarceResourceId: "cofre", constraint: "a assinatura é falsa" } },
        { ref: RENATO, objective: { description: "arrancar o cofre hoje", scarceResourceId: "cofre", costOfExposure: "perder o preço do silêncio" } },
      ],
    },
    ...o,
  };
}

const startedOf = (r: SimResult): ActStartedEvent[] => r.events.filter((e): e is ActStartedEvent => e.kind === "act_started");
const between = (r: SimResult, actor: string, target: string, fromS: number, toS: number): ActStartedEvent[] => startedOf(r).filter((e) => e.actor === actor && e.with === target && e.atMs >= fromS * 1000 && e.atMs < toS * 1000);
const PHYSICAL = ["shove", "slap", "punch", "kill"];

describe("run 62 as staged: the harness is the live run's, as far as it goes", () => {
  const run = runDramaSim(live());

  it("the spine finds no evidence at its turn and its decision, as it did live, and the manifest's three grants are in: two shoves and slaps opened, one more for the other pair", () => {
    expect(run.counters["spine_unlock_skipped_no_evidence"]).toBe(2);
    expect(run.counters["spine_unlock_shove"]).toBe(1);
    expect(run.counters["spine_unlock_slap"]).toBe(2);
    expect(run.spine?.advances.map((a) => a.step)).toEqual([1, 2, 3]);
  });

  it("the model proposed only glares, at Heloísa and now and then Otávio, as often as it did live (about 80 in 45 minutes), and each one that was refused was refused for a motive", () => {
    const glares = run.proposals.filter((p) => p.decision !== "initiate");
    expect(glares.every((p) => p.verb === "glare")).toBe(true);
    expect(glares.filter((p) => p.with === HELOISA).length).toBeGreaterThan(18);
    expect(glares.length / (run.durationMs / 2_700_000)).toBeGreaterThan(55);
    expect(glares.length / (run.durationMs / 2_700_000)).toBeLessThan(110);
    const refused = run.bodyBlocked.filter((b) => b.code === "ladder" && b.detail === "motive");
    expect(refused.length).toBeGreaterThan(30);
  });
});

describe("the first fight: the shove for Renato at 334 s and the slap at 393 s", () => {
  const run = runDramaSim(live());
  const climb = between(run, RENATO, OTAVIO, 334, 560);

  it("opens at once: the first rung toward Otávio is a glare inside a few seconds of the grant, then an insult, a shove and a slap, one rung at a time, 25 s or more apart", () => {
    expect(climb.map((e) => e.verb)).toEqual(["glare", "insult", "shove", "slap"]);
    expect(climb[0]!.atMs / 1000).toBeLessThan(334 + 8);
    for (let i = 1; i < climb.length; i++) expect(climb[i]!.atMs - climb[i - 1]!.atMs).toBeGreaterThanOrEqual(24_900);
    expect(climb[3]!.atMs / 1000, "the slap").toBeLessThan(393 + 90);
  });

  it("keeps every safety rule: the physical beats are 20 s apart, nothing above the slap, nobody but the pair, no act the hotel refused, every probe passes", () => {
    const physical = startedOf(run).filter((e) => PHYSICAL.includes(e.verb)).map((e) => e.atMs);
    for (let i = 1; i < physical.length; i++) expect(physical[i]! - physical[i - 1]!).toBeGreaterThanOrEqual(20_000);
    for (const banned of ["punch", "kill", "die"]) expect(startedOf(run).some((e) => e.verb === banned), banned).toBe(false);
    expect(run.stats.blocked).toBe(0);
    expect({ failed: probeReport(run).failed }).toEqual({ failed: [] });
  });
});

describe("the second fight: the slap for Otávio at Renato at 1216 s", () => {
  it("Otávio answers: it climbs glare, insult, shove and slap at Renato inside the unlock's 90 s and 25 s apart, though Renato already shoved and slapped him and the cast of three allows one actor at a rung of 3 or more", () => {
    const run = runDramaSim(live());
    const climb = between(run, OTAVIO, RENATO, 1216, 1216 + 90);
    expect(climb.map((e) => e.verb)).toEqual(["glare", "insult", "shove", "slap"]);
    for (let i = 1; i < climb.length; i++) expect(climb[i]!.atMs - climb[i - 1]!.atMs).toBeGreaterThanOrEqual(24_900);
    // The log says what the blow was answering: Otávio holds the unlock, and no consult of his was refused for the cap.
    expect(run.dramaLog.some((l) => l.actor === OTAVIO && l.result === "act" && l.verb === "shove" && l.unlock === "person-2>person-3@4")).toBe(true);
    expect(run.dramaLog.some((l) => l.actor === OTAVIO && l.result === "blocked:ladder/contagion")).toBe(false);
  });

  it("the cap still holds for a third person: Heloísa, who is in no fight, never shoves or slaps anyone", () => {
    const run = runDramaSim(live());
    expect(startedOf(run).filter((e) => e.actor === HELOISA && PHYSICAL.includes(e.verb))).toEqual([]);
  });

  it("with the answer switched off (`contagion.answer: false`) the cap is the old one: the log shows Otávio's shove refused as `blocked:ladder/contagion`, LAD-10, and he never gets past the insult", () => {
    const tuning: DramaTuning = { ...DEFAULT_DRAMA_TUNING, contagion: { ...DEFAULT_DRAMA_TUNING.contagion, answer: false } };
    const run = runDramaSim(live({ tuning }));
    const climb = between(run, OTAVIO, RENATO, 1216, 1216 + 90);
    expect(climb.map((e) => e.verb)).toEqual(["glare", "insult"]);
    expect(run.dramaLog.find((l) => l.actor === OTAVIO && l.t_ms > 1_216_000 && l.result === "blocked:ladder/contagion")).toMatchObject({ pair: "person-2>person-3", verb: "shove", unlocked: 4, unlock: "person-2>person-3@4", reason: "LAD-10" });
  });
});

describe("a model that proposes on every turn does not starve the director", () => {
  // Renato's model proposes a glare at Heloísa on every consult, and nothing plans him between consults (no idle sweep): the director was only asked to start a beat of its own on a consult
  // with no proposal, so the grant at 334 s was never carried out.
  const every: SimConfig["model"] = ({ ref, handleOf }) => {
    const handle = handleOf(ref === HELOISA ? OTAVIO : HELOISA);
    return handle ? { act: { verb: "glare", target: handle } } : undefined;
  };
  const config = live({ sweep: undefined, model: every, durationMs: 560_000, grants: GRANTS.slice(0, 2) });

  it("the unlocked aggressor climbs on its own consults, whatever its model asks for", () => {
    const run = runDramaSim(config);
    expect(between(run, RENATO, OTAVIO, 334, 560).map((e) => e.verb)).toEqual(["glare", "insult", "shove", "slap"]);
  });

  it("an actor with no unlock is not given a beat of its own on a consult that carries a proposal: Heloísa and Otávio, who only glare, start nothing", () => {
    const run = runDramaSim(config);
    expect(startedOf(run).filter((e) => e.actor !== RENATO)).toEqual([]);
  });
});

describe("a note the model does not act on is not told again and again", () => {
  const run = runDramaSim(live({ grants: [] }));
  const refused = run.bodyBlocked.filter((b) => b.code === "ladder" && b.detail === "motive");

  it("every refusal is still on the log; the prompt carries the note for the first three of the same actor, verb and target in a row, then no more", () => {
    expect(refused.length).toBeGreaterThan(30);
    // Three actors, each with one target it keeps asking for: at most 3 notes each, the rest counted.
    expect(run.counters["act_blocked_notes"]).toBeLessThanOrEqual(9);
    expect(run.counters["act_blocked_notes_silenced"]).toBeGreaterThanOrEqual(refused.length - 9);
    expect(run.counters["act_blocked_notes"]! + run.counters["act_blocked_notes_silenced"]!).toBe(refused.length);
  });
});

describe("what did not change", () => {
  it("the five presets start the acts they started before, in 180 s at the default pace: 6, 9, 9, 6, 9", async () => {
    const counts: number[] = [];
    for (const id of DRAMA_PRESETS) counts.push(startedOf(runDramaSim({ ...structuredClone(await presetSimConfig(id)), durationMs: 180_000 })).length);
    expect(counts).toEqual([6, 9, 9, 6, 9]);
  });

  it("with the spine off nothing is granted by the seam either way: a run with no grants and no talk read opens nothing and no actor throws a blow", () => {
    const run = runDramaSim(live({ grants: [], durationMs: 600_000 }));
    expect(startedOf(run).filter((e) => PHYSICAL.includes(e.verb))).toEqual([]);
    expect(run.counters["spine_unlock_shove"]).toBeUndefined();
  });
});
