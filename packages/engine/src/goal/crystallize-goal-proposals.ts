import type {
  CommittedEvent,
  GoalKind,
  GoalProposal,
  GoalOrigin,
  WorldStatePredicate,
} from "@perfectman/shared";

/**
 * Mine recurrent lacks / failures / high-valence patterns from one agent's
 * own event history into goal proposals (Sims-3 lifetime-wish triggers;
 * Propp's "lack" as the seed). Goals crystallize mid-run — never from a
 * startup objective. The registry only ever holds proposals the agent accepts.
 *
 * Triggers (per agent, per channel):
 *   - repeated blocked intents   -> "resolve" (overcome the obstacle)
 *   - repeated outbound messages -> "affiliation" (deepen the contact)
 *   - membership change          -> "affiliation" (repair the tie)
 *   - witnessed high-salience events -> "legacy" (make the witnessed moment matter)
 */

const FAILED_ATTEMPT_MIN = 2; // blocked intents before a resolve proposal
const GAZE_EVENT_MIN = 3; // repeated outgoing attention before an affiliation proposal
const WITNESS_SALIENCE: ReadonlyArray<string> = ["high", "critical"];
const ORIGIN: GoalOrigin = "crystallized_from";

type TriggerBucket = {
  kind: GoalKind;
  channelId: string;
  eventIds: string[];
  title: string;
  criteria: string[];
  latestAt: number;
};

export function crystallizeGoalProposals(
  agentId: string,
  events: CommittedEvent[],
): GoalProposal[] {
  const buckets: TriggerBucket[] = [];

  for (const event of events) {
    if (event.actorId === agentId) {
      if (event.type === "intent_blocked") {
        upsertBucket(buckets, {
          kind: "resolve",
          channelId: event.channelId,
          eventId: event.id,
          title: `Overcome the repeated block in ${event.channelId}`,
          criteria: [
            `no more blocked intents from ${agentId} in ${event.channelId}`,
            `a successful follow-up in ${event.channelId} after the blocks`,
          ],
          at: event.createdAt,
        });
      } else if (
        event.type === "message_sent" ||
        event.type === "reply_sent"
      ) {
        upsertBucket(buckets, {
          kind: "affiliation",
          channelId: event.channelId,
          eventId: event.id,
          title: `Deepen the connection in ${event.channelId}`,
          criteria: [
            `${agentId} keeps engaging in ${event.channelId} across situations`,
            `the repeated attention in ${event.channelId} is reciprocated`,
          ],
          at: event.createdAt,
        });
      } else if (event.type === "agent_left" || event.type === "agent_invited") {
        upsertBucket(buckets, {
          kind: "affiliation",
          channelId: event.channelId,
          eventId: event.id,
          title: `Repair the tie after the membership change in ${event.channelId}`,
          criteria: [
            `${agentId}'s membership in ${event.channelId} is settled`,
            `outbound contact resumes toward ${event.channelId} after the change`,
          ],
          at: event.createdAt,
        });
      }
    } else if (eventTouchesAgent(event, agentId)) {
      // Relational change where the agent is the target, not the actor
      upsertBucket(buckets, {
        kind: "affiliation",
        channelId: event.channelId,
        eventId: event.id,
        title: `Rebuild the tie after the change in ${event.channelId}`,
        criteria: [
          `${agentId}'s standing in ${event.channelId} is restored`,
          `contact toward the changed relationship resumes`,
        ],
        at: event.createdAt,
      });
    } else if (
      eventWitnessedBy(event, agentId) &&
      WITNESS_SALIENCE.includes(event.emotionalSalience)
    ) {
      upsertBucket(buckets, {
        kind: "legacy",
        channelId: event.channelId,
        eventId: event.id,
        title: `Make the witnessed ${event.type} in ${event.channelId} matter`,
        criteria: [
          `${agentId} acts on what was witnessed in ${event.channelId}`,
          `the witnessed moment gains a return in ${event.channelId}`,
        ],
        at: event.createdAt,
      });
    }
  }

  return buckets
    .filter(b => b.eventIds.length >= triggerMinimum(b.kind))
    .sort((a, b) => b.eventIds.length - a.eventIds.length)
    .map(b => ({
      id: `crystal-${agentId}-${b.kind}-${b.channelId}`,
      agentId,
      title: b.title,
      targetState: buildPredicate(b.kind, b.channelId, b.criteria),
      kind: b.kind,
      origin: ORIGIN,
      sourceEventIds: [...b.eventIds].sort(),
      createdAt: b.latestAt,
    }));
}

/** A proposal only surfaces when its trigger pattern actually recurs. */
function triggerMinimum(kind: GoalKind): number {
  switch (kind) {
    case "resolve":
      return FAILED_ATTEMPT_MIN;
    case "affiliation":
      return GAZE_EVENT_MIN;
    case "legacy":
      return 1;
    default:
      return 1;
  }
}

function buildPredicate(
  kind: GoalKind,
  channelId: string,
  criteria: string[],
): WorldStatePredicate {
  return {
    id: `predicate-${kind}-${channelId}`,
    description: criteria[0]!,
    observableCriteria: criteria,
  };
}

function upsertBucket(
  buckets: TriggerBucket[],
  entry: {
    kind: GoalKind;
    channelId: string;
    eventId: string;
    title: string;
    criteria: string[];
    at: number;
  },
): void {
  const existing = buckets.find(
    b => b.kind === entry.kind && b.channelId === entry.channelId,
  );
  if (existing) {
    existing.eventIds.push(entry.eventId);
    existing.latestAt = Math.max(existing.latestAt, entry.at);
    return;
  }
  buckets.push({
    kind: entry.kind,
    channelId: entry.channelId,
    eventIds: [entry.eventId],
    title: entry.title,
    criteria: entry.criteria,
    latestAt: entry.at,
  });
}

/** payload keys are not part of the event contract — match the id anywhere. */
function eventTouchesAgent(event: CommittedEvent, agentId: string): boolean {
  return payloadContains(event.payload, agentId);
}

function eventWitnessedBy(event: CommittedEvent, agentId: string): boolean {
  return (
    event.visibility.visibleToAgents.includes(agentId) ||
    event.visibility.visibleToAgents.length === 0
  );
}

function payloadContains(value: unknown, agentId: string): boolean {
  if (typeof value === "string") return value === agentId;
  if (Array.isArray(value)) return value.some(v => payloadContains(v, agentId));
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(v => payloadContains(v, agentId));
  }
  return false;
}