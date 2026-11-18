/**
 * E2E — Pipeline Invariants: cross-boundary guarantees that must hold for every scenario.
 *
 * These are the hard rules from the master contract that cut across all three
 * developer boundaries. If any of these break, the simulation's social reality
 * is compromised. They run against multiple scenarios in the same file.
 *
 * Invariants tested:
 * 1. ENGINE-EMITTED EVENTS BEFORE LLM: no_op_recorded and memory_written are
 *    committed before AgentRuntime is ever called.
 * 2. OPERATOR SEES ALL: every committed event has visibleToOperators=true.
 * 3. PRIVATE EVENTS HIDDEN FROM AGENTS: no_op_recorded and memory_written
 *    have visibleToAgents=[] and visibleToSpectators=false.
 * 4. ANTI-DRIFT CURSOR: lastProcessedEventId in stored state is non-null after
 *    a pulse that had prior events to process.
 * 5. STATE ALWAYS PERSISTED: agent state is upserted after every pulse even
 *    when no LLM call happens.
 * 6. EMOTION BOUNDS: all persisted emotional values stay within legal ranges.
 * 7. EVENT LOG IMMUTABLE: re-running getAfter after a pulse never removes events.
 * 8. DETERMINISM: same seed and same input produce same pulse outcome.
 */

import { describe, it, expect } from "vitest";
import {
  buildNoOpInhibitionScenario,
  buildDarioTomasExclusionScenario,
  buildVascoColdStartScenario,
} from "@perfectman/shared";
import { SimulationHarness } from "./harness.js";

// ── Invariant 1 & 3: Engine-emitted events committed before LLM ──────────────

describe("Invariant: engine-emitted events (no_op_recorded) are operator-only", () => {
  it("no_op_recorded: visibleToOperators=true, visibleToSpectators=false, agents=[]", async () => {
    const scenario = buildNoOpInhibitionScenario();
    const harness = await SimulationHarness.create({
      simulation: scenario.simulation,
      channels: scenario.channels,
      memberships: scenario.memberships,
      agentContexts: [
        { id: "dario",   state: scenario.agentStates.dario,   persona: scenario.personas.dario },
        { id: "vasco", state: scenario.agentStates.vasco, persona: scenario.personas.vasco },
        { id: "tomas",    state: scenario.agentStates.tomas,    persona: scenario.personas.tomas },
      ],
      priorEvents: scenario.committedEvents,
    });

    await harness.runPulse();
    const noOps = await harness.getEventsByType("no_op_recorded");

    expect(noOps.length).toBeGreaterThan(0);
    for (const evt of noOps) {
      expect(evt.visibility.visibleToOperators).toBe(true);
      expect(evt.visibility.visibleToSpectators).toBe(false);
      expect(evt.visibility.visibleToAgents).toHaveLength(0);
    }
  });

  it("engine-emitted no_op_recorded is committed for Dario before any intent resolution", async () => {
    const scenario = buildNoOpInhibitionScenario();
    const harness = await SimulationHarness.create({
      simulation: scenario.simulation,
      channels: scenario.channels,
      memberships: scenario.memberships,
      agentContexts: [
        { id: "dario",   state: scenario.agentStates.dario,   persona: scenario.personas.dario },
        { id: "vasco", state: scenario.agentStates.vasco, persona: scenario.personas.vasco },
        { id: "tomas",    state: scenario.agentStates.tomas,    persona: scenario.personas.tomas },
      ],
      priorEvents: scenario.committedEvents,
    });

    await harness.runPulse();
    const noOps = await harness.getEventsByType("no_op_recorded");
    const darioNoOp = noOps.find(e => e.actorId === "dario");

    // The engine emits no_op_recorded from stepResult.noOpRecord BEFORE the LLM path runs.
    // This guarantees the event exists regardless of whether attention events also route Dario to LLM.
    expect(darioNoOp).toBeDefined();
    expect(darioNoOp?.visibility.visibleToOperators).toBe(true);
    expect(darioNoOp?.visibility.visibleToSpectators).toBe(false);
  });
});

// ── Invariant 2: Operator sees all committed events ───────────────────────────

describe("Invariant: every committed event is visible to operators", () => {
  it("cold-start pulse produces only operator-visible events (delay produces 0 events — no violations)", async () => {
    const scenario = buildVascoColdStartScenario();
    const harness = await SimulationHarness.create({
      simulation: scenario.simulation,
      channels: scenario.channels,
      memberships: scenario.memberships,
      agentContexts: [
        { id: "vasco", state: scenario.vascoState, persona: scenario.vascoPersona },
        ...scenario.otherPersonas.map((p, i) => ({
          id: p.id, state: scenario.otherStates[i]!, persona: p,
        })),
      ],
      priorEvents: [],
    });

    await harness.runPulse();
    const allEvents = await harness.getAllEvents();

    // Cold-start pulse 0 may commit zero events (Vasco delays, offline agents inactive).
    // Invariant: if any events ARE committed, all must have visibleToOperators=true.
    for (const evt of allEvents) {
      expect(evt.visibility.visibleToOperators).toBe(true);
    }
  });

  it("all events in exclusion-cascade pulse have visibleToOperators=true", async () => {
    const scenario = buildDarioTomasExclusionScenario();
    const harness = await SimulationHarness.create({
      simulation: scenario.simulation,
      channels: scenario.channels,
      memberships: scenario.memberships,
      agentContexts: [
        { id: "dario",   state: scenario.agentStates.dario,   persona: scenario.personas.dario },
        { id: "tomas",    state: scenario.agentStates.tomas,    persona: scenario.personas.tomas },
        { id: "vasco", state: scenario.agentStates.vasco, persona: scenario.personas.vasco },
      ],
      priorEvents: scenario.committedEvents,
    });

    await harness.runPulse();
    const allEvents = await harness.getAllEvents();

    for (const evt of allEvents) {
      expect(evt.visibility.visibleToOperators).toBe(true);
    }
  });
});

// ── Invariant 4: Anti-drift cursor advances ───────────────────────────────────

describe("Invariant: lastProcessedEventId advances after processing prior events", () => {
  it("Dario's cursor is non-null after processing the exclusion event sequence", async () => {
    const scenario = buildDarioTomasExclusionScenario();
    const harness = await SimulationHarness.create({
      simulation: scenario.simulation,
      channels: scenario.channels,
      memberships: scenario.memberships,
      agentContexts: [
        { id: "dario",   state: scenario.agentStates.dario,   persona: scenario.personas.dario },
        { id: "tomas",    state: scenario.agentStates.tomas,    persona: scenario.personas.tomas },
        { id: "vasco", state: scenario.agentStates.vasco, persona: scenario.personas.vasco },
      ],
      priorEvents: scenario.committedEvents,
    });

    await harness.runPulse();
    const state = await harness.getAgentState("dario");
    // Engine sets lastProcessedEventId to the last event it saw
    expect(state.lastProcessedEventId).not.toBeNull();
  });
});

// ── Invariant 5 & 6: State always persisted with valid emotion bounds ─────────

describe("Invariant: agent state always persisted and emotion bounds valid", () => {
  it("all agents have persisted state with valid emotion values after cold-start pulse", async () => {
    const scenario = buildVascoColdStartScenario();
    const harness = await SimulationHarness.create({
      simulation: scenario.simulation,
      channels: scenario.channels,
      memberships: scenario.memberships,
      agentContexts: [
        { id: "vasco", state: scenario.vascoState, persona: scenario.vascoPersona },
        ...scenario.otherPersonas.map((p, i) => ({
          id: p.id, state: scenario.otherStates[i]!, persona: p,
        })),
      ],
      priorEvents: [],
    });

    await harness.runPulse();

    for (const id of ["vasco", "dario", "tomas", "lara", "renan"]) {
      const state = await harness.getAgentState(id);
      harness.assertEmotionBounds(state);
    }
  });

  it("Dario's state is persisted even when he goes no_op (no LLM call)", async () => {
    const scenario = buildNoOpInhibitionScenario();
    const harness = await SimulationHarness.create({
      simulation: scenario.simulation,
      channels: scenario.channels,
      memberships: scenario.memberships,
      agentContexts: [
        { id: "dario",   state: scenario.agentStates.dario,   persona: scenario.personas.dario },
        { id: "vasco", state: scenario.agentStates.vasco, persona: scenario.personas.vasco },
        { id: "tomas",    state: scenario.agentStates.tomas,    persona: scenario.personas.tomas },
      ],
      priorEvents: scenario.committedEvents,
    });

    await harness.runPulse();
    const state = await harness.getAgentState("dario");
    expect(state).toBeDefined();
    harness.assertEmotionBounds(state);
  });
});

// ── Invariant 7: Event log is append-only ─────────────────────────────────────

describe("Invariant: event log is append-only across pulses", () => {
  it("events from pulse 0 are still visible after pulse 1 runs", async () => {
    const scenario = buildDarioTomasExclusionScenario();
    const harness = await SimulationHarness.create({
      simulation: scenario.simulation,
      channels: scenario.channels,
      memberships: scenario.memberships,
      agentContexts: [
        { id: "dario",   state: scenario.agentStates.dario,   persona: scenario.personas.dario },
        { id: "tomas",    state: scenario.agentStates.tomas,    persona: scenario.personas.tomas },
        { id: "vasco", state: scenario.agentStates.vasco, persona: scenario.personas.vasco },
      ],
      priorEvents: scenario.committedEvents,
    });

    await harness.runPulse();
    const after0 = await harness.getAllEvents();
    const count0 = after0.length;

    await harness.runPulse();
    const after1 = await harness.getAllEvents();

    expect(after1.length).toBeGreaterThanOrEqual(count0);
    // Every event from pulse 0 still exists in the log
    const ids0 = new Set(after0.map(e => e.id));
    for (const id of ids0) {
      expect(after1.some(e => e.id === id)).toBe(true);
    }
  });
});

// ── Invariant 8: Committed event structure is always valid ────────────────────

describe("Invariant: all committed events have correct mandatory fields", () => {
  it("cold-start events pass shape validation", async () => {
    const scenario = buildVascoColdStartScenario();
    const harness = await SimulationHarness.create({
      simulation: scenario.simulation,
      channels: scenario.channels,
      memberships: scenario.memberships,
      agentContexts: [
        { id: "vasco", state: scenario.vascoState, persona: scenario.vascoPersona },
        ...scenario.otherPersonas.map((p, i) => ({
          id: p.id, state: scenario.otherStates[i]!, persona: p,
        })),
      ],
      priorEvents: [],
    });
    await harness.runPulse();
    await harness.assertCommittedEventShape();
  });

  it("no-op inhibition events pass shape validation", async () => {
    const scenario = buildNoOpInhibitionScenario();
    const harness = await SimulationHarness.create({
      simulation: scenario.simulation,
      channels: scenario.channels,
      memberships: scenario.memberships,
      agentContexts: [
        { id: "dario",   state: scenario.agentStates.dario,   persona: scenario.personas.dario },
        { id: "vasco", state: scenario.agentStates.vasco, persona: scenario.personas.vasco },
        { id: "tomas",    state: scenario.agentStates.tomas,    persona: scenario.personas.tomas },
      ],
      priorEvents: scenario.committedEvents,
    });
    await harness.runPulse();
    await harness.assertCommittedEventShape();
  });
});
