import type {
  CommittedEvent,
  AgentState,
  WorldSignals,
  ChannelMembership,
} from "@perfectman/shared";

export function buildWorldSignals(
  recentEvents: CommittedEvent[],
  agentStates: Map<string, AgentState>,
  currentAgentId: string,
  channelId: string,
  membership: ChannelMembership[],
): WorldSignals {
  const channelMemberIds = new Set(
    membership
      .filter(m => m.channelId === channelId && !m.leftAt)
      .map(m => m.agentId),
  );

  const channelAgents = [...agentStates.values()].filter(a =>
    channelMemberIds.has(a.agentId),
  );

  const highArousalNearby = channelAgents.some(a => a.coreMood.arousal > 0.7);
  const averageChannelArousal =
    channelAgents.length > 0
      ? channelAgents.reduce((sum, a) => sum + a.coreMood.arousal, 0) / channelAgents.length
      : 0;

  const activeAgentCount = [...agentStates.values()].filter(
    a => a.presence !== "offline",
  ).length;

  const now = Date.now();
  const publicMessageEvents = recentEvents.filter(
    e =>
      (e.type === "message_sent" || e.type === "reply_sent") &&
      e.channelId === channelId,
  );

  const lastMsg = publicMessageEvents.at(-1);
  const timeSinceLastPublicMessage = lastMsg
    ? (now - lastMsg.createdAt) / 1000
    : Number.MAX_SAFE_INTEGER;

  const oneMinuteAgo = now - 60_000;
  const channelMessageRatePerMinute = publicMessageEvents.filter(
    e => e.createdAt >= oneMinuteAgo,
  ).length;

  return {
    highArousalNearby,
    averageChannelArousal,
    activeAgentCount,
    timeSinceLastPublicMessage,
    channelMessageRatePerMinute,
    recentTopicShift: false,
  };
}
