import { describe, expect, it } from "vitest";
import { ACT_VERBS, ladderRung } from "../space/act-verbs.js";
import { repairBeats } from "../live/draft-beats.js";
import { roomFiles } from "../live/room-files.js";

const CAST = ["Dalila", "Rocha", "Kleber"];
const act = (at: number, actor: string, verb: string, target?: string, extra: Record<string, unknown> = {}) => ({ at, actor, verb, ...(target ? { with: target } : {}), ...extra });

describe("repairBeats keeps a scene the loader and the ladder accept", () => {
  it("turns a kiss into a drama block of rung 0 with no pairs and nobody who may die", () => {
    const { beats, drama, repairs } = repairBeats([act(20, "Dalila", "insult", "Rocha"), act(60, "Rocha", "kiss", "Dalila"), act(90, "Kleber", "freeze_gasp")], CAST);
    expect(beats.map((b) => b.verb)).toEqual(["insult", "kiss", "freeze_gasp"]);
    expect(drama).toEqual({ max_rung: 2, may_target: [], may_die: [], permadeath: false });
    expect(repairs).toEqual([]);
    expect(repairBeats([act(30, "Dalila", "kiss", "Rocha")], CAST).drama).toEqual({ max_rung: 0, may_target: [], may_die: [], permadeath: false });
  });

  it("derives the smallest block for a kill: max_rung 6, the one pair, the victim, permadeath, and a cut after the death", () => {
    const { beats, drama } = repairBeats([act(20, "Rocha", "insult", "Dalila"), act(55, "Dalila", "glare", "Rocha"), act(115, "Dalila", "kill", "Rocha")], CAST, "pt-BR");
    expect(drama).toEqual({ max_rung: 6, may_target: [["Dalila", "Rocha"]], may_die: ["Rocha"], permadeath: true });
    expect(beats.at(-2)).toMatchObject({ verb: "kill", skip: true });
    expect(beats.at(-1)).toEqual({ at: 145, cut: "fim da cena" });
    expect(beats.filter((b) => b.skip)).toHaveLength(1);
  });

  it("climbs one rung per beat without a skip, and lets only the peak jump", () => {
    const climb = repairBeats([act(20, "Rocha", "insult", "Dalila"), act(50, "Rocha", "shove", "Dalila"), act(80, "Rocha", "slap", "Dalila")], CAST);
    expect(climb.beats.some((b) => b.skip)).toBe(false);
    const jump = repairBeats([act(20, "Rocha", "insult", "Dalila"), act(50, "Rocha", "punch", "Dalila"), act(80, "Rocha", "kill", "Dalila")], CAST);
    expect(jump.beats.map((b) => b.verb)).toEqual(["insult", "kill", undefined]);
    expect(jump.repairs.join(" ")).toMatch(/punch at 50s skips the ladder and is not the peak/);
    expect(jump.beats.find((b) => b.verb === "kill")?.skip).toBe(true);
  });

  it("drops a second death and keeps the first", () => {
    const { beats, drama, repairs } = repairBeats([act(20, "Dalila", "insult", "Rocha"), act(60, "Dalila", "kill", "Rocha"), act(120, "Rocha", "kill", "Kleber"), act(150, "Kleber", "die")], CAST);
    expect(beats.filter((b) => b.verb === "kill" || b.verb === "die")).toHaveLength(1);
    expect(drama?.may_die).toEqual(["Rocha"]);
    expect(repairs.filter((r) => r.includes("second death"))).toHaveLength(2);
  });

  it("moves a physical beat that is under 20 s after the last one, and drops it when a cut stands in the way", () => {
    const moved = repairBeats([act(20, "Rocha", "insult", "Dalila"), act(40, "Rocha", "shove", "Dalila"), act(50, "Rocha", "slap", "Dalila")], CAST);
    expect(moved.beats.map((b) => [b.verb, b.at])).toEqual([["insult", 20], ["shove", 40], ["slap", 60]]);
    const blocked = repairBeats([act(20, "Rocha", "insult", "Dalila"), act(40, "Rocha", "shove", "Dalila"), act(50, "Rocha", "slap", "Dalila"), { at: 55, cut: "fim" }], CAST);
    expect(blocked.beats.map((b) => b.verb)).toEqual(["insult", "shove", undefined]);
  });

  it("drops what the loader would reject: @human, an unknown verb, a stranger, a missing or extra target, a self-aim", () => {
    const { beats, repairs } = repairBeats(
      [
        act(20, "Rocha", "kill", "@human"),
        act(25, "@human", "slap", "Rocha"),
        act(30, "Rocha", "stab", "Dalila"),
        act(35, "Rocha", "insult", "Fulano"),
        act(40, "Fulano", "insult", "Rocha"),
        act(45, "Rocha", "insult"),
        act(50, "Rocha", "insult", "Rocha"),
        act(55, "Rocha", "recoil", "Dalila"),
        { at: "soon", actor: "Rocha", verb: "glare", with: "Dalila" },
        "nonsense",
      ],
      CAST,
    );
    expect(beats).toEqual([{ at: 55, actor: "Rocha", verb: "recoil" }]);
    expect(repairs.length).toBeGreaterThanOrEqual(9);
  });

  it("never lets a verb outside the 18 through, and every beat it returns is one the loader reads", () => {
    const fuzz = [...ACT_VERBS, "stab", "shoot", "KISS", "freeze gasp", "turn-back", "", "kill; drop table"].flatMap((verb, i) => [act(15 + i * 21, "Dalila", verb, "Rocha"), act(16 + i * 21, "Rocha", verb)]);
    const { beats } = repairBeats(fuzz, CAST);
    for (const beat of beats) if (beat.verb !== undefined) expect(ACT_VERBS as readonly string[]).toContain(beat.verb);
    expect(beats.filter((b) => b.verb === "kill" || b.verb === "die").length).toBeLessThanOrEqual(1);
  });

  it("moves a first beat before 15 s to 15 s, caps the script, and returns nothing for no list or no act", () => {
    expect(repairBeats([act(2, "Rocha", "insult", "Dalila")], CAST).beats[0]!.at).toBe(15);
    expect(repairBeats(Array.from({ length: 40 }, (_, i) => act(15 + i, "Dalila", "glare", "Rocha")), CAST).beats.length).toBeLessThanOrEqual(12);
    expect(repairBeats(undefined, CAST)).toEqual({ beats: [], repairs: [] });
    expect(repairBeats("x", CAST).beats).toEqual([]);
    expect(repairBeats([{ at: 30, cut: "fim" }], CAST).beats).toEqual([]);
    expect(repairBeats([act(30, "Rocha", "kill", "Dalila"), { at: 20, cut: "x".repeat(80) }], CAST).beats.find((b) => b.cut !== undefined && b.at === 20)?.cut).toHaveLength(40);
  });

  it("is idempotent: repairing a repaired script changes nothing", () => {
    const messy = [act(2, "Rocha", "insult", "Dalila"), act(10, "Rocha", "shove", "Dalila"), act(15, "Rocha", "slap", "Dalila"), act(40, "Dalila", "kill", "Rocha"), act(41, "Kleber", "kill", "Dalila"), act(90, "Kleber", "tableau")];
    const once = repairBeats(messy, CAST);
    const twice = repairBeats(once.beats, CAST);
    expect(twice.beats).toEqual(once.beats);
    expect(twice.drama).toEqual(once.drama);
    expect(twice.repairs).toEqual([]);
  });

  it("matches names the way the compiler does: case and spacing do not matter", () => {
    expect(repairBeats([act(20, "  rocha ", "insult", "DALILA")], CAST).beats).toEqual([{ at: 20, actor: "Rocha", verb: "insult", with: "Dalila" }]);
    expect(ladderRung("insult")).toBe(2);
  });
});

describe("roomFiles writes the script into the scenario", () => {
  const people = CAST.map((name) => ({ name, role: "connector" as const, goal: "Pass the night." }));

  it("writes drama and beats by agent id, and opens the pair of a contact beat standing side by side", () => {
    const { scenario } = roomFiles({ title: "O livro-caixa", situation: "Uma sala.", language: "pt-BR", people, beats: [act(20, "Rocha", "insult", "Dalila"), act(115, "Dalila", "kill", "Rocha")] });
    expect(scenario.text).toContain('drama: {"max_rung":6,"may_target":[["person-1","person-2"]],"may_die":["person-2"],"permadeath":true}');
    expect(scenario.text).toContain('{"at":115,"actor":"person-1","verb":"kill","with":"person-2","skip":true}');
    expect(scenario.text).toContain('{"at":145,"cut":"fim da cena"}');
    expect(scenario.text).toMatch(/Dalila e Rocha começam de pé, lado a lado\./);
  });

  it("writes nothing for a draft without a script, so free play stays free play", () => {
    expect(roomFiles({ title: "A", situation: "B", people }).scenario.text).not.toMatch(/drama|beats/);
    expect(roomFiles({ title: "A", situation: "B", people, beats: [act(20, "Rocha", "stab", "Dalila")] }).scenario.text).not.toMatch(/drama|beats/);
  });

  it("refuses a thirteenth person", () => {
    expect(() => roomFiles({ title: "A", situation: "B", people: Array.from({ length: 13 }, (_, i) => ({ name: `P${i}`, role: "connector" as const, goal: "g" })) })).toThrow(/between two and 12/);
  });

  it("carries standing as manner and an obstacle with a method as one trigger, with no label in the persona", () => {
    const { personas } = roomFiles({ title: "A", situation: "B", language: "pt-BR", people: [{ ...people[0]!, standing: "low", flips: true, obstacle: "Ele vira as costas", method: "insiste, mais perto" }, people[1]!] });
    expect(personas[0]!.text).toContain("Fala depressa, perde a frase no meio");
    expect(personas[0]!.text).toContain("Quando acha o chão");
    expect(personas[0]!.text).toContain('trigger: "Ele vira as costas"');
    expect(personas[0]!.text).not.toMatch(/status|tactic|standing/i);
  });
});
