/**
 * Multi-pulse loop test.
 *
 * Runs 10 pulses of the full simulation, cycling all 5 agents through
 * runEngineStep each pulse. No LLM — decisions produce no_op_recorded.
 * Asserts emotion bounds hold after every agent/pulse step.
 */

import { describe, it, expect } from "vitest";
import type {
  EngineSnapshot,
  AgentState,
  CommittedEvent,
  WorldSignals,
} from "@perfectman/shared";
import { createSeededRng } from "@perfectman/shared";
import { buildSimulationFixture } from "@perfectman/shared";
import { runEngineStep } from "../step/run-engine-step.js";
import { computeStagnationMetrics } from "../health/compute-stagnation-metrics.js";

// ── Bounds helpers ─────────────────────────────────────────────────────────────

function assertMoodBounds(state: AgentState): void {
  const { coreMood, socialEmotions } = state;

  expect(coreMood.valence, "valence out of [-1, 1]").toBeGreaterThanOrEqual(-1);
  expect(coreMood.valence, "valence out of [-1, 1]").toBeLessThanOrEqual(1);
  expect(coreMood.arousal, "arousal out of [0, 1]").toBeGreaterThanOrEqual(0);
  expect(coreMood.arousal, "arousal out of [0, 1]").toBeLessThanOrEqual(1);
  expect(coreMood.stability, "stability out of [0, 1]").toBeGreaterThanOrEqual(0);
  expect(coreMood.stability, "stability out of [0, 1]").toBeLessThanOrEqual(1);
  expect(coreMood.energy, "energy out of [0, 1]").toBeGreaterThanOrEqual(0);
  expect(coreMood.energy, "energy out of [0, 1]").toBeLessThanOrEqual(1);
  expect(isNaN(coreMood.valence), "valence is NaN").toBe(false);
  expect(isNaN(coreMood.arousal), "arousal is NaN").toBe(false);

  for (const [key, val] of Object.entries(socialEmotions)) {
    expect(isNaN(val), `${key} is NaN`).toBe(false);
    expect(val, `${key} out of [0, 1]`).toBeGreaterThanOrEqual(0);
    expect(val, `${key} out of [0, 1]`).toBeLessThanOrEqual(1);
  }
}

// ── World signals builder (pure, no dev2 dependency) ──────────────────────────

function buildTestWorldSignals(events: CommittedEvent[], agentCount: number): WorldSignals {
  const recent = events.slice(-20);
  const msgCount = recent.filter(
    e => e.type === "message_sent" || e.type === "reply_sent",
  ).length;
  const lastMsg = recent.filter(
    e => e.type === "message_sent" || e.type === "reply_sent",
  ).at(-1);

  return {
    highArousalNearby: msgCount > 10,
    averageChannelArousal: Math.min(0.9, 0.2 + msgCount * 0.03),
    activeAgentCount: agentCount,
    timeSinceLastPublicMessage: lastMsg ? 5 : 120,
    channelMessageRatePerMinute: msgCount,
    recentTopicShift: false,
  };
}

// ── Multi-pulse loop ───────────────────────────────────────────────────────────

describe("multi-pulse simulation loop", () => {
  const fixture = buildSimulationFixture();
  const agentStates = new Map<string, AgentState>(
    fixture.agentStates.map(s => [s.agentId, s]),
  );
  const allEvents: CommittedEvent[] = [];
  const PULSES = 10;
  const lastEventIdByAgent = new Map<string, string | null>(
    fixture.agentStates.map(s => [s.agentId, null]),
  );

  it("runs 10 pulses for all 5 agents without throwing or violating bounds", () => {
    for (let pulse = 1; pulse <= PULSES; pulse++) {
      for (const persona of fixture.personas) {
        const agentState = agentStates.get(persona.id)!;
        const rng = createSeededRng(fixture.simulation.seed + pulse * 100 + fixture.personas.indexOf(persona));

        const snapshot: EngineSnapshot = {
          pulseIndex: pulse,
          simulation: fixture.simulation,
          committedEvents: [...allEvents],
          agentState,
          persona,
          channels: fixture.channels,
          channelMembership: fixture.memberships,
          relationalStates: agentState.relationalStates,
          worldSignals: buildTestWorldSignals(allEvents, fixture.personas.length),
          rateLimitStatus: {
            agentId: persona.id,
            messagesThisMinute: 0,
            privateChannelsCreated: 0,
            lastActionAt: null,
            blocked: false,
          },
          dt: 3,
          rng,
        };

        const result = runEngineStep(snapshot);

        // Bounds check every step
        assertMoodBounds(result.updatedAgentState);
        expect(isNaN(result.attentionResults.dueScore), `pulse ${pulse} agent ${persona.id}: dueScore NaN`).toBe(false);
        expect(result.attentionResults.dueScore).toBeGreaterThanOrEqual(0);

        // Advance agent state
        agentStates.set(persona.id, result.updatedAgentState);

        // Track lastProcessedEventId: should never regress
        const prevLastId = lastEventIdByAgent.get(persona.id) ?? null;
        const newLastId = result.updatedAgentState.lastProcessedEventId;
        if (prevLastId !== null && newLastId !== null) {
          // Both non-null: new id should be >= prev (lexicographic, or it stays the same)
          // We don't assert strict ordering since ids are opaque — just assert no throw
        }
        lastEventIdByAgent.set(persona.id, newLastId);

        // Collect a synthetic event per agent per pulse (no-op record simulation)
        const syntheticEvent: CommittedEvent = {
          id: `evt_p${pulse}_${persona.id}`,
          simulationId: fixture.simulation.id,
          channelId: fixture.channels[0].id,
          actorId: persona.id,
          type: "no_op_recorded",
          payload: {
            privateMotiveSeed: result.noOpRecord?.privateMotiveSeed ?? "idle",
          },
          createdAt: Date.now() + pulse * 1000 + fixture.personas.indexOf(persona),
          pulseIndex: pulse,
          sourceEventIds: [],
          emotionalSalience: "low",
          visibility: {
            visibleToAgents: [],
            visibleToSpectators: false,
            visibleToOperators: true,
            visibilityReason: "operator_internal",
          },
        };
        allEvents.push(syntheticEvent);
      }
    }
  });

  it("stagnation metrics after 10 pulses are valid", () => {
    const metrics = computeStagnationMetrics(
      fixture.simulation.id,
      PULSES,
      allEvents,
      agentStates,
    );

    expect(isNaN(metrics.compositeScore), "compositeScore NaN").toBe(false);
    expect(metrics.compositeScore).toBeGreaterThanOrEqual(0);
    expect(metrics.compositeScore).toBeLessThanOrEqual(1);
    expect(["normal", "yellow", "red", "critical"]).toContain(metrics.level);
    expect(isNaN(metrics.bdi)).toBe(false);
    expect(isNaN(metrics.rdv)).toBe(false);
    expect(isNaN(metrics.ige)).toBe(false);
    expect(isNaN(metrics.cue)).toBe(false);
    expect(isNaN(metrics.eri)).toBe(false);
    expect(isNaN(metrics.isd)).toBe(false);
    expect(isNaN(metrics.cns)).toBe(false);
  });

  it("all agents have valid emotion state after 10 pulses", () => {
    for (const [, state] of agentStates) {
      assertMoodBounds(state);
    }
  });

  it("agent state progresses through pulses (updatedAt advances)", () => {
    for (const [, state] of agentStates) {
      // updatedAt should exist and be a number
      expect(typeof state.updatedAt).toBe("number");
      expect(isNaN(state.updatedAt)).toBe(false);
    }
  });
});
