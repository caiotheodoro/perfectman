/**
 * The five telenovela presets (examples/presets/scenes) read as sims: their `drama` blocks, their casts, their grievances and their authored beats.
 */
import { describe, expect, it } from "vitest";
import type { AgentState } from "@perfectman/shared";
import { DRAMA_PRESETS, appraise, presetSimConfig } from "../embodiment/drama-sim-preset.js";
import type { PriorEvent } from "../embodiment/drama-sim-preset.js";
import { seedState } from "../embodiment/sim-states.js";

const START = 1_000_000;
const refs = ["ana", "bia", "caio"];
const calm = (): Map<string, AgentState> => new Map(refs.map((r) => [r, seedState(r, { others: refs })]));
const hostile = (tone: string, minutesAgo = 2): PriorEvent => ({ actorId: "ana", minutesAgo, tone, targets: ["bia"] });

describe("appraise: what a scene's prior messages do to the people they were said to", () => {
  it("[LAD-6] a hostile message gives its target a grievance toward the speaker, stamped inside the director's 300 s window, and nobody else", () => {
    const out = appraise(calm(), [hostile("hostile")], START);
    const rel = out.get("bia")!.relationalStates.get("ana")!;
    expect(rel.resentment).toBeCloseTo(0.3);
    expect(rel.lastNegativeAt).toBe(START - 120_000);
    expect(START - rel.lastNegativeAt!).toBeLessThanOrEqual(300_000);
    expect(out.get("caio")!.relationalStates.get("ana")!.resentment).toBe(0);
    expect(out.get("ana")!.relationalStates.get("bia")!.resentment).toBe(0);
  });

  it("a betrayal is the deepest grievance, a humiliation lands on the target's own feelings, an accusation breeds suspicion, tenderness and romance warm", () => {
    const betrayed = appraise(calm(), [hostile("betrayal")], START).get("bia")!;
    expect(betrayed.relationalStates.get("ana")!.resentment).toBeCloseTo(0.5);
    expect(betrayed.relationalStates.get("ana")!.trust).toBeLessThan(0);
    expect(appraise(calm(), [hostile("humiliating")], START).get("bia")!.socialEmotions.humiliation).toBeCloseTo(0.5);
    expect(appraise(calm(), [hostile("accusing")], START).get("bia")!.relationalStates.get("ana")!.suspicion).toBeGreaterThan(0.3);
    expect(appraise(calm(), [hostile("tender")], START).get("bia")!.relationalStates.get("ana")!.affection).toBeCloseTo(0.5);
    const romance = appraise(calm(), [hostile("romantic")], START).get("bia")!.relationalStates.get("ana")!;
    expect(romance.attraction).toBeCloseTo(0.7);
    expect(romance.lastPositiveAt).toBe(START - 120_000);
  });

  it("an unknown tone changes nothing, and the states it was given are not edited in place", () => {
    const before = calm();
    const out = appraise(before, [hostile("sarcastic"), hostile("hostile")], START);
    expect(appraise(before, [hostile("sarcastic")], START).get("bia")!.relationalStates.get("ana")!.resentment).toBe(0);
    expect(before.get("bia")!.relationalStates.get("ana")!.resentment).toBe(0);
    expect(out.get("bia")!.relationalStates.get("ana")!.resentment).toBeCloseTo(0.3);
  });

  it("two hostile messages add up, and every value stays in range", () => {
    const out = appraise(calm(), [hostile("betrayal"), hostile("betrayal"), hostile("betrayal")], START).get("bia")!.relationalStates.get("ana")!;
    expect(out.resentment).toBe(1);
    expect(out.trust).toBeGreaterThanOrEqual(-1);
  });
});

describe("the five presets as sims", () => {
  it("[SCN-5] carry the drama blocks the scenes were written with, in agent ids", async () => {
    const block = async (id: string) => (await presetSimConfig(id)).drama;
    expect(await block("tapa-na-cara")).toEqual({ max_rung: 4, may_target: [["beatriz", "ricardo"]], may_die: [], permadeath: false });
    expect(await block("confronto-da-traicao")).toEqual({ max_rung: 5, may_target: [["beatriz", "ricardo"], ["ricardo", "otavio"]], may_die: [], permadeath: false });
    expect(await block("assassinato-na-festa")).toEqual({ max_rung: 6, may_target: [["ricardo", "otavio"]], may_die: ["otavio"], permadeath: false });
    expect(await block("reencontro-abraco")).toEqual({ max_rung: 0, may_target: [], may_die: [], permadeath: false });
    expect(await block("anuncio-do-desmaio")).toEqual({ max_rung: 2, may_target: [], may_die: [], permadeath: false });
  });

  it("each has a cast of three to five, named in Portuguese, and the feelings of every one of them", async () => {
    for (const id of DRAMA_PRESETS) {
      const c = await presetSimConfig(id);
      expect(c.actors.length).toBeGreaterThanOrEqual(3);
      expect(c.actors.length).toBeLessThanOrEqual(5);
      expect(c.states.size).toBe(c.actors.length);
      for (const a of c.actors) expect(c.states.get(a.ref)?.relationalStates.size).toBe(c.actors.length - 1);
    }
    expect((await presetSimConfig("assassinato-na-festa")).actors.map((a) => a.name)).toContain("Dona Helena");
  });

  it("[SCN-6] the one scene where someone may die authors its murder and the scene cut that follows it", async () => {
    const c = await presetSimConfig("assassinato-na-festa");
    expect(c.beats).toEqual([
      { id: "b1", at_ms: 90_000, kind: "act", actor: "ricardo", verb: "kill", with: "otavio", authored_skip: true },
      { id: "b2", at_ms: 170_000, kind: "cut", reason: "fim da festa" },
    ]);
    for (const id of DRAMA_PRESETS.filter((x) => x !== "assassinato-na-festa")) expect((await presetSimConfig(id)).drama?.may_die).toEqual([]);
  });

  it("the grievances the prior messages leave are what the ladder needs: the aggressor of each conflict scene holds a grievance toward the victim", async () => {
    for (const [id, who, toward] of [["tapa-na-cara", "beatriz", "ricardo"], ["confronto-da-traicao", "beatriz", "ricardo"], ["assassinato-na-festa", "ricardo", "otavio"]] as const) {
      const rel = (await presetSimConfig(id)).states.get(who)!.relationalStates.get(toward)!;
      expect(rel.resentment, `${id}: ${who} -> ${toward}`).toBeGreaterThanOrEqual(0.5);
      expect(rel.lastNegativeAt).not.toBeNull();
    }
  });

  it("[P4-02] the sim runs the sidecar's own default tuning: a preset names none", async () => {
    expect((await presetSimConfig("tapa-na-cara")).tuning).toBeUndefined();
    expect((await presetSimConfig("tapa-na-cara", { dramaOn: false })).dramaOn).toBe(false);
  });

  it("refuses a scene that is not a preset, naming the ones that are", async () => {
    await expect(presetSimConfig("nao-existe")).rejects.toThrow(/tapa-na-cara/);
  });
});
