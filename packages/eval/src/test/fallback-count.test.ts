import { describe, it, expect } from "vitest";
import type { CommittedEvent, OperatorEvent } from "@perfectman/shared";
import { countFallbacks } from "../run/scenario-runner.js";

function committed(type: CommittedEvent["type"], motive?: string): CommittedEvent {
  return {
    id: `e_${type}_${motive ?? ""}`,
    simulationId: "s",
    channelId: "ch",
    actorId: "iris",
    type,
    payload: motive === undefined ? {} : { intentType: "no_op", privateMotiveSummary: motive },
    createdAt: 1,
    pulseIndex: 1,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: { visibleToAgents: [], visibleToSpectators: false, visibleToOperators: true, visibilityReason: "operator_only" },
  };
}

function operator(type: OperatorEvent["type"]): OperatorEvent {
  return { type, simulationId: "s", pulseIndex: 1, detail: type, createdAt: 1 };
}

describe("countFallbacks", () => {
  it("counts committed and operator llm_failure events, and engine-authored no-ops separately", () => {
    const events = [
      committed("llm_failure"),
      committed("no_op_recorded", "Fallback applied: No JSON object found in response"),
      committed("repetition_blocked", "Repetition guard: blocked"),
      committed("no_op_recorded", "prefiro esperar"),
      committed("message_sent"),
    ];
    const operatorEvents = [operator("llm_failure"), operator("llm_failure"), operator("action_intent")];
    expect(countFallbacks(events, operatorEvents)).toEqual({
      fallbackCount: 3,
      fallbackNoOps: 2,
      operatorEventCounts: { llm_failure: 2, action_intent: 1 },
    });
  });
});
