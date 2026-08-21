/**
 * Expected-signal checker — evaluates a scenario's deterministic
 * expectedSignals against the committed events + final agent states.
 */

import type { AgentState, CommittedEvent, ExpectedSignal, RoleplayScenario } from "@perfectman/shared";

export type SignalOutcome = {
  signal: string;
  passed: boolean;
  detail: string;
};

export function checkExpectedSignals(
  scenario: RoleplayScenario,
  events: readonly CommittedEvent[],
  states: ReadonlyMap<string, AgentState>,
  llmCallsFor: (agentId: string) => number,
): SignalOutcome[] {
  return scenario.expectedSignals.map(sig => checkSignal(sig, events, states, llmCallsFor));
}

export type SignalsByKindEntry = {
  passed: number;
  total: number;
  passRate: number;
  failExamples: string[];
};

const MAX_FAIL_EXAMPLES = 3;

/**
 * Rolls SignalOutcome[] up per signal kind ("emotion_rises",
 * "event_committed", …). Outcomes carry the full signal JSON-stringified in
 * `signal`, so the kind is recovered by parsing it; anything unparsable
 * lands under "unknown" rather than being dropped.
 */
export function aggregateSignalsByKind(
  results: readonly SignalOutcome[],
): Record<string, SignalsByKindEntry> {
  const agg: Record<string, { passed: number; total: number; failExamples: string[] }> = {};
  for (const outcome of results) {
    let kind = "unknown";
    try {
      const parsed = JSON.parse(outcome.signal) as { kind?: unknown };
      if (typeof parsed.kind === "string") kind = parsed.kind;
    } catch {
      // keep "unknown"
    }
    agg[kind] ??= { passed: 0, total: 0, failExamples: [] };
    agg[kind]!.total++;
    if (outcome.passed) {
      agg[kind]!.passed++;
    } else if (agg[kind]!.failExamples.length < MAX_FAIL_EXAMPLES) {
      agg[kind]!.failExamples.push(outcome.detail);
    }
  }
  return Object.fromEntries(
    Object.entries(agg).map(([kind, a]) => [kind, {
      passed: a.passed,
      total: a.total,
      passRate: a.passed / a.total,
      failExamples: a.failExamples,
    }]),
  );
}

function checkSignal(
  sig: ExpectedSignal,
  events: readonly CommittedEvent[],
  states: ReadonlyMap<string, AgentState>,
  llmCallsFor: (agentId: string) => number,
): SignalOutcome {
  const name = JSON.stringify(sig);
  const byType = (t: string) => events.filter(e => e.type === t);
  const socialField = (agentId: string, field: string): number => {
    const state = states.get(agentId);
    if (!state) return NaN;
    const v = (state.socialEmotions as Record<string, number>)[field];
    return typeof v === "number" ? v : NaN;
  };

  switch (sig.kind) {
    case "emotion_rises": {
      const final = socialField(sig.agentId, sig.field);
      const min = sig.min ?? 0;
      if (Number.isNaN(final)) {
        return { signal: name, passed: false, detail: `no state for ${sig.agentId}` };
      }
      const passed = final >= min;
      return {
        signal: name,
        passed,
        detail: `${sig.agentId}.${sig.field} = ${final.toFixed(3)} (min ${min})`,
      };
    }
    case "emotion_stays": {
      const final = socialField(sig.agentId, sig.field);
      const min = sig.min ?? 0;
      if (Number.isNaN(final)) {
        return { signal: name, passed: false, detail: `no state for ${sig.agentId}` };
      }
      const passed = final >= min;
      return {
        signal: name,
        passed,
        detail: `${sig.agentId}.${sig.field} = ${final.toFixed(3)} (floor ${min})`,
      };
    }
    case "event_committed": {
      const count = byType(sig.eventType).length;
      const min = sig.min ?? 1;
      return {
        signal: name,
        passed: count >= min,
        detail: `${sig.eventType} committed ${count} (min ${min})`,
      };
    }
    case "no_event_of_type": {
      const count = byType(sig.eventType).length;
      return {
        signal: name,
        passed: count === 0,
        detail: `${sig.eventType} committed ${count} (expected 0)`,
      };
    }
    case "llm_calls_range": {
      const calls = llmCallsFor(sig.agentId);
      return {
        signal: name,
        passed: calls >= sig.min && calls <= sig.max,
        detail: `${sig.agentId} llm calls ${calls} (range ${sig.min}-${sig.max})`,
      };
    }
    case "no_llm_failures": {
      const count = byType("llm_failure").length;
      return {
        signal: name,
        passed: count === 0,
        detail: `llm_failure events: ${count}`,
      };
    }
    case "private_channel_created": {
      const channels = events.filter(e => e.type === "channel_created" && e.actorId === sig.byAgentId);
      return {
        signal: name,
        passed: channels.length > 0,
        detail: `${sig.byAgentId} created ${channels.length} private channel(s)`,
      };
    }
    default:
      return { signal: name, passed: false, detail: "unknown signal kind" };
  }
}
