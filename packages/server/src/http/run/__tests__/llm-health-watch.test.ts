/**
 * A run whose model never answers usably is a failed run, not a quiet one.
 * The health check catches a dead endpoint or a bad key before the run;
 * this catches the case it cannot: a model that answers, but with nothing
 * the parser can use — wrong output format, reasoning eating the budget.
 */
import { describe, expect, it } from "vitest";
import type { OperatorEvent } from "@perfectman/shared";
import { LlmHealthWatch } from "../llm-health-watch.js";

function intent(agentId: string, motive: string, pulseIndex = 0): OperatorEvent {
  return {
    type: "action_intent",
    simulationId: "s",
    agentId,
    pulseIndex,
    detail: "Action intent",
    data: { intentId: "i", intentType: "no_op", privateMotiveSummary: motive, emotionDrivers: [], motivationDrivers: [] },
    createdAt: 0,
  };
}

describe("LlmHealthWatch", () => {
  it("fails the run when the first three calls are all engine fallbacks", () => {
    const watch = new LlmHealthWatch(3);
    expect(watch.observe(intent("a", "Provider failed: HTTP 401: bad key"))).toBeNull();
    expect(watch.observe(intent("b", "Fallback applied: could not parse intent JSON"))).toBeNull();
    const fatal = watch.observe(intent("c", "Retry call failed."));
    expect(fatal?.message).toContain("first 3");
    expect(fatal?.message).toContain("Retry call failed.");
    expect(fatal?.hint).toMatch(/key|JSON/);
  });

  it("lets a run through once any call has answered usably", () => {
    const watch = new LlmHealthWatch(3);
    watch.observe(intent("a", "Provider failed: HTTP 500"));
    watch.observe(intent("b", "quero fofocar no privado"));
    expect(watch.observe(intent("c", "Provider failed: HTTP 500"))).toBeNull();
    expect(watch.observe(intent("d", "Provider failed: HTTP 500"))).toBeNull();
  });

  it("does not count the engine's own silences as model failures", () => {
    const watch = new LlmHealthWatch(2);
    watch.observe(intent("a", "Repetition guard: near-duplicate"));
    expect(watch.observe(intent("b", "LLM budget exceeded: minute cap"))).toBeNull();
  });

  it("ignores everything that is not an intent", () => {
    const watch = new LlmHealthWatch(1);
    expect(watch.observe({ type: "llm_failure", simulationId: "s", agentId: "a", pulseIndex: 0, detail: "x", createdAt: 0 })).toBeNull();
  });
});
