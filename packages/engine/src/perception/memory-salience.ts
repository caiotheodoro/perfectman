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

const RELEVANCE_WEIGHT = 2.0;
const UNRESOLVED_WEIGHT = 0.25;
const RECENCY_WEIGHT = 0.5;

export function scoreMemorySalience(
  memory: Memory,
  involvedPeople: ReadonlySet<string>,
  newestCreatedAt: number,
): number {
  const relevant = memory.subjectAgentIds.some(id => involvedPeople.has(id)) ? 1 : 0;
  const typeWeight = MEMORY_TYPE_WEIGHTS[memory.type] ?? 0.3;

  const ageSpan = Math.max(1, newestCreatedAt - Math.min(memory.createdAt, newestCreatedAt));
  // Memories created at `newestCreatedAt` get 1; older ones decay linearly to 0.
  const ageOfThis = Math.max(0, newestCreatedAt - memory.createdAt);
  const recency = 1 - ageOfThis / ageSpan;

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
  const newestCreatedAt = Math.max(...memories.map(m => m.createdAt));
  return [...memories]
    .map(memory => ({
      memory,
      score: scoreMemorySalience(memory, involvedPeople, newestCreatedAt),
    }))
    .sort((a, b) => b.score - a.score || b.memory.createdAt - a.memory.createdAt)
    .slice(0, maxMemories)
    .map(entry => entry.memory);
}
