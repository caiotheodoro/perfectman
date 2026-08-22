import type { Memory } from "@perfectman/shared";

/**
 * Memory salience for perception-packet retrieval.
 *
 * Replaces the flat (relevanceFlag, recency) sort: recency as a sort key
 * evicts genuinely important older memories once the store grows (long-
 * running scenes), so it becomes a bounded term among the signals the
 * Memory type already carries — subject relevance, memory type, authored
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
const RECENCY_WEIGHT = 0.5;

export function scoreMemorySalience(
  memory: Memory,
  involvedPeople: ReadonlySet<string>,
  newestCreatedAt: number,
  oldestCreatedAt: number,
): number {
  const relevant = memory.subjectAgentIds.some(id => involvedPeople.has(id)) ? 1 : 0;
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
    memory.confidence +
    (memory.unresolved ? UNRESOLVED_WEIGHT : 0) +
    RECENCY_WEIGHT * recency
  );
}

export function selectRelevantMemories(
  memories: readonly Memory[],
  involvedPeople: ReadonlySet<string>,
  maxMemories: number,
): Memory[] {
  if (memories.length === 0) return [];
  // reduce, not spread: huge stores would blow the argument limit.
  const first = memories[0]!.createdAt;
  const newestCreatedAt = memories.reduce((max, m) => Math.max(max, m.createdAt), first);
  const oldestCreatedAt = memories.reduce((min, m) => Math.min(min, m.createdAt), first);
  return [...memories]
    .map(memory => ({
      memory,
      score: scoreMemorySalience(memory, involvedPeople, newestCreatedAt, oldestCreatedAt),
    }))
    .sort((a, b) => b.score - a.score || b.memory.createdAt - a.memory.createdAt)
    .slice(0, maxMemories)
    .map(entry => entry.memory);
}
