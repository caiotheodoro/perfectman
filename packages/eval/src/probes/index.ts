/**
 * Deterministic behavioral probes — TS port of the substrate sim-probes
 * (latency, lurking, interruption, silence-misreading, alliance) plus
 * perfectman-specific probes (private-channel density, no-op meaningfulness,
 * AI-leak, emoji reaction, memory write, fallback rate, refusal-free).
 *
 * All probes are pure functions over the event stream. No LLM.
 */

import type { BehavioralEvent, ProbeInput } from "./types.js";
import { checkProbe, PROBE_BANDS, type ProbeResult } from "./types.js";
import { isNearRepeat, similarity as jaccardSimilarity, REPETITION_SIMILARITY_THRESHOLD } from "@perfectman/server";

export * from "./adapter.js";
export type { BehavioralEvent, BehavioralEventKind, ProbeBound, ProbeInput, ProbeResult } from "./types.js";

// ── Latency ──────────────────────────────────────────────────────────────────

export function latencyStats(
  events: readonly BehavioralEvent[],
  agentIds: readonly string[],
): { meanGap: number; p95Gap: number } {
  const gaps: number[] = [];
  for (const agentId of agentIds) {
    const own = events.filter(e => e.agentId === agentId && e.kind !== "silence");
    for (let i = 1; i < own.length; i++) {
      const gap = own[i]!.pulseIndex - own[i - 1]!.pulseIndex;
      if (gap > 0) gaps.push(gap);
    }
  }
  if (gaps.length === 0) return { meanGap: 0, p95Gap: 0 };
  const sorted = [...gaps].sort((a, b) => a - b);
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
  return { meanGap: mean, p95Gap: p95 };
}

// ── Lurking ──────────────────────────────────────────────────────────────────

export function lurkingRate(
  events: readonly BehavioralEvent[],
  agentIds: readonly string[],
  totalPulses: number,
): number {
  if (totalPulses <= 0) return 0;
  const counts = new Map(agentIds.map(id => [id, 0]));
  for (const e of events) {
    if (e.kind !== "silence" && counts.has(e.agentId)) {
      counts.set(e.agentId, counts.get(e.agentId)! + 1);
    }
  }
  let silentPulses = 0;
  for (const id of agentIds) {
    silentPulses += Math.max(0, totalPulses - counts.get(id)!);
  }
  return silentPulses / (totalPulses * agentIds.length);
}

// ── Interruption (turn collision) ────────────────────────────────────────────

/**
 * Interruption = talking over someone: two NEW messages (not replies) by
 * different agents landing in the same scheduler pulse. Perfectman's
 * scheduler legitimately lets several agents act per pulse; this probe
 * targets the "everyone posts simultaneously" anti-pattern (emotion.md),
 * not reply overlap.
 */
export function interruptionRate(events: readonly BehavioralEvent[]): number {
  const posts = events.filter(e => e.kind === "post");
  if (posts.length <= 1) return 0;
  let collisions = 0;
  for (let i = 1; i < posts.length; i++) {
    const prev = posts[i - 1]!;
    const cur = posts[i]!;
    if (prev.agentId !== cur.agentId && cur.pulseIndex - prev.pulseIndex <= 0) {
      collisions++;
    }
  }
  return collisions / (posts.length - 1);
}

// ── Silence misreading (silence → confrontation within 2 pulses) ─────────────

const CONFRONT_LEXICON = [
  "ignora", "ignorou", "ignorando", "sumiu", "some", "quiet", "silêncio",
  "quieto", "calado", "calada", "fingindo", "fingir", "doido", "doida",
  "fracasso", "fraco", "fraca", "nunca fala", "não fala", "ta mudo", "tá mudo",
  "você não", "cê não", "eu sei o que", "sabemos", "não engana",
];

export function silenceMisreadingRate(events: readonly BehavioralEvent[]): number {
  const silences = events
    .map((e, i) => ({ e, i }))
    .filter(x => x.e.kind === "silence");
  if (silences.length === 0) return 0;
  let misread = 0;
  for (const { e, i } of silences) {
    const window = events.slice(i + 1, i + 3);
    const confronted = window.some(
      w =>
        (w.kind === "post" || w.kind === "reply") &&
        w.agentId !== e.agentId &&
        hasConfrontation(w.content),
    );
    if (confronted) misread++;
  }
  return misread / silences.length;
}

function hasConfrontation(content?: string): boolean {
  if (!content) return false;
  const lower = content.toLowerCase();
  return CONFRONT_LEXICON.some(term => lower.includes(term));
}

// ── Alliance (dyad private channels + repeated reply pairs) ──────────────────

export function allianceRate(events: readonly BehavioralEvent[]): number {
  const dyads = new Set<string>();
  for (const e of events) {
    if (e.kind === "private_channel") {
      const members = (e.payload.memberAgentIds ?? []) as string[];
      if (members.length === 2) {
        dyads.add([...members].sort().join("|"));
      }
    }
  }
  const replyPairs = new Map<string, number>();
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.kind !== "reply") continue;
    const target = e.payload.replyToAgentId ?? findRecentSpeaker(events, i);
    if (!target) continue;
    const key = [e.agentId, target].sort().join("|");
    replyPairs.set(key, (replyPairs.get(key) ?? 0) + 1);
  }
  for (const [pair, count] of replyPairs) {
    if (count >= 3) dyads.add(pair);
  }
  if (events.length === 0) return 0;
  return dyads.size / events.length;
}

function findRecentSpeaker(events: readonly BehavioralEvent[], upTo: number): string | undefined {
  for (let i = upTo - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === "post" || e.kind === "reply") return e.agentId;
  }
  return undefined;
}

// ── Perfectman-specific probes ───────────────────────────────────────────────

const AI_LEAK_LEXICON = [
  "as an ai", "as an ai", "as a language model", "i am an ai", "i'm an ai",
  "as an artificial", "language model", "i cannot", "i'm sorry, i can't",
  "como uma ia", "como um modelo de linguagem", "sou uma ia", "não posso ajudar",
  "não posso fazer", "eu não tenho sentimentos", "enquanto ia", "como ia",
  "chatbot", "assistente virtual", "modelo de linguagem",
];

export function aiLeakRate(events: readonly BehavioralEvent[]): number {
  const textual = events.filter(
    e => e.kind === "post" || e.kind === "reply" || e.kind === "silence" || e.kind === "react",
  );
  if (textual.length === 0) return 0;
  const leaked = textual.filter(e => {
    const text = `${e.content ?? ""} ${e.privateContent ?? ""}`.toLowerCase();
    return AI_LEAK_LEXICON.some(term => text.includes(term));
  });
  return leaked.length / textual.length;
}

export function noOpMeaningfulness(events: readonly BehavioralEvent[]): number {
  const silences = events.filter(e => e.kind === "silence");
  if (silences.length === 0) return 1; // nothing meaningless recorded → pass
  const meaningful = silences.filter(e => {
    const motive = e.privateContent ?? "";
    return motive.trim().length > 8;
  });
  return meaningful.length / silences.length;
}

export function privateChannelDensity(events: readonly BehavioralEvent[]): number {
  const channels = events.filter(e => e.kind === "private_channel").length;
  const textual = events.filter(e => e.kind === "post" || e.kind === "reply" || e.kind === "react").length;
  if (textual + channels === 0) return 0;
  return channels / (textual + channels);
}

export function emojiReactionRate(events: readonly BehavioralEvent[]): number {
  const reacts = events.filter(e => e.kind === "react").length;
  const posts = events.filter(e => e.kind === "post" || e.kind === "reply").length;
  if (posts + reacts === 0) return 0;
  return reacts / (posts + reacts);
}

export function memoryWriteRate(events: readonly BehavioralEvent[]): number {
  if (events.length === 0) return 0;
  const memories = events.filter(e => e.kind === "memory").length;
  return memories / events.length;
}

// ── Content repetition ───────────────────────────────────────────────────────

/**
 * Share of content-bearing turns that near-repeat the same agent's own
 * earlier utterances anywhere in the transcript (Jaccard word-overlap via
 * the runtime's canonical isNearRepeat). This measures *text* similarity —
 * the CNS stagnation metric only measures actor turn-taking diversity, and
 * the verbatim-repetition bug this project hit (#27) was a
 * same-agent-different-turns pattern neither existing metric caught.
 *
 * Assumes events are in chronological order (the pipeline's
 * eventsToBehavioral sorts by pulseIndex); "earlier" means earlier array
 * position per agent.
 */
export function contentRepetitionRate(
  events: readonly BehavioralEvent[],
  threshold: number = REPETITION_SIMILARITY_THRESHOLD,
): number {
  const contentTurns = events.filter(
    e => (e.kind === "post" || e.kind === "reply") && !!e.content?.trim(),
  );
  if (contentTurns.length === 0) return 0;
  const ownUtterances = new Map<string, string[]>();
  let repeated = 0;
  for (const turn of contentTurns) {
    const priors = ownUtterances.get(turn.agentId) ?? [];
    if (isNearRepeat(turn.content!, priors, threshold)) repeated++;
    priors.push(turn.content!);
    ownUtterances.set(turn.agentId, priors);
  }
  return repeated / contentTurns.length;
}

// ── Cross-agent echo (attractor states) ─────────────────────────────────────

/**
 * Share of content-bearing turns that near-repeat an EARLIER utterance by a
 * DIFFERENT agent — the multi-agent convergence / attractor-state signal
 * the per-agent repetition guard structurally cannot see. Assumes events in
 * chronological order (same contract as contentRepetitionRate).
 */
export function crossAgentEchoRate(
  events: readonly BehavioralEvent[],
  threshold: number = REPETITION_SIMILARITY_THRESHOLD,
): number {
  const contentTurns = events.filter(
    e => (e.kind === "post" || e.kind === "reply") && !!e.content?.trim(),
  );
  if (contentTurns.length === 0) return 0;
  const utterancesByAgent = new Map<string, string[]>();
  let echoed = 0;
  for (const turn of contentTurns) {
    const others: string[] = [];
    for (const [agentId, utterances] of utterancesByAgent) {
      if (agentId !== turn.agentId) others.push(...utterances);
    }
    if (isNearRepeat(turn.content!, others, threshold)) echoed++;
    const own = utterancesByAgent.get(turn.agentId) ?? [];
    own.push(turn.content!);
    utterancesByAgent.set(turn.agentId, own);
  }
  return echoed / contentTurns.length;
}

/**
 * Attractor attribution: for each echoed turn, which agent's earlier text it
 * most resembles (highest Jaccard above threshold). Returns counts keyed as
 * "target<-source". Answers "who pulls whom" from any bench artifact.
 */
export function echoSourcesByAgent(
  events: readonly BehavioralEvent[],
  threshold: number = REPETITION_SIMILARITY_THRESHOLD,
): Record<string, number> {
  const counts: Record<string, number> = {};
  const contentTurns = events.filter(
    e => (e.kind === "post" || e.kind === "reply") && !!e.content?.trim(),
  );
  const utterancesByAgent = new Map<string, string[]>();
  for (const turn of contentTurns) {
    let bestSource: string | undefined;
    let bestScore = 0;
    for (const [agentId, utterances] of utterancesByAgent) {
      if (agentId === turn.agentId) continue;
      for (const prior of utterances) {
        const score = jaccardSimilarity(turn.content!, prior);
        if (score >= threshold && score > bestScore) {
          bestScore = score;
          bestSource = agentId;
        }
      }
    }
    if (bestSource) {
      const key = `${turn.agentId}<-${bestSource}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const own = utterancesByAgent.get(turn.agentId) ?? [];
    own.push(turn.content!);
    utterancesByAgent.set(turn.agentId, own);
  }
  return counts;
}

// ── Aggregate ────────────────────────────────────────────────────────────────

export function runAllProbes(input: ProbeInput): ProbeResult[] {
  const { events, agentIds, totalPulses } = input;
  const { meanGap, p95Gap } = latencyStats(events, agentIds);

  const fallbackRate =
    input.totalLlmCalls && input.totalLlmCalls > 0
      ? (input.fallbackCount ?? 0) / input.totalLlmCalls
      : 0;

  const refusalFree = 1 - aiLeakRate(events);

  return [
    checkProbe("latency-mean", "Mean reply latency (pulses)", meanGap, PROBE_BANDS["latency-mean"]!),
    checkProbe("latency-p95", "p95 reply latency (pulses)", p95Gap, PROBE_BANDS["latency-p95"]!),
    checkProbe("lurking", "Lurking rate", lurkingRate(events, agentIds, totalPulses), PROBE_BANDS["lurking"]!),
    checkProbe("interruption", "Turn collision rate", interruptionRate(events), PROBE_BANDS["interruption"]!),
    checkProbe(
      "silence-misreading",
      "Silence misread as confrontation",
      silenceMisreadingRate(events),
      PROBE_BANDS["silence-misreading"]!,
    ),
    checkProbe("alliance", "Alliance density", allianceRate(events), PROBE_BANDS["alliance"]!),
    checkProbe(
      "private-channel-density",
      "Private channel density",
      privateChannelDensity(events),
      PROBE_BANDS["private-channel-density"]!,
    ),
    checkProbe(
      "noop-meaningfulness",
      "No-op with real motive",
      noOpMeaningfulness(events),
      PROBE_BANDS["noop-meaningfulness"]!,
    ),
    checkProbe("ai-leak", "AI/refusal leakage", aiLeakRate(events), PROBE_BANDS["ai-leak"]!),
    checkProbe(
      "emoji-reaction",
      "Emoji reaction rate",
      emojiReactionRate(events),
      PROBE_BANDS["emoji-reaction"]!,
    ),
    checkProbe("memory-write", "Memory write density", memoryWriteRate(events), PROBE_BANDS["memory-write"]!),
    checkProbe(
      "content-repetition",
      "Near-repeat share of content turns",
      contentRepetitionRate(events),
      PROBE_BANDS["content-repetition"]!,
    ),
    checkProbe(
      "cross-agent-echo",
      "Cross-agent echo share of content turns",
      crossAgentEchoRate(events),
      PROBE_BANDS["cross-agent-echo"]!,
    ),
    checkProbe("fallback-rate", "LLM fallback rate", fallbackRate, PROBE_BANDS["fallback-rate"]!),
    checkProbe("refusal-free", "Refusal-free rate", refusalFree, PROBE_BANDS["refusal-free"]!),
  ];
}
