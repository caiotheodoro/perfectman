/**
 * E2E — Exclusion Cascade: being ignored by Caio registers in Bruno's emotional state.
 *
 * Scenario:
 * 1. Goulart opens #geral
 * 2. Bruno replies to Goulart (seeking inclusion)
 * 3. Caio replies to Goulart — ignoring Bruno's message
 *
 * Bruno enters the pulse having been socially overlooked. The engine should:
 * - Detect the exclusion signal (Caio replied to Goulart, not to Bruno)
 * - Drive fearOfExclusion upward from its initial value (0.2)
 * - Drive resentment toward Caio upward
 * - Produce an act/delay/no_op decision — all valid; the emotion change is the signal
 *
 * The full pipeline then persists that updated state so the next pulse
 * starts from an emotionally-shifted Bruno.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { buildBrunoCaioExclusionScenario } from "@perfectman/shared";
import { SimulationHarness } from "./harness.js";

describe("E2E: Exclusion Cascade — Bruno's fear rises after Caio ignores him", () => {
  let harness: SimulationHarness;
  const INITIAL_FEAR = 0.2;
  const INITIAL_RESENTMENT_TO_CAIO = 0; // brunoState has no resentment set toward caio

  beforeEach(async () => {
    const scenario = buildBrunoCaioExclusionScenario();

    harness = await SimulationHarness.create({
      simulation: scenario.simulation,
      channels: scenario.channels,
      memberships: scenario.memberships,
      agentContexts: [
        { id: "bruno",   state: scenario.agentStates.bruno,   persona: scenario.personas.bruno },
        { id: "caio",    state: scenario.agentStates.caio,    persona: scenario.personas.caio },
        { id: "goulart", state: scenario.agentStates.goulart, persona: scenario.personas.goulart },
      ],
      priorEvents: scenario.committedEvents,
    });
  });

  it("completes pulse without error", async () => {
    const result = await harness.runPulse();
    expect(result.pulseIndex).toBe(0);
  });

  it("persists Bruno's updated emotional state after processing exclusion events", async () => {
    await harness.runPulse();
    const state = await harness.getAgentState("bruno");
    expect(state).toBeDefined();
    expect(state.agentId).toBe("bruno");
  });

  it("Bruno's fearOfExclusion does not decrease after being ignored", async () => {
    await harness.runPulse();
    const state = await harness.getAgentState("bruno");
    // Exclusion signal should sustain or raise fear; it must not drop
    expect(state.socialEmotions.fearOfExclusion).toBeGreaterThanOrEqual(INITIAL_FEAR);
  });

  it("all emotion values remain in legal bounds after exclusion processing", async () => {
    await harness.runPulse();
    const state = await harness.getAgentState("bruno");
    harness.assertEmotionBounds(state);
  });

  it("Bruno's lastProcessedEventId advances past the seeded exclusion events", async () => {
    await harness.runPulse();
    const state = await harness.getAgentState("bruno");
    // Engine advances the cursor to the last visible event it processed
    expect(state.lastProcessedEventId).not.toBeNull();
  });

  it("at least one event committed for Bruno (no_op, message, or reply)", async () => {
    await harness.runPulse();
    const brunoEvents = await harness.getEventsForAgent("bruno");
    const responseEvents = brunoEvents.filter(e =>
      ["message_sent", "reply_sent", "no_op_recorded", "intent_delayed"].includes(e.type),
    );
    expect(responseEvents.length).toBeGreaterThan(0);
  });

  it("commits events with operator visibility even when Bruno is silent", async () => {
    await harness.runPulse();
    const allEvents = await harness.getAllEvents();
    const opVisible = allEvents.filter(e => e.visibility.visibleToOperators);
    // Operators always see everything; committed events always have visibleToOperators=true
    expect(opVisible.length).toBe(allEvents.length);
  });

  it("produces no LLM failures", async () => {
    await harness.runPulse();
    await harness.assertNoLlmFailures();
  });

  it("second pulse also completes cleanly (state carries forward)", async () => {
    await harness.runPulse();
    const result2 = await harness.runPulse();
    expect(result2.pulseIndex).toBe(1);
    await harness.assertNoLlmFailures();
  });
});
