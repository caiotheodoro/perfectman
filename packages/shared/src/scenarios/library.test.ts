import { describe, expect, it } from "vitest";
import {
  SCENARIO_REGISTRY,
  allScenarios,
  expandVariants,
  getScenario,
  rotateScenario,
  scenariosByCategory,
} from "./library.js";
import { ALL_PERSONAS } from "../constants/personas.js";

const PERSONA_IDS = new Set(ALL_PERSONAS.map(p => p.id));

const SOCIAL_FIELDS = new Set([
  "jealousy", "envy", "humiliation", "pride", "shame", "affection",
  "resentment", "suspicion", "admiration", "contempt", "neediness",
  "socialAnxiety", "fearOfExclusion", "desireForStatus", "desireForIntimacy",
]);

const EVENT_TYPES = new Set([
  "message_sent", "reply_sent", "reaction_sent", "typing_started",
  "typing_cancelled", "channel_created", "agent_invited", "agent_left",
  "presence_changed", "intent_delayed", "intent_blocked", "memory_written",
  "no_op_recorded", "private_motive_summary", "operator_warning",
  "llm_failure", "simulation_started", "simulation_paused",
  "simulation_resumed", "simulation_stopped", "recap_generated",
  "reflection_completed", "stagnation_detected",
]);

const CATEGORIES = ["v1_behavior", "motive_archetype", "stagnation_attractor", "edge_chaos", "calibration"];

describe("scenario library", () => {
  it("has a rich registry covering all categories", () => {
    expect(SCENARIO_REGISTRY.length).toBeGreaterThanOrEqual(36);
    for (const cat of CATEGORIES) {
      expect(scenariosByCategory(cat as never).length, `category ${cat}`).toBeGreaterThan(0);
    }
  });

  it("has unique scenario ids", () => {
    const ids = allScenarios().map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only references canonical personas and valid agents", () => {
    for (const s of allScenarios()) {
      const actorIds = new Set(s.agents.map(a => a.agentId));
      for (const a of s.agents) {
        expect(PERSONA_IDS.has(a.personaId), `${s.id} persona ${a.personaId}`).toBe(true);
      }
      for (const ch of s.channels) {
        for (const member of ch.memberAgentIds) {
          expect(actorIds.has(member), `${s.id} channel member ${member}`).toBe(true);
        }
      }
      for (const e of s.priorEvents) {
        expect(actorIds.has(e.actorId), `${s.id} event actor ${e.actorId}`).toBe(true);
      }
    }
  });

  it("uses valid event types and social emotion fields in signals", () => {
    for (const s of allScenarios()) {
      for (const sig of s.expectedSignals) {
        if (sig.kind === "event_committed" || sig.kind === "no_event_of_type") {
          expect(EVENT_TYPES.has(sig.eventType), `${s.id} eventType ${sig.eventType}`).toBe(true);
        }
        if (sig.kind === "emotion_rises" || sig.kind === "emotion_stays") {
          expect(SOCIAL_FIELDS.has(sig.field), `${s.id} field ${sig.field}`).toBe(true);
        }
      }
    }
  });

  it("has sane pulse counts and variants", () => {
    for (const s of allScenarios()) {
      expect(s.pulseCount).toBeGreaterThanOrEqual(3);
      expect(s.pulseCount).toBeLessThanOrEqual(60);
      expect(s.seedVariants).toBeGreaterThanOrEqual(1);
    }
  });

  it("rubric targets reference existing axes", () => {
    for (const s of allScenarios()) {
      const axisIds = new Set(s.rubric.axes.map(a => a.id));
      for (const t of s.rubric.targets) {
        expect(axisIds.has(t.axisId), `${s.id} target axis ${t.axisId}`).toBe(true);
      }
    }
  });

  it("rotation is deterministic and distinct across variants", () => {
    const s = getScenario("v1_casual_chat")!;
    const a = rotateScenario(s, 0, 7);
    const b = rotateScenario(s, 0, 7);
    expect(a).toEqual(b);
    const c = rotateScenario(s, 1, 7);
    expect(JSON.stringify(a.agents)).not.toBe(JSON.stringify(c.agents));
    const d = rotateScenario(s, 0, 99);
    expect(JSON.stringify(a.agents)).not.toBe(JSON.stringify(d.agents));
    expect(a.id).toBe("v1_casual_chat__v0");
  });

  it("expands into a large task pool (sample-size defense)", () => {
    const expanded = expandVariants(SCENARIO_REGISTRY);
    expect(expanded.length).toBeGreaterThanOrEqual(100);
    const ids = new Set(expanded.map(s => s.id));
    expect(ids.size).toBe(expanded.length);
  });
});
