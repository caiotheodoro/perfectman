import { describe, it, expect } from "vitest";
import type { CommittedEvent } from "@perfectman/shared";
import type { BehavioralEvent } from "../probes/types.js";
import { PROBE_BANDS } from "../probes/types.js";
import { actShareMax, noOpMeaningfulness, runAllProbes } from "../probes/index.js";
import { eventsToBehavioral } from "../probes/adapter.js";

function be(kind: BehavioralEvent["kind"], agentId: string, pulseIndex: number, extra: Partial<BehavioralEvent> = {}): BehavioralEvent {
  return { kind, agentId, channelId: "ch", pulseIndex, payload: {}, ...extra };
}

describe("act-share-max", () => {
  it("is the largest per-agent share of content turns", () => {
    const events = [be("post", "iris", 1), be("post", "iris", 2), be("reply", "iris", 3), be("post", "bruno", 4), be("react", "bruno", 5)];
    expect(actShareMax(events, ["iris", "bruno", "theo"])).toBeCloseTo(0.75);
    expect(actShareMax([], ["iris"])).toBe(0);
  });

  it("is reported by runAllProbes with an upper band", () => {
    const events = [be("post", "iris", 1), be("post", "bruno", 2)];
    const result = runAllProbes({ events, agentIds: ["iris", "bruno"], totalPulses: 2, fallbackCount: 0, totalLLMCalls: 2 })
      .find(p => p.probe === "act-share-max");
    expect(result?.measured).toBe(0.5);
    expect(PROBE_BANDS["act-share-max"]).toEqual([0, 0.5]);
  });
});

describe("noop-meaningfulness", () => {
  it("does not count an engine-authored motive as meaningful", () => {
    const events = [
      be("silence", "iris", 1, { privateContent: "Fallback applied: No JSON object found in response", engineAuthored: true }),
      be("silence", "bruno", 2, { privateContent: "melhor deixar ela se expor sozinha" }),
    ];
    expect(noOpMeaningfulness(events)).toBe(0.5);
  });
});

describe("adapter with private_motive_summary", () => {
  function committed(overrides: Partial<CommittedEvent> & { type: CommittedEvent["type"]; id: string }): CommittedEvent {
    return {
      simulationId: "s",
      channelId: "ch",
      actorId: "iris",
      payload: {},
      createdAt: 1,
      pulseIndex: 1,
      sourceEventIds: [],
      emotionalSalience: "low",
      visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" },
      ...overrides,
    };
  }

  it("drops motive events from the stream and joins them onto the act", () => {
    const events = [
      committed({ id: "a1", type: "message_sent", payload: { content: "oi" }, sourceIntentId: "int_1" }),
      committed({
        id: "m1",
        type: "private_motive_summary",
        sourceIntentId: "int_1",
        payload: { summary: "Fallback applied: parse error", intentType: "send_message", emotionDrivers: [], motivationDrivers: [], engineAuthored: true },
        visibility: { visibleToAgents: [], visibleToSpectators: false, visibleToOperators: true, visibilityReason: "operator_only" },
      }),
    ];
    const behavioral = eventsToBehavioral(events);
    expect(behavioral).toHaveLength(1);
    expect(behavioral[0]).toMatchObject({ kind: "post", privateContent: "Fallback applied: parse error", engineAuthored: true });
  });
});
