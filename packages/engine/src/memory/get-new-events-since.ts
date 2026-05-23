import type { CommittedEvent } from "@perfectman/shared";

/**
 * Anti-drift cursor: returns only events that come AFTER lastProcessedEventId.
 *
 * Events are assumed sorted by createdAt ascending (event log order).
 * If lastProcessedEventId is null, all events are returned (cold start).
 * The event with id === lastProcessedEventId is NOT included — only strictly after.
 *
 * This guarantees old events never retrigger emotion cycles, and the cursor
 * moves forward only.
 */
export function getNewEventsSince(
  events: CommittedEvent[],
  lastProcessedEventId: string | null,
): CommittedEvent[] {
  if (!lastProcessedEventId) {
    return events;
  }

  const idx = events.findIndex(e => e.id === lastProcessedEventId);
  if (idx === -1) {
    // lastProcessedEventId not found in window — return nothing to avoid
    // double-processing an unknown boundary. Caller should handle cold-start
    // re-seeding if needed.
    return [];
  }

  return events.slice(idx + 1);
}

/**
 * Returns the id of the last event in the array, or null if empty.
 * Used to advance the cursor after processing.
 */
export function getLastEventId(events: CommittedEvent[]): string | null {
  if (events.length === 0) return null;
  return events[events.length - 1]!.id;
}
