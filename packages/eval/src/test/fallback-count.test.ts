import { describe, it, expect } from "vitest";
import type { CommittedEvent, OperatorEvent } from "@perfectman/shared";
import { countFallbacks, collectLlmFailures, countHoldConsults } from "../run/scenario-runner.js";

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

describe("collectLlmFailures", () => {
  it("keeps every llm_failure and llm_retry_recovered with its raw head, and nothing else", () => {
    const events: OperatorEvent[] = [
      { type: "llm_failure", simulationId: "s", agentId: "lia", pulseIndex: 8, detail: "LLM parsing failed: No JSON object found in response", createdAt: 0, data: { errorDetail: "No JSON object found in response", rawHead: "", rawLength: 0 } },
      { type: "llm_retry_recovered", simulationId: "s", agentId: "nina", pulseIndex: 9, detail: "retry fixed a near-repeat", createdAt: 0 },
      { type: "prompt_trimmed", simulationId: "s", agentId: "lia", pulseIndex: 8, detail: "trimmed", createdAt: 0 },
    ];
    const out = collectLlmFailures(events);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: "llm_failure", agentId: "lia", pulseIndex: 8, data: { rawHead: "", rawLength: 0 } });
    expect(out[1]).toMatchObject({ type: "llm_retry_recovered", agentId: "nina", pulseIndex: 9 });
    expect(out[1]?.data).toBeUndefined();
  });
});

describe("countHoldConsults", () => {
  const motive = (holdSuggested: boolean | undefined, intentType: string, engineAuthored = false): CommittedEvent =>
    ({
      id: "m", simulationId: "s", channelId: "c", actorId: "a", type: "private_motive_summary",
      payload: { summary: "x", intentType, emotionDrivers: [], motivationDrivers: [], engineAuthored, ...(holdSuggested !== undefined ? { holdSuggested } : {}) },
      sourceEventIds: [], emotionalSalience: "low", pulseIndex: 1,
      visibility: { visibleToAgents: [], visibleToSpectators: false, visibleToOperators: true, visibilityReason: "operator_only" },
      createdAt: 0,
    }) as CommittedEvent;

  it("counts consults, voiced holds, and broken holds; engine answers count as neither; unflagged motives are ignored", () => {
    const events = [motive(true, "no_op"), motive(true, "send_message"), motive(true, "no_op", true), motive(undefined, "no_op"), motive(false, "send_message")];
    expect(countHoldConsults(events)).toEqual({ total: 3, voiced: 1, broke: 1 });
    expect(countHoldConsults([])).toEqual({ total: 0, voiced: 0, broke: 0 });
  });
});
