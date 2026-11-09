import { describe, expect, it } from "vitest";
import type { AgentState, RelationalState } from "@perfectman/shared";
import { makeAgent, makeRelational } from "../../__tests__/fixtures.js";
import { deathTone, rememberAct, rememberDeath, witnessWeight } from "../act-memory.js";

const NAMES = { ana: "Ana", bia: "Bia", caro: "Caro", duda: "Duda" };
const NOW = 5_000;

function stateOf(id: string, rels: Record<string, Partial<RelationalState>> = {}): AgentState {
  return makeAgent({ agentId: id, relationalStates: new Map(Object.entries(rels).map(([k, v]) => [k, makeRelational({ targetAgentId: k, ...v })])) });
}

const slap = { actId: "a1", verb: "slap", actor: "ana", target: "bia", witnesses: ["caro"], names: NAMES, lang: "en" as const };
const kill = { actId: "a2", victim: "bia", killer: "ana", cause: "kill" as const, witnesses: ["caro", "duda"], names: NAMES, lang: "en" as const };

describe("act memory: what the people in a landed act keep (REA-8, MEM-1)", () => {
  it("[REA-8] writes the verb's own event for the aggressor, the victim and a witness, each from its own side", () => {
    const aggressor = rememberAct(stateOf("ana"), slap, "actor", { event: "aggressor", tone: "hostile" }, NOW);
    const victim = rememberAct(stateOf("bia"), slap, "target", { event: "victim", tone: "hurt" }, NOW);
    const witness = rememberAct(stateOf("caro"), slap, "witness", { event: "witnessed", tone: "shocked" }, NOW);
    expect(aggressor.memories.map((m) => [m.summary, m.emotionalTone, m.subjectAgentIds])).toEqual([["I slapped Bia.", "hostile", ["bia"]]]);
    expect(victim.memories.map((m) => [m.summary, m.emotionalTone, m.unresolved])).toEqual([["Ana slapped me.", "hurt", true]]);
    expect(witness.memories.map((m) => [m.summary, m.emotionalTone])).toEqual([["I saw Ana slap Bia.", "shocked"]]);
  });

  it("[REA-8] writes nothing for an event of none, and speaks the run's language", () => {
    expect(rememberAct(stateOf("caro"), slap, "witness", { event: "none", tone: "neutral" }, NOW).memories).toEqual([]);
    const pt = rememberAct(stateOf("caro"), { ...slap, lang: "pt-BR" }, "witness", { event: "witnessed", tone: "shocked" }, NOW);
    expect(pt.memories[0]?.summary).toBe("Vi Ana dar um tapa em Bia.");
  });

  it("[REA-8] weighs a witness's memory by its affection to the victim: a friend's weighs more and moves its view of the aggressor more", () => {
    const stranger = stateOf("caro");
    const friend = stateOf("caro", { bia: { affection: 0.9, comfort: 0.8 }, ana: { threat: 0 } });
    expect(witnessWeight(friend, "bia")).toBeGreaterThan(witnessWeight(stranger, "bia"));
    const a = rememberAct(stranger, slap, "witness", { event: "witnessed", tone: "shocked" }, NOW);
    const b = rememberAct(friend, slap, "witness", { event: "witnessed", tone: "shocked" }, NOW);
    expect(b.memories[0]!.intensity).toBeGreaterThan(a.memories[0]!.intensity);
    expect(b.relationalStates.get("ana")!.trust).toBeLessThan(a.relationalStates.get("ana")!.trust);
  });

  it("[REA-8] a victim comes away resentful, wary and further away from the aggressor; the aggressor only notes it", () => {
    const victim = rememberAct(stateOf("bia", { ana: { trust: 0.4, resentment: 0, threat: 0, desireForDistance: 0.1 } }), slap, "target", { event: "victim", tone: "hurt" }, NOW);
    const view = victim.relationalStates.get("ana")!;
    expect(view.trust).toBeLessThan(0.4);
    expect(view.resentment).toBeGreaterThan(0);
    expect(view.threat).toBeGreaterThan(0);
    expect(view.lastNegativeAt).toBe(NOW);
    const aggressor = rememberAct(stateOf("ana"), slap, "actor", { event: "aggressor", tone: "hostile" }, NOW);
    expect(aggressor.relationalStates.get("bia")!.resentment).toBe(0);
  });

  it("[REA-8] an affectionate act is remembered warmly and draws the two together", () => {
    const hug = { actId: "a3", verb: "hug", actor: "ana", target: "bia", witnesses: [], names: NAMES, lang: "en" as const };
    const got = rememberAct(stateOf("bia", { ana: { affection: 0.2, comfort: 0.2, trust: 0 } }), hug, "target", { event: "receiver", tone: "tender" }, NOW);
    expect(got.memories[0]).toMatchObject({ summary: "Ana hugged me.", emotionalTone: "tender", unresolved: false });
    expect(got.relationalStates.get("ana")).toMatchObject({ lastPositiveAt: NOW });
    expect(got.relationalStates.get("ana")!.affection).toBeGreaterThan(0.2);
  });

  it("[MEM-1] is idempotent: the same act frame twice writes one memory and moves the relationship once", () => {
    const once = rememberAct(stateOf("bia"), slap, "target", { event: "victim", tone: "hurt" }, NOW);
    const twice = rememberAct(once, slap, "target", { event: "victim", tone: "hurt" }, NOW + 1000);
    expect(twice.memories).toHaveLength(1);
    expect(twice).toBe(once);
  });
});

describe("death memory: the strongest event (DEATH-4)", () => {
  it("[DEATH-4] reads a death by what the witness felt before: grief for someone it loved, anger at a killer it already resented, fear otherwise", () => {
    expect(deathTone(stateOf("caro", { bia: { affection: 0.8, comfort: 0.7 } }), "bia", "ana")).toBe("grief");
    expect(deathTone(stateOf("caro", { ana: { resentment: 0.6 }, bia: { affection: 0.1, comfort: 0.1 } }), "bia", "ana")).toBe("anger");
    expect(deathTone(stateOf("caro", { bia: { affection: 0.1, comfort: 0.1 } }), "bia", "ana")).toBe("fear");
  });

  it("[DEATH-4] a witness who loved the victim grieves, blames the killer and longs for the dead", () => {
    const before = stateOf("caro", { bia: { affection: 0.9, comfort: 0.8, desireForCloseness: 0.3 }, ana: { trust: 0.3, resentment: 0, threat: 0 } });
    const after = rememberDeath(before, kill, NOW);
    expect(after.memories).toHaveLength(1);
    expect(after.memories[0]).toMatchObject({ type: "episodic", emotionalTone: "grief", unresolved: true, summary: "I saw Bia die at the hands of Ana.", subjectAgentIds: ["bia", "ana"] });
    expect(after.memories[0]!.intensity).toBeGreaterThan(0.9);
    const toKiller = after.relationalStates.get("ana")!;
    expect(toKiller.trust).toBeLessThan(0.3);
    expect(toKiller.resentment).toBeGreaterThan(0.2);
    expect(after.relationalStates.get("bia")!.desireForCloseness).toBeGreaterThan(0.3);
  });

  it("[DEATH-4] a stranger who saw a killing is afraid of the killer and keeps its distance", () => {
    const before = stateOf("duda", { ana: { threat: 0.1, desireForDistance: 0.1 } });
    const after = rememberDeath(before, kill, NOW);
    expect(after.memories[0]!.emotionalTone).toBe("fear");
    const view = after.relationalStates.get("ana")!;
    expect(view.threat).toBeGreaterThan(0.3);
    expect(view.desireForDistance).toBeGreaterThan(0.25);
    expect(view.lastNegativeAt).toBe(NOW);
  });

  it("[DEATH-4] a witness who knew nobody still gets a memory, and learns about a killer it had no view of", () => {
    const after = rememberDeath(stateOf("duda"), kill, NOW);
    expect(after.memories).toHaveLength(1);
    expect(after.relationalStates.has("ana")).toBe(true);
  });

  it("[DEATH-4] the victim and the killer remember it too, each their own way", () => {
    const victim = rememberDeath(stateOf("bia"), kill, NOW);
    const killer = rememberDeath(stateOf("ana"), kill, NOW);
    expect(victim.memories[0]).toMatchObject({ summary: "Ana killed me.", emotionalTone: "grief", intensity: 1 });
    expect(killer.memories[0]).toMatchObject({ summary: "I killed Bia.", emotionalTone: "hostile" });
    expect(victim.relationalStates.get("ana")!.resentment).toBeGreaterThan(0);
  });

  it("[DEATH-4] a standalone die has no killer and nobody to blame", () => {
    const die = { actId: "a4", victim: "bia", cause: "die" as const, witnesses: ["caro"], names: NAMES, lang: "en" as const };
    const after = rememberDeath(stateOf("caro", { bia: { affection: 0.7 } }), die, NOW);
    expect(after.memories[0]!.summary).toBe("I saw Bia die.");
    expect([...after.relationalStates.keys()]).toEqual(["bia"]);
  });

  it("[DEATH-4] is idempotent on the act and the memory outlives a revive: nothing in a second frame removes or repeats it", () => {
    const once = rememberDeath(stateOf("caro"), kill, NOW);
    const again = rememberDeath(once, kill, NOW + 60_000);
    expect(again).toBe(once);
    expect(again.memories.filter((m) => m.unresolved)).toHaveLength(1);
  });
});
