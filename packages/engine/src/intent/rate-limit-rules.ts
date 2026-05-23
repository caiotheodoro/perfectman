import type {
  RateLimitStatus,
  SimulationSettings,
  IntentType,
} from "@perfectman/shared";

export type RateLimitCheckResult = {
  allowed: boolean;
  reason?: string;
};

const MESSAGE_INTENT_TYPES = new Set<IntentType>([
  "send_message",
  "reply_to_message",
  "react",
]);

const PRIVATE_CHANNEL_INTENT_TYPES = new Set<IntentType>([
  "create_channel",
]);

/**
 * Pure rate limit check given RateLimitStatus (provided by dev2 gate).
 * Called inside computeAvailableActions and validateIntentPure.
 */
export function checkRateLimitPure(
  intentType: IntentType,
  rateLimitStatus: RateLimitStatus,
  settings: SimulationSettings,
): RateLimitCheckResult {
  // Hard block first
  if (rateLimitStatus.blocked) {
    return { allowed: false, reason: rateLimitStatus.blockReason ?? "agent_globally_blocked" };
  }

  // Message rate limit
  if (MESSAGE_INTENT_TYPES.has(intentType)) {
    if (rateLimitStatus.messagesThisMinute >= settings.maxMessagesPerMinutePerAgent) {
      return {
        allowed: false,
        reason:  `message_rate_limit: ${rateLimitStatus.messagesThisMinute}/${settings.maxMessagesPerMinutePerAgent} messages this minute`,
      };
    }
  }

  // Private channel limit
  if (PRIVATE_CHANNEL_INTENT_TYPES.has(intentType)) {
    if (!settings.allowPrivateChannels) {
      return { allowed: false, reason: "private_channels_disabled" };
    }
    if (rateLimitStatus.privateChannelsCreated >= settings.maxPrivateChannelsPerAgent) {
      return {
        allowed: false,
        reason:  `private_channel_limit: ${rateLimitStatus.privateChannelsCreated}/${settings.maxPrivateChannelsPerAgent} channels`,
      };
    }
  }

  return { allowed: true };
}
