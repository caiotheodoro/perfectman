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

  // Own recent utterances — sourced from cleanEvents (full visible history,
  // pre-CONTEXT_WINDOW-truncation), not contextEvents, so it survives the
  // shared window filling up with other agents' turns. Deduped consecutively
  // in case the same content was committed more than once in a row.
  const OWN_UTTERANCE_WINDOW = 5;
  const ownRecentUtterances: string[] = [];
  for (const e of cleanEvents) {
    if (e.actorId !== agent.agentId) continue;
    if (e.type !== "message_sent" && e.type !== "reply_sent") continue;
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
  };
}
