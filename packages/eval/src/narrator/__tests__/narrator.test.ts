import { describe, expect, it } from "vitest";
import { REPETITION_GUARD_MARKER } from "@perfectman/server";
import type { CommittedEvent, RoleplayScenario } from "@perfectman/shared";
import { ruleNarration, ruleNarrationFromTranscript } from "../narrator.js";

const scenario = { id: "s1", name: "Test Scene" } as RoleplayScenario;

function noOpEvent(actorId: string, privateMotiveSummary: string): CommittedEvent {
  return {
    id: `evt_${actorId}`,
    simulationId: "s1",
    channelId: "ch1",
    actorId,
    type: "no_op_recorded",
    payload: { intentType: "no_op", privateMotiveSummary },
    createdAt: Date.now(),
    pulseIndex: 1,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: false,
      visibleToOperators: true,
      visibilityReason: "operator_only",
    },
  } as CommittedEvent;
}

describe("ruleNarration — engine fallback motives never surface as the hidden shift", () => {
  it("quotes a real character motive over a co-occurring engine fallback motive", () => {
    const events = [
      noOpEvent("caio", "Fallback applied: JSON parse error at position 12"),
      noOpEvent("mari", "quero manter distância da Mariana porque ela me traiu ontem"),
    ];

    const narration = ruleNarration(scenario, events);

    expect(narration.hiddenShift).toContain("quero manter distância");
    expect(narration.hiddenShift).not.toContain("Fallback applied");
  });

  it("falls back to the generic line when every no_op motive is engine-authored", () => {
    const events = [
      noOpEvent("caio", "Fallback applied: JSON parse error at position 12"),
      noOpEvent("mari", `${REPETITION_GUARD_MARKER}: near-duplicate of a message you already sent, even after a retry — blocked structurally.`),
      noOpEvent("leo", "LLM budget exceeded: per-minute cap reached"),
      noOpEvent("goulart", "Provider failed: timeout after 5000ms"),
      noOpEvent("ana", "Retry call failed."),
      noOpEvent("bea", "Reaction target unresolvable; reaction dropped."),
    ];

    const narration = ruleNarration(scenario, events);

    expect(narration.hiddenShift).toBe("The room held its cards close.");
  });
});

describe("ruleNarrationFromTranscript — same guard on the string-based path", () => {
  it("quotes a real character motive over a co-occurring engine fallback motive", () => {
    const transcript = [
      `[p1] caio (no_op_recorded) [internally: Fallback applied: JSON parse error at position 12]`,
      `[p1] mari (no_op_recorded) [internally: quero manter distância da Mariana porque ela me traiu ontem]`,
    ].join("\n");

    const narration = ruleNarrationFromTranscript(transcript, "Test Scene");

    expect(narration.hiddenShift).toContain("quero manter distância");
    expect(narration.hiddenShift).not.toContain("Fallback applied");
  });
});
