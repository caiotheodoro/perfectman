import type {
  CommittedEvent,
  Channel,
  ChannelMembership,
  SimulationSettings,
} from "@perfectman/shared";

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
    // Must be in the channel
    if (!memberChannelIds.has(event.channelId)) return false;

    const vis = event.visibility;

    // If visibleToAgents is populated, agent must be in list
    if (vis.visibleToAgents.length > 0) {
      return vis.visibleToAgents.includes(agentId);
    }

    return true;
  });
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
