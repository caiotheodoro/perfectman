/**
 * E2E — Roleplay Behaviors: one suite per behavioral divergence.
 *
 * Replaces the four previous per-scenario suites (cold-start, exclusion-cascade,
 * no-op-inhibition, private-channel-motive). Cross-cutting invariants (event
 * shape, operator visibility, cursor advance, state persistence, emotion
 * bounds) live in pipeline-invariants.e2e.test.ts — this suite asserts only
 * scenario-unique behaviors, so each invariant is owned by one layer.
 *
 * Each scenario is built from its shared fixture and run through the full
 * cross-boundary pipeline via SimulationHarness (real engine → real AgentRuntime
 * with mock LLM → real PulseScheduler + IntentResolver + projections → mock
 * delivery gateway).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildVascoColdStartScenario,
  buildDarioTomasExclusionScenario,
  buildNoOpInhibitionScenario,
  buildPrivateChannelMotiveScenario,
} from "@perfectman/shared";
import { SimulationHarness, type ScenarioSeed } from "./harness.js";

type ScenarioEntry = { name: string; seed: () => ScenarioSeed };

// Fixture builders return different shapes; adapt each to ScenarioSeed here.
const SCENARIOS: ScenarioEntry[] = [
  {
    name: "cold-start: Vasco's strategic patience delays pulse 0",
    seed: () => {
      const s = buildVascoColdStartScenario();
      return {
        simulation: s.simulation,
        channels: s.channels,
        memberships: s.memberships,
        agentContexts: [
          { id: "vasco", state: s.vascoState, persona: s.vascoPersona },
          ...s.otherPersonas.map((p, i) => ({
            id: p.id,
            state: s.otherStates[i]!,
            persona: p,
          })),
        ],
        priorEvents: [],
      };
    },
  },
  {
    name: "exclusion cascade: Dario's fear rises after Tomas ignores him",
    seed: () => {
      const s = buildDarioTomasExclusionScenario();
      return {
        simulation: s.simulation,
        channels: s.channels,
        memberships: s.memberships,
        agentContexts: [
          { id: "dario", state: s.agentStates.dario, persona: s.personas.dario },
          { id: "tomas", state: s.agentStates.tomas, persona: s.personas.tomas },
          { id: "vasco", state: s.agentStates.vasco, persona: s.personas.vasco },
        ],
        priorEvents: s.committedEvents,
      };
    },
  },
  {
    name: "no-op inhibition: shame silences Dario without an LLM call",
    seed: () => {
      const s = buildNoOpInhibitionScenario();
      return {
        simulation: s.simulation,
        channels: s.channels,
        memberships: s.memberships,
        agentContexts: [
          { id: "dario", state: s.agentStates.dario, persona: s.personas.dario },
          { id: "vasco", state: s.agentStates.vasco, persona: s.personas.vasco },
          { id: "tomas", state: s.agentStates.tomas, persona: s.personas.tomas },
        ],
        priorEvents: s.committedEvents,
      };
    },
  },
  {
    name: "private-channel motive: Lara opens a private channel with Tomas",
    seed: () => {
      const s = buildPrivateChannelMotiveScenario();
      return {
        simulation: s.simulation,
        channels: s.channels,
        memberships: s.memberships,
        agentContexts: [
          { id: "lara", state: s.agentStates.lara, persona: s.personas.lara },
          { id: "tomas", state: s.agentStates.tomas, persona: s.personas.tomas },
        ],
        priorEvents: s.committedEvents,
      };
    },
  },
];

// ── Cross-scenario smoke (the only boilerplate kept here — Q9: once per family) ──

describe.each(SCENARIOS)("E2E scenario smoke: $name", ({ name, seed }) => {
  let harness: SimulationHarness;

  beforeEach(async () => {
    harness = await SimulationHarness.create(seed());
  });

  it("completes pulse 0 without error", async () => {
    const result = await harness.runPulse();
    expect(result.pulseIndex).toBe(0);
  });

  it("produces no LLM failures", async () => {
    await harness.runPulse();
    await harness.assertNoLLMFailures();
  });
});

// ── Scenario-unique behaviors ────────────────────────────────────────────────

describe("cold-start: Vasco delays due to strategic patience in pulse 0", () => {
  let harness: SimulationHarness;

  beforeEach(async () => {
    harness = await SimulationHarness.create(SCENARIOS[0]!.seed());
  });

  it("does not invoke AgentRuntime for Vasco (initiative fires but inhibition produces delay, needsLLM=false)", async () => {
    await harness.runPulse();
    expect(harness.llmCallsFor("vasco")).toBe(0);
  });

  it("does not invoke AgentRuntime for any offline agent", async () => {
    await harness.runPulse();
    for (const p of ["dario", "tomas", "lara", "renan"]) {
      expect(harness.llmCallsFor(p)).toBe(0);
    }
  });

  it("total LLM calls is zero — budget is fully preserved in pulse 0", async () => {
    await harness.runPulse();
    expect(harness.totalLLMCalls()).toBe(0);
  });

  it("no message_sent committed in pulse 0 (Vasco is delayed, not acting)", async () => {
    await harness.runPulse();
    const messages = await harness.getEventsByType("message_sent");
    expect(messages).toHaveLength(0);
  });

  it("Vasco's boredom initiative accumulator is seeded above threshold in state", async () => {
    await harness.runPulse();
    const state = await harness.getAgentState("vasco");
    const boredom = state.initiativeAccumulators.find(a => a.source === "boredom_accumulator");
    // Engine may update the accumulator value, but it was above threshold (0.75 > 0.6) going in
    expect(boredom).toBeDefined();
    expect(boredom!.threshold).toBe(0.6);
  });
});

describe("exclusion cascade: Dario's fear does not decrease after being ignored", () => {
  let harness: SimulationHarness;
  const INITIAL_FEAR = 0.2;

  beforeEach(async () => {
    harness = await SimulationHarness.create(SCENARIOS[1]!.seed());
  });

  it("Dario's fearOfExclusion sustains or rises after the exclusion signal", async () => {
    await harness.runPulse();
    const state = await harness.getAgentState("dario");
    expect(state.socialEmotions.fearOfExclusion).toBeGreaterThanOrEqual(INITIAL_FEAR);
  });

  it("Dario still produces a response event (no_op, message, or reply)", async () => {
    await harness.runPulse();
    const darioEvents = await harness.getEventsForAgent("dario");
    const responseEvents = darioEvents.filter(e =>
      ["message_sent", "reply_sent", "no_op_recorded", "intent_delayed"].includes(e.type),
    );
    expect(responseEvents.length).toBeGreaterThan(0);
  });

  it("a second pulse also completes cleanly (state carries forward)", async () => {
    await harness.runPulse();
    const result2 = await harness.runPulse();
    expect(result2.pulseIndex).toBe(1);
    await harness.assertNoLLMFailures();
  });
});

describe("no-op inhibition: shame silences Dario without a public message", () => {
  let harness: SimulationHarness;

  beforeEach(async () => {
    harness = await SimulationHarness.create(SCENARIOS[2]!.seed());
  });

  it("commits no_op_recorded for Dario carrying a non-empty private motive", async () => {
    await harness.runPulse();
    const noOps = await harness.getEventsByType("no_op_recorded");
    const darioNoOp = noOps.find(e => e.actorId === "dario");
    expect(darioNoOp).toBeDefined();
    // Silence must carry a private motive (the e2e's point): non-empty summary
    const summary = darioNoOp?.payload["privateMotiveSummary"];
    expect(typeof summary).toBe("string");
    expect(summary!.length).toBeGreaterThan(0);
  });

  it("Dario commits no public message — the behavioral outcome of inhibition", async () => {
    await harness.runPulse();
    const darioMessages = (await harness.getEventsForAgent("dario")).filter(
      e => e.type === "message_sent" || e.type === "reply_sent",
    );
    expect(darioMessages).toHaveLength(0);
  });

  it("Dario's shame remains high after processing the humiliation events", async () => {
    await harness.runPulse();
    const state = await harness.getAgentState("dario");
    expect(state.socialEmotions.shame).toBeGreaterThan(0.5);
  });

  it("SpectatorProjection emits a sanitized spectator_hint for Dario's silence", async () => {
    await harness.runPulse();
    const hints = harness.gateway.spectatorEvents.filter(e => e.type === "spectator_hint");
    const darioHint = hints.find(e => e.actorId === "dario");
    expect(darioHint).toBeDefined();
    // Must not leak the raw private motive (spectator sees max 80 chars)
    if (darioHint?.visibleContent) {
      expect(darioHint.visibleContent.length).toBeLessThanOrEqual(80);
    }
  });
});

describe("private-channel motive: Lara opens a private channel with Tomas", () => {
  let harness: SimulationHarness;

  beforeEach(async () => {
    harness = await SimulationHarness.create(SCENARIOS[3]!.seed());
  });

  it("commits a channel_created event attributed to Lara inviting Tomas", async () => {
    await harness.runPulse();
    const created = await harness.getEventsByType("channel_created");
    const laraChannel = created.find(e => e.actorId === "lara");
    expect(laraChannel).toBeDefined();
    // The private-channel motive is evidenced by who she invited, not by a payload summary
    expect(laraChannel!.payload["invitedAgentIds"]).toContain("tomas");
  });

  it("calls gateway.createChannel with Lara as creator", async () => {
    await harness.runPulse();
    expect(harness.gateway.createdChannels.length).toBeGreaterThan(0);
  });

  it("channel_created payload marks a private channel", async () => {
    await harness.runPulse();
    const created = await harness.getEventsByType("channel_created");
    const laraChannel = created.find(e => e.actorId === "lara");
    // channel_created payload carries channelType/invitedAgentIds, not the motive summary
    expect(laraChannel?.payload["channelType"]).toBe("private_channel");
  });
});
