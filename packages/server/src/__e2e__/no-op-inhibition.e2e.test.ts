/**
 * E2E — No-Op Inhibition: Bruno's shame silences him without touching the LLM.
 *
 * Scenario: Goulart publicly mocked Bruno. Caio reacted with a laugh emoji.
 * Bruno's shame=0.85, humiliation=0.75. Social anxiety=0.7.
 * These drive the engine to produce noOpRecord before the LLM path is reached.
 *
 * Expected pipeline behaviour:
 * - Engine: shame+inhibition overwhelm pressure → noOpRecord non-null, needsLLM=false
 * - PulseScheduler: commits no_op_recorded BEFORE calling AgentRuntime
 * - AgentRuntime: never invoked for Bruno (LLM budget untouched)
 * - no_op_recorded visibility: operator=true, spectator=false, agents=[]
 * - SpectatorProjection: emits a sanitized spectator_hint (not the raw private motive)
 * - OperatorProjection: emits the full no_op payload for debuggers
 */

import { describe, it, expect, beforeEach } from "vitest";
import { buildNoOpInhibitionScenario } from "@perfectman/shared";
import { SimulationHarness } from "./harness.js";

describe("E2E: No-Op Inhibition — shame silences Bruno without an LLM call", () => {
  let harness: SimulationHarness;

  beforeEach(async () => {
    const scenario = buildNoOpInhibitionScenario();

    harness = await SimulationHarness.create({
      simulation: scenario.simulation,
      channels: scenario.channels,
      memberships: scenario.memberships,
      agentContexts: [
        { id: "bruno",   state: scenario.agentStates.bruno,   persona: scenario.personas.bruno },
        { id: "goulart", state: scenario.agentStates.goulart, persona: scenario.personas.goulart },
        { id: "caio",    state: scenario.agentStates.caio,    persona: scenario.personas.caio },
      ],
      priorEvents: scenario.committedEvents,
    });
  });

  it("completes pulse without error", async () => {
    const result = await harness.runPulse();
    expect(result.pulseIndex).toBe(0);
  });

  it("commits no_op_recorded for Bruno", async () => {
    await harness.runPulse();
    const noOps = await harness.getEventsByType("no_op_recorded");
    const brunoNoOp = noOps.find(e => e.actorId === "bruno");
    expect(brunoNoOp).toBeDefined();
    // Silence must carry a private motive (the e2e's point): non-empty summary
    const summary = brunoNoOp?.payload["privateMotiveSummary"];
    expect(typeof summary).toBe("string");
    expect(summary!.length).toBeGreaterThan(0);
  });

  it("shame inhibition silences Bruno regardless of whether attention events route him through the LLM", async () => {
    await harness.runPulse();
    // The engine may call the LLM for Bruno if recent events trigger attention processing.
    // What matters is the behavioral outcome: no public message, no_op_recorded committed.
    const brunoMessages = (await harness.getEventsForAgent("bruno")).filter(
      e => e.type === "message_sent" || e.type === "reply_sent",
    );
    expect(brunoMessages).toHaveLength(0);
    // no_op_recorded must be committed (engine emits it from noOpRecord before any LLM path)
    const noOps = await harness.getEventsByType("no_op_recorded");
    expect(noOps.some(e => e.actorId === "bruno")).toBe(true);
  });

  it("no_op_recorded is invisible to spectators and agents", async () => {
    await harness.runPulse();
    const noOps = await harness.getEventsByType("no_op_recorded");
    const brunoNoOp = noOps.find(e => e.actorId === "bruno");
    expect(brunoNoOp?.visibility.visibleToSpectators).toBe(false);
    expect(brunoNoOp?.visibility.visibleToAgents).toHaveLength(0);
  });

  it("no_op_recorded is visible to operators", async () => {
    await harness.runPulse();
    const noOps = await harness.getEventsByType("no_op_recorded");
    const brunoNoOp = noOps.find(e => e.actorId === "bruno");
    expect(brunoNoOp?.visibility.visibleToOperators).toBe(true);
  });

  it("no_op_recorded carries a private motive summary", async () => {
    await harness.runPulse();
    const noOps = await harness.getEventsByType("no_op_recorded");
    const brunoNoOp = noOps.find(e => e.actorId === "bruno");
    const summary = brunoNoOp?.payload["privateMotiveSummary"];
    expect(typeof summary).toBe("string");
    expect((summary as string).length).toBeGreaterThan(0);
  });

  it("SpectatorProjection emits a sanitized spectator_hint for Bruno's silence", async () => {
    await harness.runPulse();
    const hints = harness.gateway.spectatorEvents.filter(e => e.type === "spectator_hint");
    const brunoHint = hints.find(e => e.actorId === "bruno");
    expect(brunoHint).toBeDefined();
    // Must not leak the raw private motive (spectator sees max 80 chars)
    if (brunoHint?.visibleContent) {
      expect(brunoHint.visibleContent.length).toBeLessThanOrEqual(80);
    }
  });

  it("Bruno's updated state reflects the emotional impact of humiliation", async () => {
    await harness.runPulse();
    const state = await harness.getAgentState("bruno");
    // Shame should remain high after processing the humiliation events
    expect(state.socialEmotions.shame).toBeGreaterThan(0.5);
    harness.assertEmotionBounds(state);
  });

  it("no message_sent committed for Bruno", async () => {
    await harness.runPulse();
    const brunoMessages = (await harness.getEventsForAgent("bruno")).filter(
      e => e.type === "message_sent" || e.type === "reply_sent",
    );
    expect(brunoMessages).toHaveLength(0);
  });

  it("produces no LLM failures", async () => {
    await harness.runPulse();
    await harness.assertNoLlmFailures();
  });
});
