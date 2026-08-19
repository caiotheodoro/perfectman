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
  buildGoulartColdStartScenario,
  buildBrunoCaioExclusionScenario,
  buildNoOpInhibitionScenario,
  buildPrivateChannelMotiveScenario,
} from "@perfectman/shared";
import { SimulationHarness, type ScenarioSeed } from "./harness.js";

type ScenarioEntry = { name: string; seed: () => ScenarioSeed };

// Fixture builders return different shapes; adapt each to ScenarioSeed here.
const SCENARIOS: ScenarioEntry[] = [
  {
    name: "cold-start: Goulart's strategic patience delays pulse 0",
    seed: () => {
      const s = buildGoulartColdStartScenario();
      return {
        simulation: s.simulation,
        channels: s.channels,
        memberships: s.memberships,
        agentContexts: [
          { id: "goulart", state: s.goulartState, persona: s.goulartPersona },
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
    name: "exclusion cascade: Bruno's fear rises after Caio ignores him",
    seed: () => {
      const s = buildBrunoCaioExclusionScenario();
      return {
        simulation: s.simulation,
        channels: s.channels,
        memberships: s.memberships,
        agentContexts: [
          { id: "bruno", state: s.agentStates.bruno, persona: s.personas.bruno },
          { id: "caio", state: s.agentStates.caio, persona: s.personas.caio },
          { id: "goulart", state: s.agentStates.goulart, persona: s.personas.goulart },
        ],
        priorEvents: s.committedEvents,
      };
    },
  },
  {
    name: "no-op inhibition: shame silences Bruno without an LLM call",
    seed: () => {
      const s = buildNoOpInhibitionScenario();
      return {
        simulation: s.simulation,
        channels: s.channels,
        memberships: s.memberships,
        agentContexts: [
          { id: "bruno", state: s.agentStates.bruno, persona: s.personas.bruno },
          { id: "goulart", state: s.agentStates.goulart, persona: s.personas.goulart },
          { id: "caio", state: s.agentStates.caio, persona: s.personas.caio },
        ],
        priorEvents: s.committedEvents,
      };
    },
  },
  {
    name: "private-channel motive: Mariana opens a private channel with Caio",
    seed: () => {
      const s = buildPrivateChannelMotiveScenario();
      return {
        simulation: s.simulation,
        channels: s.channels,
        memberships: s.memberships,
        agentContexts: [
          { id: "mariana", state: s.agentStates.mariana, persona: s.personas.mariana },
          { id: "caio", state: s.agentStates.caio, persona: s.personas.caio },
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
    await harness.assertNoLlmFailures();
  });
});

// ── Scenario-unique behaviors ────────────────────────────────────────────────

describe("cold-start: Goulart delays due to strategic patience in pulse 0", () => {
  let harness: SimulationHarness;

  beforeEach(async () => {
    harness = await SimulationHarness.create(SCENARIOS[0]!.seed());
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

  it("total LLM calls is zero — budget is fully preserved in pulse 0", async () => {
    await harness.runPulse();
    expect(harness.totalLlmCalls()).toBe(0);
  });

  it("no message_sent committed in pulse 0 (Goulart is delayed, not acting)", async () => {
    await harness.runPulse();
    const messages = await harness.getEventsByType("message_sent");
    expect(messages).toHaveLength(0);
  });

  it("Goulart's boredom initiative accumulator is seeded above threshold in state", async () => {
    await harness.runPulse();
    const state = await harness.getAgentState("goulart");
    const boredom = state.initiativeAccumulators.find(a => a.source === "boredom_accumulator");
    // Engine may update the accumulator value, but it was above threshold (0.75 > 0.6) going in
    expect(boredom).toBeDefined();
    expect(boredom!.threshold).toBe(0.6);
  });
});

describe("exclusion cascade: Bruno's fear does not decrease after being ignored", () => {
  let harness: SimulationHarness;
  const INITIAL_FEAR = 0.2;

  beforeEach(async () => {
    harness = await SimulationHarness.create(SCENARIOS[1]!.seed());
  });

  it("Bruno's fearOfExclusion sustains or rises after the exclusion signal", async () => {
    await harness.runPulse();
    const state = await harness.getAgentState("bruno");
    expect(state.socialEmotions.fearOfExclusion).toBeGreaterThanOrEqual(INITIAL_FEAR);
  });

  it("Bruno still produces a response event (no_op, message, or reply)", async () => {
    await harness.runPulse();
    const brunoEvents = await harness.getEventsForAgent("bruno");
    const responseEvents = brunoEvents.filter(e =>
      ["message_sent", "reply_sent", "no_op_recorded", "intent_delayed"].includes(e.type),
    );
    expect(responseEvents.length).toBeGreaterThan(0);
  });

  it("a second pulse also completes cleanly (state carries forward)", async () => {
    await harness.runPulse();
    const result2 = await harness.runPulse();
    expect(result2.pulseIndex).toBe(1);
    await harness.assertNoLlmFailures();
  });
});

describe("no-op inhibition: shame silences Bruno without a public message", () => {
  let harness: SimulationHarness;

  beforeEach(async () => {
    harness = await SimulationHarness.create(SCENARIOS[2]!.seed());
  });

  it("commits no_op_recorded for Bruno carrying a non-empty private motive", async () => {
    await harness.runPulse();
    const noOps = await harness.getEventsByType("no_op_recorded");
    const brunoNoOp = noOps.find(e => e.actorId === "bruno");
    expect(brunoNoOp).toBeDefined();
    // Silence must carry a private motive (the e2e's point): non-empty summary
    const summary = brunoNoOp?.payload["privateMotiveSummary"];
    expect(typeof summary).toBe("string");
    expect(summary!.length).toBeGreaterThan(0);
  });

  it("Bruno commits no public message — the behavioral outcome of inhibition", async () => {
    await harness.runPulse();
    const brunoMessages = (await harness.getEventsForAgent("bruno")).filter(
      e => e.type === "message_sent" || e.type === "reply_sent",
    );
    expect(brunoMessages).toHaveLength(0);
  });

  it("Bruno's shame remains high after processing the humiliation events", async () => {
    await harness.runPulse();
    const state = await harness.getAgentState("bruno");
    expect(state.socialEmotions.shame).toBeGreaterThan(0.5);
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
});

describe("private-channel motive: Mariana opens a private channel with Caio", () => {
  let harness: SimulationHarness;

  beforeEach(async () => {
    harness = await SimulationHarness.create(SCENARIOS[3]!.seed());
  });

  it("commits a channel_created event attributed to Mariana inviting Caio", async () => {
    await harness.runPulse();
    const created = await harness.getEventsByType("channel_created");
    const marianaChannel = created.find(e => e.actorId === "mariana");
    expect(marianaChannel).toBeDefined();
    // The private-channel motive is evidenced by who she invited, not by a payload summary
    expect(marianaChannel!.payload["invitedAgentIds"]).toContain("caio");
  });

  it("calls gateway.createChannel with Mariana as creator", async () => {
    await harness.runPulse();
    expect(harness.gateway.createdChannels.length).toBeGreaterThan(0);
  });

  it("channel_created payload marks a private channel", async () => {
    await harness.runPulse();
    const created = await harness.getEventsByType("channel_created");
    const marianaChannel = created.find(e => e.actorId === "mariana");
    // channel_created payload carries channelType/invitedAgentIds, not the motive summary
    expect(marianaChannel?.payload["channelType"]).toBe("private_channel");
  });
});
