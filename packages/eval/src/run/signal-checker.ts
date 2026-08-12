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
