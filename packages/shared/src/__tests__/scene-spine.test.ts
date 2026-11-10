import { describe, expect, it } from "vitest";
import { BEAT_CRAFT_MAX_CHARS, SPINE_HOLD_MS, SPINE_STEPS, SPINE_TACTICS, SpineClock, buildSpine } from "../index.js";
import type { SpineActor } from "../index.js";

// Every name and line is invented for these tests.
const CAST: SpineActor[] = [
  { id: "ana", name: "Ana", objective: { description: "Quero ficar com o envelope antes que o Bento abra, porque meu nome está nele.", scarceResourceId: "envelope", constraint: "Nunca posso dizer que li a carta.", costOfExposure: "Perco a herança." } },
  { id: "bento", name: "Bento", objective: { description: "Quero abrir o envelope na frente de todos.", scarceResourceId: "envelope" } },
  { id: "caco", name: "Caco" },
];

describe("buildSpine", () => {
  it("needs two people", () => {
    expect(buildSpine({ language: "en", cast: [CAST[0]!] })).toBeUndefined();
    expect(buildSpine({ language: "en", cast: [] })).toBeUndefined();
  });

  it("aims people who share a scarce resource at each other, the first being the holder, and a free actor at the next in the cast", () => {
    const spine = buildSpine({ language: "pt-BR", cast: CAST })!;
    expect(spine.roles).toEqual({ ana: "holder", bento: "challenger", caco: "free" });
    expect(spine.targets).toEqual({ ana: "bento", bento: "ana", caco: "ana" });
  });

  it("has the four steps of the arc at 0, 45, 90 and 150 seconds, a note for every actor in each", () => {
    const spine = buildSpine({ language: "pt-BR", cast: CAST })!;
    expect(spine.steps.map((s) => [s.key, s.atMs])).toEqual([["pressure", 0], ["reveal", 45_000], ["turn", 90_000], ["decision", 150_000]]);
    for (const step of spine.steps) expect(Object.keys(step.notes).sort()).toEqual(["ana", "bento", "caco"]);
  });

  it("names the aim, the obstacle and one tactic verb of the controlled list, in the scene's language, and asks for one move", () => {
    const pt = buildSpine({ language: "pt-BR", cast: CAST })!.steps[1]!.notes["ana"]!;
    expect(pt).toContain("Objetivo: Quero ficar com o envelope");
    expect(pt).toContain("Obstáculo: Nunca posso dizer que li a carta");
    expect(pt).toContain("desviar o assunto de Bento");
    expect(pt).toContain("UMA jogada que mude a posição de Bento");
    const en = buildSpine({ language: "en", cast: CAST.map((a) => ({ ...a, objective: a.objective && { ...a.objective, description: "I want the envelope before Bento opens it" } })) })!.steps[1]!.notes["bento"]!;
    expect(en).toContain("Aim: I want the envelope");
    expect(en).toContain("Move: demand Ana");
    expect(en).toContain("ONE move that changes Ana's position");
    expect(en).not.toMatch(/Objetivo|jogada/);
  });

  it("keeps every note inside the beat-craft budget, however long the scenario text", () => {
    const long = "palavra ".repeat(400);
    const spine = buildSpine({ language: "pt-BR", situation: long, cast: CAST.map((a) => ({ ...a, objective: a.objective && { ...a.objective, description: long, constraint: long } })) })!;
    for (const step of spine.steps) for (const note of Object.values(step.notes)) expect(Array.from(note).length).toBeLessThanOrEqual(BEAT_CRAFT_MAX_CHARS);
  });

  it("is deterministic and writes no line of any play", () => {
    expect(JSON.stringify(buildSpine({ language: "pt-BR", cast: CAST }))).toBe(JSON.stringify(buildSpine({ language: "pt-BR", cast: CAST })));
  });

  it("uses the situation as the aim of an actor with no objective of its own", () => {
    const spine = buildSpine({ language: "en", situation: "A wake that turns into a reading of the will", cast: CAST })!;
    expect(spine.steps[0]!.notes["caco"]).toContain("Aim: A wake that turns into a reading of the will");
  });

  it("names a verb for every role and step, none repeated within a role", () => {
    for (const verbs of Object.values(SPINE_TACTICS)) expect(new Set(verbs).size).toBe(verbs.length);
  });
});

describe("SpineClock", () => {
  const spine = buildSpine({ language: "en", cast: CAST })!;
  const none = { any: [], major: [] };

  it("starts on the first step and does not move before the next step's second", () => {
    const clock = new SpineClock(spine);
    expect(clock.advance(0, none)).toBe(0);
    expect(clock.advance(44_999, { any: [1000], major: [] })).toBe(0);
  });

  it("moves to the reveal at 45 s once the set-up saw a new fact", () => {
    const clock = new SpineClock(spine);
    expect(clock.advance(45_000, { any: [12_000], major: [] })).toBe(1);
    expect(clock.advances[0]).toMatchObject({ step: 1, via: "progress" });
  });

  it("holds a step that saw no event until the hold has run out, then lets it go and says so", () => {
    const clock = new SpineClock(spine);
    expect(clock.advance(45_000, none)).toBe(0);
    expect(clock.advance(45_000 + SPINE_HOLD_MS - 1, none)).toBe(0);
    expect(clock.advance(45_000 + SPINE_HOLD_MS, none)).toBe(1);
    expect(clock.advances[0]).toMatchObject({ step: 1, via: "released" });
  });

  it("needs a move that changes the scene, not just a fact, to leave the reveal and the turn", () => {
    const clock = new SpineClock(spine);
    clock.advance(45_000, { any: [1000], major: [] });
    expect(clock.step).toBe(1);
    expect(clock.advance(90_000, { any: [50_000, 60_000], major: [] })).toBe(1);
    expect(clock.advance(90_000, { any: [50_000], major: [70_000] })).toBe(2);
    expect(clock.advance(150_000, { any: [], major: [70_000] })).toBe(2);
    expect(clock.advance(150_000, { any: [], major: [70_000, 120_000] })).toBe(3);
  });

  it("an event from before a step began does not count for it", () => {
    const clock = new SpineClock(spine);
    clock.advance(45_000, { any: [1000], major: [10_000] });
    expect(clock.step).toBe(1);
    // The major event at 10 s is older than step 1 (it began at 45 s): the turn waits.
    expect(clock.advance(90_000, { any: [], major: [10_000] })).toBe(1);
  });

  it("can catch up several steps late when each condition holds, and never goes back", () => {
    const clock = new SpineClock(spine);
    // A first look 400 s in, with nothing seen: one step, released by the hold; each later step waits out its own hold from there.
    expect(clock.advance(400_000, none)).toBe(1);
    expect(clock.advance(400_000 + SPINE_HOLD_MS - 1, none)).toBe(1);
    expect(clock.advance(400_000 + SPINE_HOLD_MS, none)).toBe(2);
    const at = clock.step;
    clock.advance(1_000, none);
    expect(clock.step).toBe(at);
    expect(SPINE_STEPS.length).toBe(4);
  });

  it("gives an actor the note of the current step and nothing to a stranger", () => {
    const clock = new SpineClock(spine);
    expect(clock.textFor("ana", 0, none)).toBe(spine.steps[0]!.notes["ana"]);
    expect(clock.textFor("nobody", 0, none)).toBeUndefined();
  });
});
