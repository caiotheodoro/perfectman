/**
 * The sim's seams for staging a live run (errata P9): a scripted model (`model`), the run's idle sweep (`sweep`), the spine's grants put back at their seconds (`grants`), feelings that
 * move (`drift`), several actors that walk on their own (`ownWalk` as a list), and the run's decision log in the result (`dramaLog`). Each is off by default and changes nothing then.
 */
import { defaultSceneDrama } from "@perfectman/hotel/drama";
import { describe, expect, it } from "vitest";
import { runDramaSim } from "../embodiment/drama-sim.js";
import type { SimConfig } from "../embodiment/drama-sim.js";
import { seedState } from "../embodiment/sim-states.js";

const REFS = ["person-1", "person-2", "person-3"];
const NAMES = ["Heloísa", "Otávio", "Renato"];

function cast(o: Partial<SimConfig> = {}): SimConfig {
  return {
    title: "seams",
    seed: 3,
    durationMs: 120_000,
    consultMs: 21_000,
    actors: REFS.map((ref, i) => ({ ref, name: NAMES[i]! })),
    states: new Map(REFS.map((ref) => [ref, seedState(ref, { simulationId: "cold", others: REFS })])),
    drama: defaultSceneDrama(REFS)!,
    dramaMode: "default",
    speechOnly: true,
    ...o,
  };
}

/** The consults a log line stands for: itself and the identical ones the writer dropped before it. */
const consultsOf = (r: ReturnType<typeof runDramaSim>, actor: string, kind: string): number => r.dramaLog.filter((l) => l.actor === actor && l.kind === kind).reduce((n, l) => n + 1 + (l.same ?? 0), 0);

describe("the decision log in the result", () => {
  it("is the run's drama-log.jsonl lines, in order, from the sim's start", () => {
    const r = runDramaSim(cast());
    expect(r.dramaLog.length).toBeGreaterThan(0);
    for (const l of r.dramaLog) expect(Object.keys(l)).toEqual(expect.arrayContaining(["t_ms", "actor", "kind", "unlocked", "queue", "hold", "result"]));
    expect(r.dramaLog.map((l) => l.t_ms)).toEqual([...r.dramaLog.map((l) => l.t_ms)].sort((a, b) => a - b));
  });
});

describe("the scripted model", () => {
  it("what it answers is the block the consult plans with: a glare it proposes is a proposal of the director's, with the verb and the target", () => {
    const r = runDramaSim(cast({ model: ({ ref, handleOf }) => (ref === "person-3" && handleOf("person-2") ? { act: { verb: "glare", target: handleOf("person-2")! } } : undefined) }));
    const mine = r.proposals.filter((p) => p.actor === "person-3");
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((p) => p.verb === "glare" && p.with === "person-2")).toBe(true);
    expect(r.proposals.some((p) => p.actor !== "person-3" && p.decision === "proposed")).toBe(false);
  });
});

describe("the idle sweep", () => {
  it("asks the director at the pulse's pace and not only at the model's turn: about three times the consults for the same actor", () => {
    const base = runDramaSim(cast());
    const swept = runDramaSim(cast({ sweep: { everyMs: 7000 } }));
    const a = consultsOf(base, "person-1", "originate");
    const b = consultsOf(swept, "person-1", "originate");
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThanOrEqual(a * 2);
  });
});

describe("the spine's grants", () => {
  it("are put back at their second: counted as a grant, and the aggressor's lines say it holds the unlock from then on", () => {
    const r = runDramaSim(cast({ sweep: { everyMs: 7000 }, grants: [{ atMs: 40_000, level: "shove", aggressor: "person-3", target: "person-2" }] }));
    expect(r.counters["spine_unlock_shove"]).toBe(1);
    const mine = r.dramaLog.filter((l) => l.actor === "person-3");
    expect(mine.filter((l) => l.t_ms < 40_000).every((l) => l.unlock === undefined)).toBe(true);
    // The grant lasts 90 s and ends with the blow it opened; it is open at the first consult after it.
    expect(mine.filter((l) => l.t_ms >= 41_000 && l.t_ms < 70_000).length).toBeGreaterThan(0);
    expect(mine.filter((l) => l.t_ms >= 41_000 && l.t_ms < 70_000).every((l) => l.unlock === "person-3>person-2@3")).toBe(true);
  });

  it("only for a pair the scenario lets: a restrictive block opens nothing for a pair outside it", () => {
    const r = runDramaSim(cast({ drama: { max_rung: 4, may_target: [["person-1", "person-2"]], may_die: [], permadeath: false }, dramaMode: undefined, grants: [{ atMs: 40_000, level: "shove", aggressor: "person-3", target: "person-2" }] }));
    expect(r.counters["spine_unlock_shove"]).toBeUndefined();
  });
});

describe("feelings that move", () => {
  it("are asked at every consult with the actor and the time, and what they return is the state the consult plans with", () => {
    const seen: Array<[string, number]> = [];
    runDramaSim(cast({ drift: (ref, state, atMs) => (seen.push([ref, atMs]), state) }));
    expect(new Set(seen.map(([ref]) => ref))).toEqual(new Set(REFS));
    expect(seen.length).toBeGreaterThanOrEqual(15);
    expect(Math.max(...seen.map(([, at]) => at))).toBeLessThanOrEqual(120_000);
  });
});

describe("own walks of several actors", () => {
  it("a list of one is the single walker it was: the same run", () => {
    const one = { actor: "person-2", everyMs: [20_000, 30_000] as const };
    const a = runDramaSim(cast({ ownWalk: one }));
    const b = runDramaSim(cast({ ownWalk: [one] }));
    expect(JSON.stringify(b.lines.map((l) => l.frame))).toBe(JSON.stringify(a.lines.map((l) => l.frame)));
  });

  it("each walks on its own clock: an own-walk turn carries no feelings, and the log says so for the one that has it", () => {
    const w = (actor: string) => ({ actor, everyMs: [15_000, 25_000] as const });
    const one = runDramaSim(cast({ ownWalk: [w("person-1")] }));
    const two = runDramaSim(cast({ ownWalk: [w("person-1"), w("person-2")] }));
    expect(consultsOf(one, "person-1", "skip")).toBeGreaterThanOrEqual(3);
    expect(consultsOf(one, "person-2", "skip")).toBe(0);
    expect(consultsOf(two, "person-2", "skip")).toBeGreaterThanOrEqual(3);
  });
});
