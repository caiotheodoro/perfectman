/**
 * The grievance the cast's talk builds (errata P7): the word list, the ledger (caps, decay, window, pairs, the gap between two counted lines) and what the director's
 * ladder makes of the level it reads as `rel.provocation` (a glare, an insult, a shove at most; never a slap; a grievance for the first rungs only).
 */
import { describe, expect, it } from "vitest";
import { classifyHostility } from "../director/drama/hostility.js";
import { ProvocationLedger } from "../director/drama/provocation.js";
import type { Listener, SpokenLine } from "../director/drama/provocation.js";
import { DEFAULT_DRAMA_TUNING } from "../director/drama/tuning.js";
import { motive } from "../director/drama/pressure.js";
import { A, B, C, WIDE_BLOCK, emotion, makeRig } from "../testing/drama-rig.js";

describe("classifyHostility: a word list, pt-BR and English, no model", () => {
  it.each([
    ["Goulart, você é um imbecil", "insult"],
    ["Cala a boca, seu otário!", "insult"],
    ["VOCÊ É UMA IDIOTA", "insult"],
    ["what a loser", "insult"],
    ["Repete na minha cara", "threat"],
    ["vou te arrebentar", "threat"],
    ["say it to my face", "threat"],
    ["Aposto 200 pesos que você não tem coragem", "challenge"],
    ["duvido", "challenge"],
    ["hahaha, coitado", "mockery"],
    ["kkkkk", "mockery"],
  ])("%s is %s", (text, kind) => {
    expect(classifyHostility(text)).toBe(kind);
  });

  it.each(["Pode me passar o gelo?", "Bom dia, Caio. Tudo bem?", "A casa está uma bagunça.", "repete a pergunta, por favor", "Eu adoro esse lugar", "", undefined])("%s is not hostile", (text) => {
    expect(classifyHostility(text)).toBeUndefined();
  });

  it("a line counts once, by its strongest kind: a threat over an insult over a bet over a laugh", () => {
    expect(classifyHostility("seu idiota, repete na minha cara, aposto 200, hahaha")).toBe("threat");
    expect(classifyHostility("seu idiota, aposto 200")).toBe("insult");
    expect(classifyHostility("aposto 200, hahaha")).toBe("challenge");
  });
});

/** A ledger on a clock the test moves, with the pair rule open for `allowed` (default: every ordered pair of the three). */
function ledger(allowed: (a: string, b: string) => boolean = () => true) {
  let t = 1_000_000;
  const l = new ProvocationLedger(() => DEFAULT_DRAMA_TUNING.provocation, () => t, allowed);
  return { l, advance: (ms: number) => void (t += ms), now: () => t };
}

const line = (speaker: string, content: string, over: Partial<SpokenLine> = {}): SpokenLine => ({ speaker, content, addressees: [], mentioned: [], ...over });
const heard = (...refs: string[]): Listener[] => refs.map((ref) => ({ ref, heard: true }));

describe("ProvocationLedger", () => {
  it("an insult at someone by name raises that someone's grievance toward the speaker by the gain, and nobody else's", () => {
    const { l } = ledger();
    expect(l.note(line("p1", "Goulart, você é um imbecil", { mentioned: ["p2"], addressees: ["p2"] }), heard("p2", "p3"))).toBe("insult");
    expect(l.levelOf("p2", "p1")).toBe(DEFAULT_DRAMA_TUNING.provocation.gain.insult);
    expect(l.levelOf("p1", "p2")).toBe(0);
    expect(l.levelOf("p3", "p1")).toBe(0);
    expect(l.raised.insult).toBe(1);
  });

  it("a line with no name is about whoever it is spoken to", () => {
    const { l } = ledger();
    l.note(line("p1", "você é um covarde", { addressees: ["p2"] }), heard("p2", "p3"));
    expect(l.levelOf("p2", "p1")).toBeGreaterThan(0);
    expect(l.levelOf("p3", "p1")).toBe(0);
  });

  it("a line that names someone is about that person even when it is said to another (behind their back): in the room but not within earshot is half of it", () => {
    const { l } = ledger();
    l.note(line("p1", "o Goulart é um imbecil", { mentioned: ["p2"], addressees: ["p3"] }), [{ ref: "p2", heard: false }, { ref: "p3", heard: true }]);
    expect(l.levelOf("p2", "p1")).toBe(DEFAULT_DRAMA_TUNING.provocation.gain.insult * DEFAULT_DRAMA_TUNING.provocation.behindBack);
    expect(l.levelOf("p3", "p1")).toBe(0);
  });

  it("a person who is not in the room is told nothing", () => {
    const { l } = ledger();
    expect(l.note(line("p1", "o Goulart é um imbecil", { mentioned: ["p2"] }), heard("p3"))).toBeUndefined();
    expect(l.levelOf("p2", "p1")).toBe(0);
  });

  it("one line never reaches the shove: the gain times the shove's weight stays under its lowest threshold, even for an actor whose arousal is rising fast", () => {
    const t = DEFAULT_DRAMA_TUNING;
    const shoveWeight = t.drivers.shove!.find((d) => d.source === "rel.provocation")!.weight;
    const lowestShoveTheta = t.theta[3] - t.momentumGain;
    expect(Math.max(...Object.values(t.provocation.gain)) * shoveWeight).toBeLessThan(lowestShoveTheta);
  });

  it("a second counted line raises it further, but never past the cap", () => {
    const { l, advance } = ledger();
    const hit = (): void => void l.note(line("p1", "idiota", { addressees: ["p2"] }), heard("p2"));
    hit();
    advance(10_000);
    hit();
    const two = l.levelOf("p2", "p1");
    expect(two).toBeGreaterThan(DEFAULT_DRAMA_TUNING.provocation.gain.insult);
    for (let i = 0; i < 20; i++) {
      advance(10_000);
      hit();
    }
    expect(l.levelOf("p2", "p1")).toBe(DEFAULT_DRAMA_TUNING.provocation.cap);
    expect(DEFAULT_DRAMA_TUNING.provocation.cap).toBeLessThan(1);
  });

  it("two lines inside the minimum gap are one outburst: the second adds nothing", () => {
    const { l, advance } = ledger();
    l.note(line("p1", "idiota", { addressees: ["p2"] }), heard("p2"));
    advance(DEFAULT_DRAMA_TUNING.provocation.minGapMs - 1);
    expect(l.note(line("p1", "imbecil", { addressees: ["p2"] }), heard("p2"))).toBeUndefined();
    expect(l.levelOf("p2", "p1")).toBeLessThanOrEqual(DEFAULT_DRAMA_TUNING.provocation.gain.insult);
    expect(l.skipped).toBe(1);
    expect(l.raised.insult).toBe(1);
  });

  it("falls to zero over the window from the last counted line, and the pair then starts again from nothing", () => {
    const { l, advance } = ledger();
    l.note(line("p1", "idiota", { addressees: ["p2"] }), heard("p2"));
    const w = DEFAULT_DRAMA_TUNING.provocation.windowMs;
    advance(w / 2);
    expect(l.levelOf("p2", "p1")).toBeCloseTo(DEFAULT_DRAMA_TUNING.provocation.gain.insult / 2, 2);
    advance(w / 2);
    expect(l.levelOf("p2", "p1")).toBe(0);
    expect(l.offenders("p2")).toEqual([]);
    l.note(line("p1", "idiota", { addressees: ["p2"] }), heard("p2"));
    expect(l.levelOf("p2", "p1")).toBe(DEFAULT_DRAMA_TUNING.provocation.gain.insult);
  });

  it("a second provocation inside the window sums with what is left of the first; one after it does not", () => {
    const inside = ledger();
    inside.l.note(line("p1", "idiota", { addressees: ["p2"] }), heard("p2"));
    inside.advance(30_000);
    inside.l.note(line("p1", "imbecil", { addressees: ["p2"] }), heard("p2"));
    expect(inside.l.levelOf("p2", "p1")).toBeGreaterThan(0.8);
    const outside = ledger();
    outside.l.note(line("p1", "idiota", { addressees: ["p2"] }), heard("p2"));
    outside.advance(DEFAULT_DRAMA_TUNING.provocation.windowMs + 1);
    outside.l.note(line("p1", "imbecil", { addressees: ["p2"] }), heard("p2"));
    expect(outside.l.levelOf("p2", "p1")).toBe(DEFAULT_DRAMA_TUNING.provocation.gain.insult);
  });

  it("a bet and a laugh count for less than an insult, and one of them alone is under what a glare needs", () => {
    const { l } = ledger();
    l.note(line("p1", "aposto 200 que você não tem coragem", { addressees: ["p2"] }), heard("p2"));
    expect(l.levelOf("p2", "p1")).toBe(DEFAULT_DRAMA_TUNING.provocation.gain.challenge);
    expect(DEFAULT_DRAMA_TUNING.provocation.gain.challenge).toBeLessThan(DEFAULT_DRAMA_TUNING.theta[1]);
    expect(DEFAULT_DRAMA_TUNING.provocation.gain.mockery).toBeLessThan(DEFAULT_DRAMA_TUNING.theta[1]);
  });

  it("only the pairs the scenario lets: an observer who may not target the speaker is not provoked; a human or a stranger never is", () => {
    const { l } = ledger((o, s) => o === "p2" && s === "p1");
    l.note(line("p1", "idiota", { addressees: ["p2"] }), heard("p2"));
    expect(l.levelOf("p2", "p1")).toBeGreaterThan(0);
    l.note(line("p2", "idiota", { addressees: ["p1"] }), heard("p1"));
    expect(l.levelOf("p1", "p2")).toBe(0);
    l.note(line("p1", "idiota, Ana", { mentioned: ["h:9"], addressees: ["h:9"] }), [{ ref: "h:9", heard: true }]);
    expect(l.levelOf("h:9", "p1")).toBe(0);
    expect(l.skipped).toBeGreaterThanOrEqual(2);
  });

  it("a scene cut starts the cast fresh", () => {
    const { l } = ledger();
    l.note(line("p1", "idiota", { addressees: ["p2"] }), heard("p2"));
    l.clear();
    expect(l.levelOf("p2", "p1")).toBe(0);
  });
});

describe("what the ladder makes of a provocation (rel.provocation)", () => {
  const calm = emotion({}, { relation: { resentment: 0, lastNegativeAt: null } });
  const provoked = (level: number) => {
    const e = emotion({}, { relation: { resentment: 0, lastNegativeAt: null, provocation: level } });
    return e;
  };
  const m = (verb: "glare" | "insult" | "shove" | "slap" | "punch" | "kill", level: number) => {
    const e = provoked(level);
    return motive(verb, e, e.relations!.get(B), 0, DEFAULT_DRAMA_TUNING);
  };

  it("with no provocation and no feeling nothing is driven (the production runs' motive refusals)", () => {
    for (const verb of ["glare", "insult", "shove"] as const) expect(motive(verb, calm, calm.relations!.get(B), 0, DEFAULT_DRAMA_TUNING)).toMatchObject({ ok: false });
  });

  it("one line's level drives a glare, may drive an insult, and never a shove", () => {
    const one = DEFAULT_DRAMA_TUNING.provocation.gain.insult;
    expect(m("glare", one).ok).toBe(true);
    expect(m("shove", one)).toMatchObject({ ok: false, why: "volition" });
    expect(m("slap", one).ok).toBe(false);
  });

  it("a second line's level drives a shove, and still not a slap, a punch or a kill", () => {
    const two = 0.85;
    expect(m("shove", two).ok).toBe(true);
    for (const verb of ["slap", "punch", "kill"] as const) expect(m(verb, DEFAULT_DRAMA_TUNING.provocation.cap).ok, verb).toBe(false);
  });

  it("opens the grievance for the first rungs only: an insult or a shove, not a slap", () => {
    const e = emotion({ dominanceAssertion: 1, impulsiveProvocation: 1 }, { relation: { resentment: 0, lastNegativeAt: null, provocation: 0.5 } });
    const r = e.relations!.get(B);
    expect(motive("insult", e, r, 0, DEFAULT_DRAMA_TUNING).ok).toBe(true);
    expect(motive("shove", e, r, 0, DEFAULT_DRAMA_TUNING).ok).toBe(true);
    // The volition is there for a slap (dominance), and the grievance is not: a slap still needs a real resentment.
    expect(motive("slap", e, r, 0, DEFAULT_DRAMA_TUNING)).toMatchObject({ ok: false, why: "grievance" });
  });

  it("is data: a provocation under grievanceAt is no grievance, and the tuning can raise the bar", () => {
    const e = emotion({ impulsiveProvocation: 1 }, { relation: { resentment: 0, lastNegativeAt: null, provocation: 0.2 } });
    expect(motive("insult", e, e.relations!.get(B), 0, DEFAULT_DRAMA_TUNING)).toMatchObject({ ok: false, why: "grievance" });
  });

  it("the director approves a model's glare at someone who provoked it and refuses the same glare, with detail motive, when nobody did", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    const cold = emotion({}, { relation: { resentment: 0, lastNegativeAt: null } });
    expect(rig.dir.decide({ actor: A, proposal: { verb: "glare", with: B, origin: "model" }, emotion: cold })).toMatchObject({ kind: "veto", reason: "ladder", detail: "motive" });
    const heated = emotion({}, { relation: { resentment: 0, lastNegativeAt: null, provocation: 0.5 } });
    expect(rig.dir.decide({ actor: A, proposal: { verb: "glare", with: B, origin: "model" }, emotion: heated })).toMatchObject({ kind: "approve", verb: "glare" });
    // One rung at a time still holds: a second provocation's level is motive enough for a shove, but not for skipping the glare and the insult.
    const twice = emotion({}, { relation: { resentment: 0, lastNegativeAt: null, provocation: 0.85 } });
    expect(makeRig({ block: WIDE_BLOCK }).dir.decide({ actor: A, proposal: { verb: "shove", with: B, origin: "model" }, emotion: twice })).toMatchObject({ kind: "veto", reason: "ladder", detail: "rung" });
  });
});
