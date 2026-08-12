import type {
  AgentState,
  Channel,
  ChannelMembership,
  SimulationSettings,
  RateLimitStatus,
  AvailableAction,
  IntentType,
} from "@perfectman/shared";

/**
 * Pure computation of available actions for an agent this pulse.
 *
 * Uses:
 *   - agentState: presence mode, membership
 *   - channels: what channels exist
 *   - membership: what channels agent is in
 *   - settings: simulation policy
 *   - rateLimitStatus: from dev2 rate-limit-gate (passed via EngineSnapshot)
 */
export function computeAvailableActions(
  agentState: AgentState,
  channels: Channel[],
  membership: ChannelMembership[],
  settings: SimulationSettings,
  rateLimitStatus: RateLimitStatus,
): AvailableAction[] {
  // Offline agents have no available actions
  if (agentState.presence === "offline") {
    return ALL_INTENT_TYPES.map(intentType => ({
      intentType,
      channelTargets: [],
      personTargets: [],
      blocked: true,
      blockReason: "agent_offline",
    }));
  }

  // Channels agent is currently a member of (not left)
  const memberOf = membership
    .filter(m => m.agentId === agentState.agentId && !m.leftAt)
    .map(m => m.channelId);

  const memberChannels = channels.filter(
    c => memberOf.includes(c.id) && c.status === "active",
  );

  const publicChannels = memberChannels.filter(c => c.type === "public_channel");
  const privateChannels = memberChannels.filter(c => c.type === "private_channel");

  // People in shared channels (potential targets)
  const peopleSets = new Set<string>();
  for (const ch of memberChannels) {
    for (const id of ch.memberAgentIds) {
      if (id !== agentState.agentId) peopleSets.add(id);
    }
  }
  const reachablePeople = [...peopleSets];

  // Global rate limit block
  const globallyBlocked = rateLimitStatus.blocked;

  // Message rate — check messages this minute
  const messageLimited =
    rateLimitStatus.messagesThisMinute >= settings.maxMessagesPerMinutePerAgent;

  // Private channel limit
  const privateChannelLimited =
    rateLimitStatus.privateChannelsCreated >= settings.maxPrivateChannelsPerAgent;

  const actions: AvailableAction[] = [
    // send_message — any channel the agent is in (private included: a
    // private channel exists to be talked in)
    {
      intentType: "send_message",
      channelTargets: memberChannels.map(c => c.id),
      personTargets: [],
      blocked: globallyBlocked || messageLimited || memberChannels.length === 0,
      blockReason: globallyBlocked
        ? rateLimitStatus.blockReason
        : messageLimited
        ? "message_rate_limit"
        : memberChannels.length === 0
        ? "no_channel_available"
        : undefined,
    },

    // reply_to_message — any channel the agent is in with recent messages
    {
      intentType: "reply_to_message",
      channelTargets: memberChannels.map(c => c.id),
      personTargets: reachablePeople,
      blocked: globallyBlocked || messageLimited,
      blockReason: globallyBlocked
        ? rateLimitStatus.blockReason
        : messageLimited
        ? "message_rate_limit"
        : undefined,
    },

    // react — any channel
    {
      intentType: "react",
      channelTargets: memberChannels.map(c => c.id),
      personTargets: reachablePeople,
      blocked: globallyBlocked,
      blockReason: globallyBlocked ? rateLimitStatus.blockReason : undefined,
    },

    // create_channel — allowed if policy permits and not at limit
    {
      intentType: "create_channel",
      channelTargets: [],
      personTargets: reachablePeople,
      blocked:
        !settings.allowPrivateChannels ||
        globallyBlocked ||
        privateChannelLimited,
      blockReason: !settings.allowPrivateChannels
        ? "private_channels_disabled"
        : privateChannelLimited
        ? "private_channel_limit"
        : globallyBlocked
        ? rateLimitStatus.blockReason
        : undefined,
    },

    // invite_agent — can invite to private channels you're in
    {
      intentType: "invite_agent",
      channelTargets: privateChannels.map(c => c.id),
      personTargets: reachablePeople,
      blocked: globallyBlocked || privateChannels.length === 0,
      blockReason: privateChannels.length === 0 ? "no_private_channel" : undefined,
    },

    // leave_channel — any channel except sole public channel
    {
      intentType: "leave_channel",
      channelTargets: memberChannels
        .filter(c => !(c.type === "public_channel" && publicChannels.length === 1))
        .map(c => c.id),
      personTargets: [],
      blocked: globallyBlocked,
      blockReason: globallyBlocked ? rateLimitStatus.blockReason : undefined,
    },

    // typing_start / typing_cancel — any channel the agent is in
    {
      intentType: "typing_start",
      channelTargets: memberChannels.map(c => c.id),
      personTargets: [],
      blocked: globallyBlocked,
      blockReason: globallyBlocked ? rateLimitStatus.blockReason : undefined,
    },
    {
      intentType: "typing_cancel",
      channelTargets: memberChannels.map(c => c.id),
      personTargets: [],
      blocked: false,
    },

    // write_memory — always available (no rate limit)
    {
      intentType: "write_memory",
      channelTargets: [],
      personTargets: [],
      blocked: false,
    },

    // delay_response — always available
    {
      intentType: "delay_response",
      channelTargets: [],
      personTargets: [],
      blocked: false,
    },

    // no_op — always available
    {
      intentType: "no_op",
      channelTargets: [],
      personTargets: [],
      blocked: false,
    },
  ];

  return actions;
}

const ALL_INTENT_TYPES: IntentType[] = [
  "send_message",
  "reply_to_message",
  "react",
  "create_channel",
  "invite_agent",
  "leave_channel",
  "typing_start",
  "typing_cancel",
  "write_memory",
  "delay_response",
  "no_op",
];
