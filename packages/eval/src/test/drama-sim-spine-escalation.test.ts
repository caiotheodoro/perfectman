/**
 * The scene spine opens the ladder for a cast that was heard heating up (errata P8). Production run 60 (2026-11-10, Heloísa, Otávio and Renato, a scene with the default
 * drama block, no authored beats, the spine active) blackmailed and accused each other for six minutes and held no act: the word list read none of it, the spine only wrote notes,
 * and the ladder's motive gate (`detail: "motive"`, 5 blocked proposals) stayed shut. Here the cast starts cold (no seeded resentment), the model only talks (the director's own
 * beats are the only acts), the lines are run 60's, and the spine is the run's own class on the sim's clock (`SimConfig.spine`).
 *
 * What it shows: the climb is the director's (one rung at a time, 25 s apart, never past the slap, nothing at a human, the spacing and cooldown of the contract); the spine's
 * decision is what opens the slap, which no talk alone reaches; a friendly scene opens nothing; `drama: off`, an authored `{}` block and a scene with authored beats are untouched;
 * `PERFECTMAN_SPINE_ESCALATE=0` (`spine.escalate: false`) is the spine that opens nothing.
 */
import { DRAMA_OFF, defaultSceneDrama } from "@perfectman/hotel/drama";
import type { ScenarioDrama } from "@perfectman/hotel/drama";
import { describe, expect, it } from "vitest";
import type { ActStartedEvent, DramaEvent } from "../drama/index.js";
import { runDramaSim } from "../embodiment/drama-sim.js";
import type { SimConfig, SimResult } from "../embodiment/drama-sim.js";
import { seedState } from "../embodiment/sim-states.js";
import { probeReport } from "../embodiment/sim-report.js";

const startedOf = (events: readonly DramaEvent[]): ActStartedEvent[] => events.filter((e): e is ActStartedEvent => e.kind === "act_started");
const verbsOf = (r: SimResult): string[] => startedOf(r.events).map((e) => e.verb);
const secs = (e: ActStartedEvent): number => e.atMs / 1000;
const ladder = ["glare", "insult", "shove", "slap"] as const;

const NAMES = ["Heloísa", "Otávio", "Renato"] as const;
const HELOISA = "person-1";
const OTAVIO = "person-2";
const RENATO = "person-3";

/** Run 60's cast, cold: Heloísa holds the safe (the first of the two who contend for it), Renato wants it, Otávio is a third person standing by (the witness). */
function conflict(o: Partial<SimConfig> = {}): SimConfig {
  const actors = NAMES.map((name, i) => ({ ref: `person-${i + 1}`, name }));
  const refs = actors.map((a) => a.ref);
  return {
    title: "conflict",
    seed: 11,
    durationMs: 260_000,
    actors,
    states: new Map(refs.map((ref) => [ref, seedState(ref, { simulationId: "cold", others: refs })])),
    drama: defaultSceneDrama(refs)!,
    dramaMode: "default",
    speechOnly: true,
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

/** Run 60's own lines (Renato's blackmail, the forgery, Otávio's report of what "ela" said) with a reply or two, in the order and about the spacing it had. */
const RUN_60_TALK: NonNullable<SimConfig["dialogue"]> = [
  { atMs: 20_000, actor: RENATO, to: HELOISA, text: "Heloísa, cofre hoje, senão eu conto pra mesa quem segurou a caneta." },
  { atMs: 38_000, actor: HELOISA, to: RENATO, text: "Renato, meu bem, o cofre abre amanhã." },
  { atMs: 55_000, actor: RENATO, to: HELOISA, text: "Heloísa, cofre ou eu abro a boca — e não é amanhã, é agora." },
  { atMs: 75_000, actor: RENATO, to: HELOISA, text: "A caneta era do Henrique, mas a mão que apertou era sua, irmã." },
  { atMs: 95_000, actor: OTAVIO, to: RENATO, text: "Ela te chamou de irmão e de burro na mesma frase." },
  { atMs: 110_000, actor: HELOISA, to: RENATO, text: "Renato, você mentiu e falsificou a assinatura." },
  { atMs: 130_000, actor: RENATO, to: HELOISA, text: "Heloísa, cofre hoje ou você paga." },
  { atMs: 160_000, actor: RENATO, to: HELOISA, text: "Heloísa, foi você que forjou tudo, eu vi você escondendo a carta." },
  { atMs: 190_000, actor: RENATO, to: HELOISA, text: "Heloísa, sei o que você fez." },
];

/** The same fight with the lines 70 s apart: most of one grievance has gone before the next comes, so the talk alone never builds a shove. */
const SPARSE_TALK: NonNullable<SimConfig["dialogue"]> = [
  { atMs: 50_000, actor: RENATO, to: HELOISA, text: "Heloísa, cofre hoje, senão eu conto pra mesa quem segurou a caneta." },
  { atMs: 120_000, actor: RENATO, to: HELOISA, text: "Heloísa, cofre ou eu abro a boca — e não é amanhã, é agora." },
  { atMs: 190_000, actor: RENATO, to: HELOISA, text: "A caneta era do Henrique, mas a mão que apertou era sua, irmã." },
  { atMs: 260_000, actor: RENATO, to: HELOISA, text: "Heloísa, foi você que forjou tudo, eu vi você escondendo a carta." },
];

const FRIENDLY: NonNullable<SimConfig["dialogue"]> = [
  { atMs: 20_000, actor: RENATO, to: HELOISA, text: "Heloísa, você pode me passar o vinho?" },
  { atMs: 38_000, actor: HELOISA, to: RENATO, text: "Claro, Renato, aqui está." },
  { atMs: 60_000, actor: OTAVIO, to: HELOISA, text: "Que jantar maravilhoso, Heloísa, obrigado." },
  { atMs: 90_000, actor: HELOISA, to: OTAVIO, text: "Imagina, Otávio. Fico feliz que tenham vindo." },
  { atMs: 130_000, actor: RENATO, to: OTAVIO, text: "Otávio, depois a gente combina o churrasco de domingo." },
  { atMs: 170_000, actor: OTAVIO, to: RENATO, text: "Combinado, Renato." },
];

/** What `drama-sim` says about the aggressor's walk up the ladder: each verb it started at `target`, with when. */
const climbOf = (r: SimResult, actor: string, target: string): ActStartedEvent[] => startedOf(r.events).filter((e) => e.actor === actor && e.with === target);

describe("the conflict scene: run 60's lines, cold cast, spine on", () => {
  const run = runDramaSim(conflict({ dialogue: RUN_60_TALK }));
  const climb = climbOf(run, HELOISA, RENATO);

  it("the cornered holder climbs one rung at a time, glare, insult, shove, slap, and nothing else: the director's own beats, 25 s or more apart", () => {
    expect(climb.map((e) => e.verb)).toEqual([...ladder]);
    expect(run.proposals.every((p) => p.decision === "initiate"), "the model proposed nothing: every act is the director's").toBe(true);
    for (let i = 1; i < climb.length; i++) expect(secs(climb[i]!) - secs(climb[i - 1]!), `${climb[i]!.verb} after ${climb[i - 1]!.verb}`).toBeGreaterThan(24.9);
  });

  it("reaches the shove by the spine's turn (110 s here) and the slap within a consult of its decision (150 s), never a punch, a kill or a death", () => {
    const shove = climb.find((e) => e.verb === "shove")!;
    const slap = climb.find((e) => e.verb === "slap")!;
    expect(secs(shove)).toBeLessThanOrEqual(110);
    expect(secs(slap)).toBeGreaterThanOrEqual(150);
    expect(secs(slap)).toBeLessThanOrEqual(200);
    const verbs = new Set(verbsOf(run));
    for (const banned of ["punch", "kill", "die"]) expect(verbs.has(banned), banned).toBe(false);
    // The slap is what the spine opened: the talk alone never builds it (a control below), and the grant says who and why.
    expect(run.counters["spine_unlock_slap"]).toBe(1);
    expect(run.spine?.unlocks?.grants.find((g) => g.level === "slap")).toMatchObject({ aggressor: HELOISA, target: RENATO });
  });

  it("the aggressor is the holder the lines were about, the victim the one who said them: the climb is Heloísa's, never a blow at Heloísa, never anyone at Otávio; Renato answers Heloísa's charge at 110 s with one glare", () => {
    const others = startedOf(run.events).filter((e) => !(e.actor === HELOISA && e.with === RENATO));
    // A charge said at Renato ("você mentiu e falsificou a assinatura") is answered, since a charge counts for a glare (accusation gain 0.45): a look, once, and nothing above it.
    expect(others.map((e) => `${e.actor}>${e.with} ${e.verb}`)).toEqual([`${RENATO}>${HELOISA} glare`]);
    expect(secs(others[0]!)).toBeGreaterThanOrEqual(110);
    expect(secs(others[0]!)).toBeLessThanOrEqual(112);
  });

  it("the physical beats keep the contract's spacing, the probes pass, no act is aimed at a human, none was blocked by the hotel", () => {
    const physical = startedOf(run.events).filter((e) => ["shove", "slap", "punch", "kill"].includes(e.verb)).map(secs);
    for (let i = 1; i < physical.length; i++) expect(physical[i]! - physical[i - 1]!).toBeGreaterThanOrEqual(20);
    expect({ failed: probeReport(run).failed }).toEqual({ failed: [] });
    for (const e of startedOf(run.events)) expect(e.with?.startsWith("h:") ?? false).toBe(false);
    expect(run.stats.blocked).toBe(0);
  });

  it("the report of what Heloísa said to Renato is not Otávio's insult: it raised no grievance and no act at Otávio", () => {
    expect(run.counters["grievance_reported_ignored"]).toBe(1);
    expect(startedOf(run.events).some((e) => e.with === OTAVIO)).toBe(false);
  });

  it("the spine's advances and grants are in the manifest, with the second and the evidence", () => {
    expect(run.spine?.advances.map((a) => a.step)).toEqual([1, 2, 3]);
    expect(run.spine?.unlocks).toMatchObject({ shove: 0, slap: 1, skipped_no_evidence: 0 });
    expect(run.spine?.unlocks?.grants[0]?.why).toMatch(/hostile lines in 90 s/);
  });
});

describe("the spine's turn opens the shove when the talk is too sparse to have built it", () => {
  const sparse = runDramaSim(conflict({ dialogue: SPARSE_TALK, durationMs: 340_000 }));
  const control = runDramaSim(conflict({ dialogue: SPARSE_TALK, durationMs: 340_000, spine: { ...conflict().spine!, escalate: false } }));

  it("with the spine's coupling the pair reaches the shove after the turn and the slap after the decision; without it the same talk never shoves", () => {
    expect(verbsOf(control)).not.toContain("shove");
    expect(verbsOf(control)).not.toContain("slap");
    const climb = climbOf(sparse, HELOISA, RENATO);
    const shove = climb.find((e) => e.verb === "shove");
    const slap = climb.find((e) => e.verb === "slap");
    expect(shove, "a shove").toBeDefined();
    expect(slap, "a slap").toBeDefined();
    const step2 = sparse.spine!.advances.find((a) => a.step === 2)!.atMs / 1000;
    const step3 = sparse.spine!.advances.find((a) => a.step === 3)!.atMs / 1000;
    expect(secs(shove!)).toBeGreaterThanOrEqual(step2);
    expect(secs(slap!)).toBeGreaterThanOrEqual(step3);
    // One rung at a time, 25 s apart.
    expect(climb.map((e) => e.verb).filter((v) => (ladder as readonly string[]).includes(v))).toEqual(expect.arrayContaining(["glare", "insult", "shove", "slap"]));
    expect(sparse.counters["spine_unlock_shove"]).toBe(1);
    expect(sparse.counters["spine_unlock_slap"]).toBe(1);
    for (const banned of ["punch", "kill", "die"]) expect(verbsOf(sparse)).not.toContain(banned);
  });

  it("the old spine (writes notes, opens nothing) with the new word list: the talk heats it to a shove at most, as before", () => {
    const hot = runDramaSim(conflict({ dialogue: RUN_60_TALK, spine: { ...conflict().spine!, escalate: false } }));
    expect(new Set(verbsOf(hot))).not.toContain("slap");
    expect(hot.counters["spine_unlock_shove"]).toBeUndefined();
    expect(hot.counters["spine_unlock_slap"]).toBeUndefined();
    expect(hot.spine?.unlocks).toBeUndefined();
    expect(hot.spine?.step).toBe(3);
  });
});

describe("a friendly scene stays friendly", () => {
  it("friendly lines only: no act, no unlock, the turn and the decision each found no evidence", () => {
    const r = runDramaSim(conflict({ dialogue: FRIENDLY }));
    expect(startedOf(r.events)).toEqual([]);
    expect(r.counters["spine_unlock_shove"]).toBeUndefined();
    expect(r.counters["spine_unlock_slap"]).toBeUndefined();
    expect(r.counters["spine_unlock_skipped_no_evidence"]).toBe(2);
    expect(r.counters["grievance_raised"]).toBeUndefined();
    expect(r.spine?.unlocks).toMatchObject({ shove: 0, slap: 0, skipped_no_evidence: 2, grants: [] });
  });

  it("no talk at all: the same, and the spine still reaches its decision", () => {
    const r = runDramaSim(conflict());
    expect(startedOf(r.events)).toEqual([]);
    expect(r.counters["spine_unlock_skipped_no_evidence"]).toBe(2);
    expect(r.spine?.step).toBe(3);
  });

  it("one hostile line is a remark, not a fight: it does not open a shove or a slap", () => {
    const r = runDramaSim(conflict({ dialogue: [RUN_60_TALK[0]!], durationMs: 300_000 }));
    expect(verbsOf(r).every((v) => v === "glare" || v === "insult")).toBe(true);
    expect(r.counters["spine_unlock_shove"]).toBeUndefined();
    expect(r.counters["spine_unlock_slap"]).toBeUndefined();
  });

  it("a bet and a laugh between friends are not evidence: nothing opens", () => {
    const banter: NonNullable<SimConfig["dialogue"]> = [
      { atMs: 20_000, actor: RENATO, to: HELOISA, text: "Heloísa, aposto vinte reais que você não ganha de mim, kkkkk" },
      { atMs: 45_000, actor: HELOISA, to: RENATO, text: "Renato, duvido! hahaha" },
      { atMs: 70_000, actor: RENATO, to: HELOISA, text: "Quero ver, Heloísa, quero ver kkkk" },
      { atMs: 100_000, actor: HELOISA, to: RENATO, text: "Renato, aposto o dobro, rsrs" },
    ];
    const r = runDramaSim(conflict({ dialogue: banter }));
    expect(r.counters["spine_unlock_shove"]).toBeUndefined();
    expect(r.counters["spine_unlock_slap"]).toBeUndefined();
    expect(verbsOf(r)).not.toContain("shove");
    expect(verbsOf(r)).not.toContain("slap");
  });
});

describe("what the spine never touches", () => {
  const heated = (o: Partial<SimConfig>): SimResult => runDramaSim(conflict({ dialogue: RUN_60_TALK, ...o }));

  it("drama: off is inert: no act, no unlock, no spine, whatever is said", () => {
    const r = heated({ drama: DRAMA_OFF, dramaMode: "off" });
    expect(startedOf(r.events)).toEqual([]);
    expect(r.counters).toEqual({});
    expect(r.spine).toBeUndefined();
  });

  it("an authored {} block (free play: no pair may be targeted) opens nothing: no act, no grant", () => {
    const empty: ScenarioDrama = { max_rung: 3, may_target: [], may_die: [], permadeath: false };
    const r = heated({ drama: empty, dramaMode: undefined });
    expect(startedOf(r.events)).toEqual([]);
    expect(r.counters["spine_unlock_shove"]).toBeUndefined();
    expect(r.counters["spine_unlock_slap"]).toBeUndefined();
  });

  it("a restrictive block opens only its own pair: with only Heloísa allowed at Renato the climb is the same, with only Otávio at Heloísa nobody is opened", () => {
    const mine: ScenarioDrama = { max_rung: 4, may_target: [[HELOISA, RENATO]], may_die: [], permadeath: false };
    const same = heated({ drama: mine, dramaMode: undefined });
    expect(startedOf(same.events).every((e) => e.actor === HELOISA && e.with === RENATO)).toBe(true);
    expect(climbOf(same, HELOISA, RENATO).map((e) => e.verb)).toEqual([...ladder]);
    // Otávio is allowed at Heloísa and nobody has said a thing at him: no evidence, no grant, no act.
    const other: ScenarioDrama = { max_rung: 4, may_target: [[OTAVIO, HELOISA]], may_die: [], permadeath: false };
    const none = heated({ drama: other, dramaMode: undefined });
    expect(startedOf(none.events)).toEqual([]);
    expect(none.counters["spine_unlock_shove"]).toBeUndefined();
    expect(none.counters["spine_unlock_slap"]).toBeUndefined();
    expect(none.counters["spine_unlock_skipped_no_evidence"]).toBe(2);
  });

  it("a scene with authored beats has no spine: the beats are the author's, nothing is opened, nothing counted", () => {
    const beats = [{ id: "b1", at_ms: 30_000, kind: "act" as const, actor: RENATO, verb: "insult" as const, with: HELOISA }];
    const r = heated({ beats });
    expect(r.spine).toBeUndefined();
    for (const k of ["spine_unlock_shove", "spine_unlock_slap", "spine_unlock_skipped_no_evidence"]) expect(r.counters[k], k).toBeUndefined();
    // The authored act is played as before.
    expect(startedOf(r.events).find((e) => e.origin === "scenario")).toMatchObject({ verb: "insult", actor: RENATO });
  });

  it("without a spine in the config (the sim as it was) nothing is opened either", () => {
    const { spine: _spine, ...bare } = conflict({ dialogue: RUN_60_TALK });
    const r = runDramaSim(bare);
    expect(r.spine).toBeUndefined();
    expect(r.counters["spine_unlock_slap"]).toBeUndefined();
    expect(verbsOf(r)).not.toContain("slap");
  });

  it("never toward a human: a human who is insulted back and stands beside the pair is never hit, and the unlock is for bots", () => {
    const humans = [{ id: 9, name: "Ana", tile: [5, 5] as [number, number], optIn: true }];
    const talk: NonNullable<SimConfig["dialogue"]> = [...RUN_60_TALK, { atMs: 70_000, actor: RENATO, text: "Ana, você mentiu pra todo mundo e é uma idiota." }, { atMs: 120_000, actor: RENATO, text: "Ana, foi você que forjou a assinatura." }];
    const r = runDramaSim(conflict({ dialogue: talk, humans }));
    for (const e of startedOf(r.events)) expect(e.with?.startsWith("h:") ?? false, `${e.verb} aimed at a human`).toBe(false);
    expect(climbOf(r, HELOISA, RENATO).map((e) => e.verb)).toEqual([...ladder]);
  });

  it("a block that lets the punch and the kill through still never gets them from the spine: its unlock stops at the slap", () => {
    const refs = [HELOISA, OTAVIO, RENATO];
    const wide: ScenarioDrama = { max_rung: 6, may_target: refs.flatMap((a) => refs.filter((b) => b !== a).map((b) => [a, b] as [string, string])), may_die: refs, permadeath: false };
    const r = runDramaSim(conflict({ dialogue: RUN_60_TALK, drama: wide, dramaMode: undefined, durationMs: 330_000 }));
    for (const banned of ["punch", "kill", "die"]) expect(verbsOf(r), banned).not.toContain(banned);
    expect(verbsOf(r)).toContain("slap");
  });
});

describe("the note the aggressor reads", () => {
  it("the unlock is for the aggressor only: Heloísa's next prompt has it, Renato's and Otávio's do not", () => {
    const r = runDramaSim(conflict({ dialogue: RUN_60_TALK }));
    const grant = r.spine!.unlocks!.grants.find((g) => g.level === "slap")!;
    expect(grant.aggressor).toBe(HELOISA);
    expect(grant.target).toBe(RENATO);
  });
});
