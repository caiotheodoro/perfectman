/**
 * Shared fixtures for the intent-pipeline test files (action-intent step,
 * intent parser). Q5 of docs/testing-strategy.md: a fixture belongs here once
 * a second test file needs it — server tests otherwise keep per-file makers,
 * so do not grow this speculatively.
 */
import type { CommittedEvent } from "@perfectman/shared";

export function makeEvent(overrides: Partial<CommittedEvent> = {}): CommittedEvent {
  return {
    id: "evt_1",
    simulationId: "sim-1",
    channelId: "general",
    actorId: "agent-peer",
    type: "message_sent",
    payload: { content: "a visible message" },
    createdAt: 1,
    pulseIndex: 1,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public",
    },
    ...overrides,
  };
}

/** A reply_to_message model packet as the provider would emit it. */
export function replyIntentJson(
  replyToEventId: string,
  overrides: { channelTarget?: string; visibleContent?: string } = {},
): string {
  return JSON.stringify({
    intentType: "reply_to_message",
    channelTarget: "general",
    personTargets: ["agent-peer"],
    visibleContent: "yes I did",
    replyToEventId,
    privateMotiveSummary: "engage",
    emotionDrivers: [],
    motivationDrivers: [],
    ...overrides,
  });
}

/** A react model packet as the provider would emit it. */
export function reactIntentJson(
  targetEventId: string,
  overrides: { channelTarget?: string } = {},
): string {
  return JSON.stringify({
    intentType: "react",
    channelTarget: "general",
    emoji: "🔥",
    targetEventId,
    privateMotiveSummary: "signal approval",
    emotionDrivers: [],
    motivationDrivers: [],
    ...overrides,
  });
}
