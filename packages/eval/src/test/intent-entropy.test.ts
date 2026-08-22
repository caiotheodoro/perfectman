import { describe, it, expect } from "vitest";
import { intentEntropyScore } from "../judge/judge.js";
import type { CommittedEvent } from "@perfectman/shared";

function ev(type: string): CommittedEvent {
  return {
    id: `${type}-${Math.random()}`,
    simulationId: "s",
    channelId: "ch",
    actorId: "a",
    type: type as CommittedEvent["type"],
    payload: {},
    createdAt: 1,
    pulseIndex: 1,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "x",
    },
  };
}

describe("intentEntropyScore (#32)", () => {
  it("scores a single repeated action type at the floor", () => {
    const events = Array.from({ length: 10 }, () => ev("message_sent"));
    expect(intentEntropyScore(events)).toBe(0);
  });

  it("approaches the ceiling for uniformly spread choices", () => {
    const events = [
      ...Array.from({ length: 3 }, () => ev("message_sent")),
      ...Array.from({ length: 3 }, () => ev("reply_sent")),
      ...Array.from({ length: 3 }, () => ev("reaction_sent")),
      ...Array.from({ length: 3 }, () => ev("no_op_recorded")),
    ];
    expect(intentEntropyScore(events)).toBeCloseTo(1, 5);
  });

  it("increases as the choice distribution becomes less skewed", () => {
    const single = Array.from({ length: 6 }, () => ev("message_sent"));
    const skewed = [
      ...Array.from({ length: 5 }, () => ev("message_sent")),
      ev("reply_sent"),
    ];
    const balanced = Array.from({ length: 3 }, () => ev("message_sent")).concat(
      Array.from({ length: 3 }, () => ev("reply_sent")),
    );
    const hSingle = intentEntropyScore(single);
    const hSkewed = intentEntropyScore(skewed);
    const hBalanced = intentEntropyScore(balanced);
    expect(hSkewed).toBeGreaterThan(hSingle);
    expect(hBalanced).toBeGreaterThan(hSkewed);
  });

  it("ignores operator and spectator event types", () => {
    const noisy = [ev("llm_failure"), ev("recap_generated"), ev("operator_warning")];
    expect(intentEntropyScore(noisy)).toBe(0);
  });

  it("returns 0 for an empty event list", () => {
    expect(intentEntropyScore([])).toBe(0);
  });
});
