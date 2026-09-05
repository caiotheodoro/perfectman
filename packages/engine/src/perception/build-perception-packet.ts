import type {
  CommittedEvent,
  AgentState,
  Channel,
  Memory,
  TranslatedEmotionalState,
  AvailableAction,
  PerceptionPacket,
  AttentionResult,
} from "@perfectman/shared";
import { selectRelevantMemories } from "./memory-salience.js";
import { OWN_UTTERANCE_WINDOW } from "@perfectman/shared";

/**
 * Build the PerceptionPacket for an agent this pulse.
 *
 * Contract:
 *   - No hidden channel content (events from channels agent isn't in)
 *   - No spectator or operator events (type prefix checks)
 *   - No raw numeric scores — only structural data
 *   - Context window is capped at CONTEXT_WINDOW events
 *   - relevantMemories selected from agentState.memories by salience score
 */

const CONTEXT_WINDOW = 10;
const SPECTATOR_EVENT_TYPES = new Set(["reflection_completed"]);
const OPERATOR_EVENT_TYPES = new Set([
  "operator_warning",
  "llm_failure",
  "stagnation_detected",
  "private_motive_summary",
]);

export function buildPerceptionPacket(
  agent: AgentState,
  visibleEvents: CommittedEvent[],
  triggeringEvent: CommittedEvent | null,
  channels: Channel[],
  attentionResult: AttentionResult,
  translatedEmotionalState: TranslatedEmotionalState,
  availableActions: AvailableAction[],
  ownHistoryWindow: readonly CommittedEvent[] = [],
): PerceptionPacket {
  // Filter out spectator/operator-only event types
  const cleanEvents = visibleEvents.filter(
    e => !SPECTATOR_EVENT_TYPES.has(e.type) && !OPERATOR_EVENT_TYPES.has(e.type),
  );

  // Context window — most recent events, capped
  const contextEvents = cleanEvents
    .slice(-CONTEXT_WINDOW)
    .filter(e => e.id !== triggeringEvent?.id);

  // Short ordinal handles ("e1", "e2", …) for the triggering event and each
  // visible-context event, in the same order the prompt renders them. The
  // model references these instead of raw event ids for replyToEventId /
  // targetEventId; IntentParser resolves them back via this map. One handle
  // per distinct event id.
  const eventHandles: Record<string, string> = {};
  const seenEventIds = new Set<string>();
  for (const e of triggeringEvent ? [triggeringEvent, ...contextEvents] : contextEvents) {
    if (seenEventIds.has(e.id)) continue;
    seenEventIds.add(e.id);
    eventHandles[`e${seenEventIds.size}`] = e.id;
  }

  // Channels visible to this agent
  const relevantChannels = channels
    .filter(c => c.memberAgentIds.includes(agent.agentId))
    .map(c => c.id);

  // Involved people: actor of triggering event + its personTargets + mentions
  const involvedPeople = new Set<string>();
  if (triggeringEvent) {
    if (triggeringEvent.actorId !== agent.agentId) {
      involvedPeople.add(triggeringEvent.actorId);
    }
    const mentions = triggeringEvent.payload["mentionedAgentIds"] as string[] | undefined;
    if (mentions) {
      for (const id of mentions) {
        if (id !== agent.agentId) involvedPeople.add(id);
      }
    }
    const replyTarget = triggeringEvent.payload["replyToActorId"] as string | undefined;
    if (replyTarget && replyTarget !== agent.agentId) involvedPeople.add(replyTarget);
  }

  // Own recent utterances — the union of the scheduler's own-history window
  // (whole log, per agent) and whatever own messages are still inside the
  // shared visible window, deduped by event id, chronological, consecutive
  // duplicates collapsed, last OWN_UTTERANCE_WINDOW. Before this the source
  // was the shared window alone: ~8-12 pulses of memory in a 4-agent room,
  // which is how a pulse-18 re-announcement sailed past the guard.
  const ownById = new Map<string, CommittedEvent>();
  for (const e of [...ownHistoryWindow, ...cleanEvents]) {
    if (e.actorId !== agent.agentId) continue;
    if (e.type !== "message_sent" && e.type !== "reply_sent") continue;
    if (!ownById.has(e.id)) ownById.set(e.id, e);
  }
  const ownEvents = [...ownById.values()].sort(
    (a, b) => (a.pulseIndex ?? 0) - (b.pulseIndex ?? 0) || a.createdAt - b.createdAt,
  );
  const ownRecentUtterances: string[] = [];
  for (const e of ownEvents) {
    const content = (e.payload as Record<string, unknown>)["content"];
    if (typeof content !== "string" || content.length === 0) continue;
    if (ownRecentUtterances[ownRecentUtterances.length - 1] === content) continue;
    ownRecentUtterances.push(content);
  }
  const recentOwnUtterances = ownRecentUtterances.slice(-OWN_UTTERANCE_WINDOW);

  // Relevant memories: salience-scored selection (subject relevance, memory
  // type, authored confidence, open loops, bounded recency decay) — see
  // memory-salience.ts. Recency as a sort key evicted important older
  // memories once the store grew; it is now a bounded term.
  const MAX_MEMORIES = 8;
  const relevantMemories = selectRelevantMemories(
    agent.memories,
    involvedPeople,
    agent.agentId,
    MAX_MEMORIES,
  );

  return {
    agentId:               agent.agentId,
    triggeringEvent:       triggeringEvent,
    visibleContextEvents:  contextEvents,
    ownRecentUtterances:   recentOwnUtterances,
    involvedPeople:        [...involvedPeople],
    relevantChannels,
    relevantMemories,
    translatedEmotionalState: translatedEmotionalState,
    availableActions,
    eventHandles,
  };
}
