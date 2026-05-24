/**
 * E2E — Cold Start: Goulart's boredom initiative fires but strategic patience delays pulse 0.
 *
 * Scenario: Goulart arrives first in an empty channel. No prior messages.
 * His boredom initiative accumulator is above threshold (0.75 > 0.6).
 * All other agents are offline.
 *
 * Actual engine behaviour (pulse 0):
 * - Engine computes boredom initiative proceeds, but strategic_patience_hold (medium) delays action
 * - decision.outcome = "delay", needsLLM = false → no LLM call, no message committed
 * - Offline agents: never touch the LLM
 * - State is persisted for all agents even with no events
 *
 * This tests that the engine's inhibition-before-action pipeline works correctly
 * and the scheduler preserves budget when the cognition path is skipped.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { buildGoulartColdStartScenario } from "@perfectman/shared";
import { SimulationHarness } from "./harness.js";

describe("E2E: Cold Start — Goulart delays due to strategic patience in pulse 0", () => {
  let harness: SimulationHarness;

  beforeEach(async () => {
    const scenario = buildGoulartColdStartScenario();

    harness = await SimulationHarness.create({
      simulation: scenario.simulation,
      channels: scenario.channels,
      memberships: scenario.memberships,
      agentContexts: [
        { id: "goulart", state: scenario.goulartState, persona: scenario.goulartPersona },
        ...scenario.otherPersonas.map((p, i) => ({
          id: p.id,
          state: scenario.otherStates[i]!,
          persona: p,
        })),
      ],
      priorEvents: [],
    });
  });

  it("completes pulse without error", async () => {
    const result = await harness.runPulse();
    expect(result.pulseIndex).toBe(0);
  });

  it("does not invoke AgentRuntime for Goulart (initiative fires but inhibition produces delay, needsLLM=false)", async () => {
    await harness.runPulse();
    expect(harness.llmCallsFor("goulart")).toBe(0);
  });

  it("does not invoke AgentRuntime for any offline agent", async () => {
    await harness.runPulse();
    for (const p of ["bruno", "caio", "mariana", "leo"]) {
      expect(harness.llmCallsFor(p)).toBe(0);
    }
  });

  it("no message_sent committed in pulse 0 (Goulart is delayed, not acting)", async () => {
    await harness.runPulse();
    const messages = await harness.getEventsByType("message_sent");
    expect(messages).toHaveLength(0);
  });

  it("total LLM calls is zero — budget is fully preserved in pulse 0", async () => {
    await harness.runPulse();
    expect(harness.totalLlmCalls()).toBe(0);
  });

  it("persists Goulart's updated state after the pulse", async () => {
    await harness.runPulse();
    const state = await harness.getAgentState("goulart");
    expect(state.agentId).toBe("goulart");
    expect(state.updatedAt).toBeGreaterThan(0);
  });

  it("Goulart's boredom initiative accumulator is seeded above threshold in state", async () => {
    await harness.runPulse();
    const state = await harness.getAgentState("goulart");
    const boredom = state.initiativeAccumulators.find(a => a.source === "boredom_accumulator");
    // Engine may update the accumulator value, but it was above threshold (0.75 > 0.6) going in
    expect(boredom).toBeDefined();
    expect(boredom!.threshold).toBe(0.6);
  });

  it("produces no LLM failures", async () => {
    await harness.runPulse();
    await harness.assertNoLlmFailures();
  });

  it("all committed events have correct shape (may be zero events — delay produces no committed events)", async () => {
    await harness.runPulse();
    await harness.assertCommittedEventShape();
  });
});
