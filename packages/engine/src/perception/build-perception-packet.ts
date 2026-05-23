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

/**
 * Build the PerceptionPacket for an agent this pulse.
 *
 * Contract:
 *   - No hidden channel content (events from channels agent isn't in)
 *   - No spectator or operator events (type prefix checks)
 *   - No raw numeric scores — only structural data
 *   - Context window is capped at CONTEXT_WINDOW events
 *   - relevantMemories sourced from agentState.memories, filtered by recency/relevance
 */

const CONTEXT_WINDOW = 10;
const SPECTATOR_EVENT_TYPES = new Set(["recap_generated", "reflection_completed"]);
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
): PerceptionPacket {
  // Filter out spectator/operator-only event types
  const cleanEvents = visibleEvents.filter(
    e => !SPECTATOR_EVENT_TYPES.has(e.type) && !OPERATOR_EVENT_TYPES.has(e.type),
  );

  // Context window — most recent events, capped
  const contextEvents = cleanEvents
    .slice(-CONTEXT_WINDOW)
    .filter(e => e.id !== triggeringEvent?.id);

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

  // Relevant memories: most recent N, preference for memories involving involved people
  const MAX_MEMORIES = 8;
  const involvedSet = involvedPeople;
  const sortedMemories = [...agent.memories].sort((a, b) => {
    // Prioritize memories about involved people
    const aRelevant = a.subjectAgentIds.some(id => involvedSet.has(id)) ? 1 : 0;
    const bRelevant = b.subjectAgentIds.some(id => involvedSet.has(id)) ? 1 : 0;
    if (aRelevant !== bRelevant) return bRelevant - aRelevant;
    return b.createdAt - a.createdAt; // newer first
  });
  const relevantMemories = sortedMemories.slice(0, MAX_MEMORIES);

  return {
    agentId:               agent.agentId,
    triggeringEvent:       triggeringEvent,
    visibleContextEvents:  contextEvents,
    involvedPeople:        [...involvedPeople],
    relevantChannels,
    relevantMemories,
    translatedEmotionalState: translatedEmotionalState,
    availableActions,
  };
}
