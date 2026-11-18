/**
 * E2E - non-hotel parity. The hotel integration changed the scheduler, the
 * resolver, the delivery projection and the arbiter; a simulation built with
 * no `hotel` options must still produce exactly what it produced before.
 * The digest below was taken from the pre-integration commit (main at
 * 4a3585c) with this same scenario, seed and mock provider, so any drift in
 * the sequential path shows up here as a different hash.
 */
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { buildDarioTomasExclusionScenario } from "@perfectman/shared";
import { SimulationHarness } from "./harness.js";

const PULSES = 8;
/** sha256 of the digest lines of the pre-integration run. */
// Retaken after the persona rename (goulart -> vasco, etc.). The mock voices and the prompt examples are picked by a hash of the agent id,
// so renaming the fixture ids changes the committed events; the scenario, seed and provider are otherwise unchanged.
const PRE_INTEGRATION_DIGEST = "299d36678192d813b4d89d80d97c0ef174dd51fc8e23da162b452976ae450ab8";
const PRE_INTEGRATION_EVENT_COUNT = 41;

describe("sequential pulse parity (no hotel options)", () => {
  it("a seeded mock scenario commits the same events as before the hotel integration", async () => {
    const scenario = buildDarioTomasExclusionScenario();
    const harness = await SimulationHarness.create({
      simulation: { ...scenario.simulation, seed: 424242 },
      channels: scenario.channels,
      memberships: scenario.memberships,
      agentContexts: Object.keys(scenario.personas).map((id) => ({
        id,
        state: scenario.agentStates[id]!,
        persona: scenario.personas[id]!,
      })),
      priorEvents: scenario.committedEvents,
    });
    await harness.runPulses(PULSES);

    const events = await harness.getAllEvents();
    // Ids are minted per run (event ids from the clock, runtime-created channels at random): they are
    // renamed by order of first appearance, so everything that decides what happened is still compared.
    const known = new Set(scenario.channels.map((c) => c.id));
    const minted = events.filter((e) => e.type === "channel_created" && !known.has(e.channelId)).map((e) => e.channelId);
    const names = new Map<string, string>();
    const rename = (text: string): string => {
      let out = text.replace(/evt_\d+_[0-9a-z]+/g, (id) => {
        if (!names.has(id)) names.set(id, `evt#${names.size}`);
        return names.get(id)!;
      });
      for (const [i, id] of [...new Set(minted)].entries()) out = out.split(id).join(`chan#${i}`);
      return out;
    };
    const lines = events.map((e) =>
      rename(JSON.stringify([e.pulseIndex, e.type, e.actorId, e.channelId, e.emotionalSalience, e.visibility, e.payload])),
    );
    const states = await Promise.all(
      Object.keys(scenario.personas).map(async (id) => {
        const s = await harness.getAgentState(id);
        return JSON.stringify([id, s.coreMood, s.socialEmotions]);
      }),
    );
    const digest = createHash("sha256").update([...lines, ...states].join("\n")).digest("hex");

    expect(events.length).toBe(PRE_INTEGRATION_EVENT_COUNT);
    expect(digest).toBe(PRE_INTEGRATION_DIGEST);
  });
});
