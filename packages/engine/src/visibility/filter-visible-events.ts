import type {
  CommittedEvent,
  Channel,
  ChannelMembership,
  SimulationSettings,
} from "@perfectman/shared";

const AGENT_BLOCKED_TYPES = new Set<string>([
  "operator_warning", "llm_failure", "stagnation_detected", "private_motive_summary",
]);

/**
 * Filter committed events visible to a specific agent.
 *
 * Rules:
 *   1. Agent must be in the event's channel (via membership).
 *   2. If visibility.visibleToAgents is non-empty, agent must be in that list.
 *   3. Operator-only events (operatorVisible=true, spectatorVisible=false,
 *      visibleToAgents=[]) are never shown to agents.
 */
export function filterVisibleEventsForAgent(
  events: CommittedEvent[],
  agentId: string,
  channels: Channel[],
  membership: ChannelMembership[],
): CommittedEvent[] {
  const memberChannelIds = new Set(
    membership
      .filter(m => m.agentId === agentId && !m.leftAt)
      .map(m => m.channelId),
  );

  return events.filter(event => {
    // Exclude operator-internal event types
    if (AGENT_BLOCKED_TYPES.has(event.type)) return false;

    // Must be in the channel
    if (!memberChannelIds.has(event.channelId)) return false;

    const vis = event.visibility;

    // Operator-only events (no agent audience, not spectator-facing, marked
    // operator_only) are never shown to agents — no-op records, memory
    // writes, motives. Private-channel events use the same visibility shape
    // but a different reason and ARE shown to channel members.
    if (
      vis.visibleToAgents.length === 0 &&
      !vis.visibleToSpectators &&
      vis.visibilityReason === "operator_only"
    ) {
      return false;
    }

    // If visibleToAgents is populated, agent must be in list
    if (vis.visibleToAgents.length > 0) {
      return vis.visibleToAgents.includes(agentId);
    }

    return true;
  });
}

/**
 * Hotel hearing (embodiment.md 5.2): `payload.hearing[agentId]` is the level
 * this listener hears a spoken line at. `garbled` and `notice` lose their
 * `content` and gain `payload.heardAs` for the renderer; a garbled line still
 * reads in full for a listener it names. Anything else (no `hearing`, `clear`)
 * is returned as the same object, so non-hotel events pass through untouched.
 */
export function redactForListener(event: CommittedEvent, agentId: string): CommittedEvent {
  const hearing = event.payload["hearing"];
  if (typeof hearing !== "object" || hearing === null || Array.isArray(hearing)) return event;
  const level = (hearing as Record<string, unknown>)[agentId];
  if (level !== "garbled" && level !== "notice") return event;
  if (level === "garbled") {
    const named = (key: string): boolean => {
      const v = event.payload[key];
      return Array.isArray(v) && v.includes(agentId);
    };
    if (named("mentionedAgentIds") || named("addresseeIds")) return event;
  }
  const { content: _content, ...rest } = event.payload;
  return { ...event, payload: { ...rest, heardAs: level } };
}

/**
 * Filter committed events visible to spectators.
 *
 * Rules:
 *   1. event.visibility.visibleToSpectators must be true.
 *   2. If not omniscientSpectatorMode, private channel events excluded
 *      unless the channel is explicitly spectator-visible.
 */
export function filterVisibleEventsForSpectator(
  events: CommittedEvent[],
  channels: Channel[],
  settings: SimulationSettings,
): CommittedEvent[] {
  const channelMap = new Map(channels.map(c => [c.id, c]));

  return events.filter(event => {
    if (!event.visibility.visibleToSpectators) return false;

    const channel = channelMap.get(event.channelId);
    if (!channel) return false;

    if (!settings.omniscientSpectatorMode && !channel.spectatorVisible) {
      return false;
    }

    return true;
  });
}

/**
 * Filter committed events visible to operators.
 * Operators always see all events (visibleToOperators is always true by
 * contract), so this is effectively an identity filter — included for
 * symmetry and future policy hooks.
 */
export function filterVisibleEventsForOperator(
  events: CommittedEvent[],
): CommittedEvent[] {
  return events.filter(event => event.visibility.visibleToOperators);
}
