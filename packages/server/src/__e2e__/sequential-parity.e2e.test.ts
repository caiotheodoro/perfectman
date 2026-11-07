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
import { buildBrunoCaioExclusionScenario } from "@perfectman/shared";
import { SimulationHarness } from "./harness.js";

const PULSES = 8;
/** sha256 of the digest lines of the pre-integration run. */
const PRE_INTEGRATION_DIGEST = "5d8425e5b02a9623e25a507fc4de5ad54c34302f82871e690364afe95b5c94de";
const PRE_INTEGRATION_EVENT_COUNT = 41;

describe("sequential pulse parity (no hotel options)", () => {
  it("a seeded mock scenario commits the same events as before the hotel integration", async () => {
    const scenario = buildBrunoCaioExclusionScenario();
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
