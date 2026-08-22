import { describe, it, expect } from "vitest";
import { intentEntropyScore } from "../judge/judge.js";
import type { CommittedEvent } from "@perfectman/shared";

function ev(type: string, actorId = "a"): CommittedEvent {
  return {
    id: `${type}-${Math.random()}`,
    simulationId: "s",
    channelId: "ch",
    actorId,
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

  it("approaches the ceiling only when the FULL choice set is used uniformly", () => {
    const events = [
      ...Array.from({ length: 3 }, () => ev("message_sent")),
      ...Array.from({ length: 3 }, () => ev("reply_sent")),
      ...Array.from({ length: 3 }, () => ev("reaction_sent")),
      ...Array.from({ length: 3 }, () => ev("no_op_recorded")),
      ...Array.from({ length: 3 }, () => ev("channel_created")),
    ];
    expect(intentEntropyScore(events)).toBeCloseTo(1, 5);
  });

  it("does not read a message/reply-only room as maximally unpredictable", () => {
    // log(2)/log(5) ≈ 0.43, NOT the old ceiling — the 50/50 two-type mix is
    // the most ordinary chat shape and must not score H=1.
    const room = [
      ...Array.from({ length: 5 }, () => ev("message_sent")),
      ...Array.from({ length: 5 }, () => ev("reply_sent")),
    ];
    expect(intentEntropyScore(room)).toBeCloseTo(Math.log(2) / Math.log(5), 5);
  });

  it("averages per-agent, so one diverse actor cannot mask predictable ones", () => {
    // A: message/reply 50/50 (uniform over 2 types => log2/log5)
    // B: reacts every turn (=> 0)
    const room = [
      ...Array.from({ length: 3 }, () => ev("message_sent", "a")),
      ...Array.from({ length: 3 }, () => ev("reply_sent", "a")),
      ...Array.from({ length: 10 }, () => ev("reaction_sent", "b")),
    ];
    const pooled = Math.log(2) / Math.log(3); // what the old pooling would report
    expect(pooled).toBeGreaterThan(intentEntropyScore(room));
    expect(intentEntropyScore(room)).toBeCloseTo((Math.log(2) / Math.log(5)) / 2, 5);
  });

  it("counts the create-channel batch as ONE choice (agent_invited ignored)", () => {
    // One create decision emits channel_created + N agent_invited echoes;
    // counting both would inflate one decision across two buckets.
    const batched = [
      ev("channel_created"),
      ev("agent_invited"),
      ev("agent_invited"),
      ev("agent_invited"),
    ];
    expect(intentEntropyScore(batched)).toBe(0); // single type => floor
    const mixed = [
      ev("channel_created"),
      ev("agent_invited"),
      ev("agent_invited"),
      ev("message_sent"),
      ev("message_sent"),
    ];
    // channel_created 1 + message_sent 2 => H = (1/3 mix) computed over 2 types
    const h = -( (1/3) * Math.log(1/3) + (2/3) * Math.log(2/3) ) / Math.log(5);
    expect(intentEntropyScore(mixed)).toBeCloseTo(h, 5);
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
