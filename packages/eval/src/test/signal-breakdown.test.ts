import { describe, it, expect } from "vitest";
import { aggregateSignalsByKind } from "../run/signal-checker.js";
import type { SignalOutcome } from "../run/signal-checker.js";

function outcome(kind: string, passed: boolean, detail = "detail"): SignalOutcome {
  return { signal: JSON.stringify({ kind, agentId: "a" }), passed, detail };
}

describe("aggregateSignalsByKind (#42)", () => {
  it("returns an empty record for no outcomes", () => {
    expect(aggregateSignalsByKind([])).toEqual({});
  });

  it("groups pass/fail counts per kind", () => {
    const agg = aggregateSignalsByKind([
      outcome("emotion_rises", true),
      outcome("emotion_rises", false, "bruno.jealousy = 0.1 (min 0.5)"),
      outcome("emotion_rises", false, "no state for caio"),
      outcome("event_committed", true),
    ]);
    expect(agg["emotion_rises"]).toEqual({
      passed: 1,
      total: 3,
      passRate: 1 / 3,
      failExamples: ["bruno.jealousy = 0.1 (min 0.5)", "no state for caio"],
    });
    expect(agg["event_committed"]).toEqual({
      passed: 1,
      total: 1,
      passRate: 1,
      failExamples: [],
    });
  });

  it("caps failing examples at 3", () => {
    const agg = aggregateSignalsByKind([
      outcome("llm_calls_range", false, "f1"),
      outcome("llm_calls_range", false, "f2"),
      outcome("llm_calls_range", false, "f3"),
      outcome("llm_calls_range", false, "f4"),
      outcome("llm_calls_range", false, "f5"),
    ]);
    expect(agg["llm_calls_range"]!.total).toBe(5);
    expect(agg["llm_calls_range"]!.passed).toBe(0);
    expect(agg["llm_calls_range"]!.failExamples).toEqual(["f1", "f2", "f3"]);
  });

  it("lands unparsable signals under 'unknown' instead of dropping them", () => {
    const agg = aggregateSignalsByKind([
      { signal: "not-json{", passed: false, detail: "weird" },
      { signal: '{"noKindHere":1}', passed: true, detail: "" },
    ]);
    expect(agg["unknown"]).toBeDefined();
    expect(agg["unknown"]!.total).toBe(2);
    expect(agg["unknown"]!.passRate).toBe(0.5);
    expect(agg["unknown"]!.failExamples).toEqual(["weird"]);
  });
});
