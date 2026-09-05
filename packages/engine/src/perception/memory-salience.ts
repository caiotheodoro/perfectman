import type { Memory } from "@perfectman/shared";

/**
 * Memory salience for perception-packet retrieval.
 *
 * Replaces the flat (relevanceFlag, recency) sort: recency as a sort key
 * evicts genuinely important older memories once the store grows (long-
 * running scenes), so it becomes a bounded term among the signals the
 * Memory type already carries — subject relevance, memory type, decayed
 * confidence, and open loops. Pure: no I/O, deterministic, stable ties.
 */

export const MEMORY_TYPE_WEIGHTS: Record<Memory["type"], number> = {
  pending_intention: 1.0,
  relationship: 0.8,
  self: 0.5,
  social_theory: 0.4,
  emotional_residue: 0.4,
  episodic: 0.3,
};

const RELEVANCE_WEIGHT = 2.5; // > max opposing delta (0.7 + 1.0 + 0.25 + 0.5) so relevance strictly dominates
const UNRESOLVED_WEIGHT = 0.25;
const RECENCY_WEIGHT = 0.2; // reduced from 0.5 — decay now carries most of the recency signal

/**
 * Power-law decay: per-memory-type base rate `d`, provisional pending #129
 * tuning. Ordering (trait-like types decay slowest) matches the existing
 * `MEMORY_TYPE_WEIGHTS` tiering; absolute values are calibration targets from
 * the human-memory research spec (issue #131).
 */
export const MEMORY_DECAY_RATES: Record<Memory["type"], number> = {
  pending_intention: 0.04,
  self: 0.05,
  social_theory: 0.06,
  relationship: 0.08,
  emotional_residue: 0.12,
  episodic: 0.18,
};

// d_eff = d · (1 − EMOTIONAL_PROTECTION_FACTOR · intensity) — protects strength,
// not accuracy. Provisional pending #129 tuning.
const EMOTIONAL_PROTECTION_FACTOR = 0.6;

// retention(agePulses, d) = DECAY_FLOOR + DECAY_SCALE · (1 + agePulses)^(−d).
// Steep-then-flat Ebbinghaus shape; DECAY_FLOOR is a permanent floor so a
// memory's confidence never fully vanishes. DECAY_FLOOR + DECAY_SCALE = 1 so
// a just-reinforced memory (agePulses = 0) always retains 100% regardless of d.
const DECAY_FLOOR = 0.10;
const DECAY_SCALE = 0.90;

export const EVICTION_CONFIDENCE_THRESHOLD = 0.05;
export const EVICTION_MIN_AGE_PULSES = 20;
export const MAX_MEMORIES = 500;

/**
 * Confidence discounted by power-law decay since the memory was last
 * reinforced (recalled), with emotional protection slowing high-intensity
 * memories. Lazily computed at read time — decay is never written back,
 * only `lastReinforcedAt` is (reinforcement).
 */
export function effectiveConfidence(memory: Memory, now: number, pulseIntervalMs: number): number {
  const agePulses = Math.max(0, (now - memory.lastReinforcedAt) / pulseIntervalMs);
  const dType = MEMORY_DECAY_RATES[memory.type] ?? MEMORY_DECAY_RATES.episodic;
  const dEff = dType * (1 - EMOTIONAL_PROTECTION_FACTOR * memory.intensity);
  const retention = DECAY_FLOOR + DECAY_SCALE * Math.pow(1 + agePulses, -dEff);
  return memory.confidence * retention;
}

/**
 * Eviction gate for the memory projection: a memory this faded and this
 * stale is dropped, unless it is an open loop (Zeigarnik exemption) —
 * `unresolved` or `pending_intention` memories are never evicted by this
 * gate, only by the `MAX_MEMORIES` backstop.
 */
export function shouldEvictMemory(memory: Memory, now: number, pulseIntervalMs: number): boolean {
  if (memory.unresolved || memory.type === "pending_intention") return false;
  const agePulses = (now - memory.lastReinforcedAt) / pulseIntervalMs;
  return (
    agePulses > EVICTION_MIN_AGE_PULSES &&
    effectiveConfidence(memory, now, pulseIntervalMs) < EVICTION_CONFIDENCE_THRESHOLD
  );
}

export function scoreMemorySalience(
  memory: Memory,
  involvedPeople: ReadonlySet<string>,
  selfId: string,
  newestCreatedAt: number,
  oldestCreatedAt: number,
  now: number,
  pulseIntervalMs: number,
): number {
  // Root-caused via a real capture: `involvedPeople` deliberately excludes
  // the agent's own id (it means "who ELSE is in this exchange" — see
  // build-perception-packet.ts). A self-subject memory (subjectAgentIds:
  // [agent's own id] — exactly the shape used for "my own secret/plan",
  // the hidden-objective mechanic's bread and butter) could therefore NEVER
  // earn the dominant relevance bonus, no matter how central it was to the
  // agent's own behavior. A memory about myself is trivially relevant to me.
  const relevant = memory.subjectAgentIds.some(id => involvedPeople.has(id) || id === selfId) ? 1 : 0;
  const typeWeight = MEMORY_TYPE_WEIGHTS[memory.type] ?? 0.3;

  // Normalized over the whole store's span, not per-memory: a per-memory span
  // makes every non-newest memory score 0, collapsing the decay into
  // newest-or-nothing and erasing the ordering between recent and ancient.
  const ageSpan = Math.max(1, newestCreatedAt - oldestCreatedAt);
  const ageOfThis = Math.max(0, newestCreatedAt - memory.createdAt);
  const recency = 1 - Math.min(1, ageOfThis / ageSpan);

  return (
    RELEVANCE_WEIGHT * relevant +
    typeWeight +
    effectiveConfidence(memory, now, pulseIntervalMs) +
    (memory.unresolved ? UNRESOLVED_WEIGHT : 0) +
    RECENCY_WEIGHT * recency
  );
}

export function selectRelevantMemories(
  memories: readonly Memory[],
  involvedPeople: ReadonlySet<string>,
  selfId: string,
  maxMemories: number,
  now: number,
  pulseIntervalMs: number,
): Memory[] {
  if (memories.length === 0) return [];
  // reduce, not spread: huge stores would blow the argument limit.
  const first = memories[0]!.createdAt;
  const newestCreatedAt = memories.reduce((max, m) => Math.max(max, m.createdAt), first);
  const oldestCreatedAt = memories.reduce((min, m) => Math.min(min, m.createdAt), first);
  return [...memories]
    .map(memory => ({
      memory,
      score: scoreMemorySalience(
        memory,
        involvedPeople,
        selfId,
        newestCreatedAt,
        oldestCreatedAt,
        now,
        pulseIntervalMs,
      ),
    }))
    .sort((a, b) => b.score - a.score || b.memory.createdAt - a.memory.createdAt)
    .slice(0, maxMemories)
    .map(entry => entry.memory);
}
