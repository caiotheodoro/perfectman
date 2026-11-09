/**
 * Issue #262: a scene's prior hostile messages are the cause of the grievance the drama director's motive gate (LAD-6) asks for. The
 * run's seed seam has to leave it in the actors' relational state, or a model that only talks never gets a beat started from emotion.
 */
import { describe, expect, it } from "vitest";
import type { AgentState } from "@perfectman/shared";
import { relationalStateFromFamiliarity } from "../../../authoring/relational-seeding.js";
import type { RunSeeds } from "../../../authoring/assemble-config.js";
import { applySeeds } from "../seed-applier.js";
import type { SeedTarget } from "../seed-applier.js";

const NEUTRAL_SOCIAL = { jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0, resentment: 0, suspicion: 0, admiration: 0, contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0 };
const NEUTRAL_MOOD = { valence: 0, arousal: 0.5, stability: 0.8, energy: 0.6, circumplexAngle: 0, circumplexRadius: 0.5, momentumValence: 0, momentumArousal: 0 };

const quiet = (ref: string, others: string[]): AgentState => ({
  agentId: ref, simulationId: "s", personaId: ref, presence: "active", coreMood: NEUTRAL_MOOD, socialEmotions: NEUTRAL_SOCIAL,
  relationalStates: new Map(others.map((o) => [o, relationalStateFromFamiliarity(o, "acquaintances")])),
  memories: [], initiativeAccumulators: [], lastProcessedEventId: null, lastActionAt: null, lastRuminationPulse: null, arrivalPulse: null, createdAt: 1, updatedAt: 1,
});

function fakeHandle(refs: string[]): { handle: SeedTarget; states: Map<string, AgentState> } {
  const states = new Map(refs.map((r) => [r, quiet(r, refs.filter((x) => x !== r))]));
  const handle: SeedTarget = {
    simulationId: "s",
    repositories: {
      agentStateRepo: { get: async (_sim, id) => states.get(id) ?? null, upsert: async (s) => void states.set(s.agentId, s) },
      eventRepo: { append: async () => undefined },
    },
  };
  return { handle, states };
}

const seeds = (events: RunSeeds["priorEvents"]): RunSeeds => ({ memoriesByAgent: {}, priorEvents: events });
const said = (tone: string, minutesAgo: number, actorId = "ricardo", targets = ["beatriz"]) => ({
  type: "message", actorId, channelId: "salao", pulseIndex: 0, minutesAgo, payload: { content: "...", tone, personTargets: targets },
});

describe("applySeeds: the grievance a scene's prior messages leave", () => {
  it("[LAD-6] the one betrayed and insulted before the run holds a grievance toward the speaker, stamped inside the director's 300 s window", async () => {
    const { handle, states } = fakeHandle(["beatriz", "ricardo", "sofia"]);
    const before = Date.now();
    await applySeeds(handle, seeds([said("betrayal", 3), said("hostile", 2)]));
    const rel = states.get("beatriz")!.relationalStates.get("ricardo")!;
    expect(rel.resentment).toBeGreaterThanOrEqual(0.5);
    expect(rel.lastNegativeAt).not.toBeNull();
    expect(Date.now() - rel.lastNegativeAt!).toBeLessThanOrEqual(300_000 - 100_000);
    expect(rel.lastNegativeAt!).toBeLessThanOrEqual(before - 100_000);
  });

  it("nobody else's feelings move, and a scene whose messages carry no tone leaves every state as it was", async () => {
    const { handle, states } = fakeHandle(["beatriz", "ricardo", "sofia"]);
    await applySeeds(handle, seeds([said("betrayal", 3)]));
    expect(states.get("sofia")!.relationalStates.get("ricardo")!.resentment).toBe(0);
    expect(states.get("ricardo")!.relationalStates.get("beatriz")!.resentment).toBe(0);

    const plain = fakeHandle(["beatriz", "ricardo"]);
    const untouched = plain.states.get("beatriz");
    await applySeeds(plain.handle, seeds([{ ...said("hostile", 2), payload: { content: "oi" } }]));
    expect(plain.states.get("beatriz")).toBe(untouched);
  });
});
