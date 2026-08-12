import { describe, expect, it } from "vitest";
import { checkExpectedSignals } from "../run/signal-checker.js";
import { ruleJudge } from "../judge/judge.js";
import { weightedKappa, krippendorffAlpha, calibrateJudge } from "../judge/calibration.js";
import { GOLDEN_LABELS } from "../judge/golden-labels.js";
import { getScenario } from "@perfectman/shared";
import type { AgentState, CommittedEvent, RoleplayScenario } from "@perfectman/shared";

function stateFor(agentId: string, fields: Record<string, number>): AgentState {
  return {
    agentId,
    simulationId: "s",
    personaId: agentId,
    presence: "active",
    coreMood: { valence: 0, arousal: 0.3, stability: 0.7, energy: 0.6, circumplexAngle: 0, circumplexRadius: 0.3, momentumValence: 0, momentumArousal: 0 },
    socialEmotions: {
      jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0,
      resentment: 0, suspicion: 0, admiration: 0, contempt: 0, neediness: 0,
      socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0,
      ...fields,
    },
    relationalStates: new Map(),
    memories: [],
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function event(type: CommittedEvent["type"], actorId: string, pulseIndex = 1): CommittedEvent {
  return {
    id: `e_${actorId}_${pulseIndex}`,
    simulationId: "s",
    channelId: "ch_geral",
    actorId,
    type,
    payload: {},
    createdAt: pulseIndex,
    pulseIndex,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "x" },
  };
}

describe("signal checker", () => {
  it("evaluates emotion_rises against final state", () => {
    const scenario: RoleplayScenario = {
      id: "t",
      category: "v1_behavior",
      name: "t",
      description: "",
      targetBehaviors: [],
      seedVariants: 1,
      pulseCount: 5,
      seed: 1,
      channels: [],
      agents: [],
      priorEvents: [],
      expectedSignals: [
        { kind: "emotion_rises", agentId: "bruno", field: "fearOfExclusion", min: 0.3 },
        { kind: "no_event_of_type", eventType: "llm_failure" },
      ],
      rubric: { id: "r", name: "r", axes: [], targets: [] },
    };
    const events = [event("message_sent", "caio"), event("llm_failure", "bruno", 2)];
    const states = new Map([["bruno", stateFor("bruno", { fearOfExclusion: 0.45 })]]);
    const out = checkExpectedSignals(scenario, events, states, () => 1);
    expect(out[0]!.passed).toBe(true);
    expect(out[1]!.passed).toBe(false);
  });
});

describe("rule judge", () => {
  it("scores a clean run high on no_ai_leak", () => {
    const scenario = getScenario("v1_casual_chat")!;
    const events = [
      { ...event("message_sent", "caio"), payload: { content: "bom dia gente" } },
      { ...event("reply_sent", "leo"), payload: { content: "kkkk bom dia" } },
    ];
    const probes = [
      { probe: "ai-leak", measured: 0, bound: [0, 0.02] as [number, number], passed: true, label: "x" },
      { probe: "emoji-reaction", measured: 0.1, bound: [0.05, 0.5] as [number, number], passed: true, label: "x" },
      { probe: "noop-meaningfulness", measured: 1, bound: [0.9, 1] as [number, number], passed: true, label: "x" },
      { probe: "memory-write", measured: 0.02, bound: [0, 0.12] as [number, number], passed: true, label: "x" },
    ];
    const scores = ruleJudge(scenario, events, probes, 1);
    expect(scores.no_ai_leak).toBeGreaterThanOrEqual(4);
    expect(scores.interpretation).toBe(5);
  });
});

describe("calibration math", () => {
  it("perfect agreement → kappa 1", () => {
    expect(weightedKappa([4, 4, 4], [4, 4, 4])).toBe(1);
  });

  it("total disagreement → low kappa", () => {
    const k = weightedKappa([1, 1, 1], [5, 5, 5]);
    expect(k).toBeLessThan(0.3);
  });

  it("krippendorff alpha is computed without crashing", () => {
    expect(typeof krippendorffAlpha([1, 2, 3, 4, 5], [1, 2, 3, 4, 5])).toBe("number");
  });

  it("calibration report is honest on disagreement", () => {
    const report = calibrateJudge(
      new Map([["v1_casual_chat", { in_character: 1, voice_match: 1, motive_authenticity: 1, interpretation: 1, creativity_unhinged: 1, memory_continuity: 1, no_ai_leak: 1 }]]),
      GOLDEN_LABELS,
      0.7,
    );
    expect(report.passed).toBe(false);
    expect(report.disagreements.length).toBeGreaterThan(0);
  });
});
