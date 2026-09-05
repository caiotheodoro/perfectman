/**
 * Expected-signal checker — evaluates a scenario's deterministic
 * expectedSignals against the committed events + final agent states.
 */

import type { AgentState, CommittedEvent, ExpectedSignal, RoleplayScenario } from "@perfectman/shared";
import { normalizeWords } from "@perfectman/server";
import { buildMotiveIndex, motiveForEvent, isPrivateEvent, type MotiveIndex } from "../transcript/render-transcript.js";

export type SignalOutcome = {
  signal: string;
  passed: boolean;
  detail: string;
  /** Set when a `liveOnly` signal was not evaluated (mock mode); never counted in pass rates. */
  skipped?: boolean;
};

export type SignalCheckOptions = {
  llmMode?: "mock" | "local";
};

export function checkExpectedSignals(
  scenario: RoleplayScenario,
  events: readonly CommittedEvent[],
  states: ReadonlyMap<string, AgentState>,
  llmCallsFor: (agentId: string) => number,
  opts: SignalCheckOptions = {},
): SignalOutcome[] {
  const ctx: SignalContext = { scenario, events, states, llmCallsFor, motives: buildMotiveIndex(events) };
  return scenario.expectedSignals.map(sig => {
    if (sig.liveOnly && (opts.llmMode ?? "mock") === "mock") {
      return { signal: JSON.stringify(sig), passed: true, skipped: true, detail: "liveOnly signal skipped in mock mode" };
    }
    return checkSignal(sig, ctx);
  });
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
 * lands under "unknown" rather than being dropped. Skipped outcomes are
 * not rolled up: they were never evaluated.
 */
export function aggregateSignalsByKind(
  results: readonly SignalOutcome[],
): Record<string, SignalsByKindEntry> {
  const agg: Record<string, { passed: number; total: number; failExamples: string[] }> = {};
  for (const outcome of results) {
    if (outcome.skipped) continue;
    let kind = "unknown";
    try {
      const parsed = JSON.parse(outcome.signal) as { kind?: unknown };
      if (typeof parsed.kind === "string") kind = parsed.kind;
    } catch {
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

type SignalContext = {
  scenario: RoleplayScenario;
  events: readonly CommittedEvent[];
  states: ReadonlyMap<string, AgentState>;
  llmCallsFor: (agentId: string) => number;
  motives: MotiveIndex;
};

/** Case- and diacritic-insensitive comparison form. */
export function foldText(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const CONTENT_TYPES = new Set<CommittedEvent["type"]>(["message_sent", "reply_sent"]);

function contentOf(e: CommittedEvent): string {
  const c = (e.payload as Record<string, unknown>)["content"];
  return typeof c === "string" ? c : "";
}

function checkSignal(sig: ExpectedSignal, ctx: SignalContext): SignalOutcome {
  const { scenario, events, states, llmCallsFor } = ctx;
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
    case "forbidden_phrase_absent": {
      const spec = scenario.agents.find(a => a.agentId === sig.agentId);
      const phrases = sig.phrases ?? spec?.forbiddenPublicPhrases ?? [];
      if (phrases.length === 0) {
        return { signal: name, passed: false, detail: `${sig.agentId} has no forbidden phrases to check` };
      }
      for (const e of events) {
        if (e.actorId !== sig.agentId || !CONTENT_TYPES.has(e.type) || isPrivateEvent(e, scenario)) continue;
        const folded = foldText(contentOf(e));
        const hit = phrases.find(p => folded.includes(foldText(p)));
        if (hit) {
          return { signal: name, passed: false, detail: `${sig.agentId} said "${hit}" publicly at p${e.pulseIndex ?? 0} (#${e.channelId})` };
        }
      }
      return { signal: name, passed: true, detail: `${sig.agentId} kept ${phrases.length} forbidden phrase(s) out of public channels` };
    }
    case "private_channel_used": {
      const min = sig.min ?? 1;
      const count = events.filter(
        e => CONTENT_TYPES.has(e.type) && isPrivateEvent(e, scenario) && (sig.byAgentId === undefined || e.actorId === sig.byAgentId),
      ).length;
      return {
        signal: name,
        passed: count >= min,
        detail: `${sig.byAgentId ?? "anyone"} sent ${count} private-channel message(s) (min ${min})`,
      };
    }
    case "memory_referenced": {
      const spec = scenario.agents.find(a => a.agentId === sig.agentId);
      const keywords =
        spec?.secretKeywords ??
        (spec?.memories ?? []).flatMap(m => normalizeWords(m.summary).filter(w => w.length >= 4));
      const distinct = [...new Set(keywords.map(foldText))];
      if (distinct.length === 0) {
        return { signal: name, passed: false, detail: `${sig.agentId} has no secret keywords to look for` };
      }
      const haystack: string[] = [];
      for (const e of events) {
        if (e.actorId !== sig.agentId) continue;
        const motive = motiveForEvent(e, ctx.motives);
        if (motive && !motive.engineAuthored) haystack.push(motive.text);
        if (e.type === "memory_written") {
          const s = (e.payload as Record<string, unknown>)["summary"];
          if (typeof s === "string") haystack.push(s);
        }
        if (CONTENT_TYPES.has(e.type) && isPrivateEvent(e, scenario)) haystack.push(contentOf(e));
      }
      const folded = foldText(haystack.join("\n"));
      const hits = distinct.filter(k => folded.includes(k));
      const min = sig.minKeywords ?? 1;
      return {
        signal: name,
        passed: hits.length >= min,
        detail: `${sig.agentId} referenced ${hits.length}/${distinct.length} secret keyword(s) privately (min ${min})${hits.length > 0 ? `: ${hits.join(", ")}` : ""}`,
      };
    }
    case "chosen_silence_present": {
      const min = sig.min ?? 1;
      const count = events.filter(e => {
        if (e.type !== "no_op_recorded" || !e.sourceIntentId) return false;
        if (sig.agentId !== undefined && e.actorId !== sig.agentId) return false;
        const motive = motiveForEvent(e, ctx.motives);
        return motive !== undefined && !motive.engineAuthored;
      }).length;
      return {
        signal: name,
        passed: count >= min,
        detail: `${sig.agentId ?? "anyone"} chose silence with a real motive ${count} time(s) (min ${min})`,
      };
    }
    default:
      return { signal: name, passed: false, detail: "unknown signal kind" };
  }
}
