/**
 * Adapter: perfectman CommittedEvent → BehavioralEvent stream.
 */

import type { CommittedEvent } from "@perfectman/shared";
import type { BehavioralEvent, BehavioralEventKind } from "./types.js";

export function eventToBehavioral(event: CommittedEvent): BehavioralEvent {
  const payload = event.payload as Record<string, unknown>;
  const kind = kindFor(event.type);
  const content =
    typeof payload.content === "string"
      ? payload.content
      : typeof payload.reaction === "string"
        ? payload.reaction
        : undefined;
  const privateContent =
    typeof payload.privateMotiveSummary === "string"
      ? payload.privateMotiveSummary
      : typeof payload.motiveSummary === "string"
        ? payload.motiveSummary
        : undefined;

  return {
    kind,
    agentId: event.actorId,
    channelId: event.channelId,
    pulseIndex: event.pulseIndex ?? 0,
    content,
    privateContent,
    payload,
  };
}

function kindFor(type: CommittedEvent["type"]): BehavioralEventKind {
  switch (type) {
    case "message_sent":
      return "post";
    case "reply_sent":
      return "reply";
    case "reaction_sent":
      return "react";
    case "no_op_recorded":
      return "silence";
    case "channel_created":
      return "private_channel";
    case "memory_written":
      return "memory";
    case "agent_invited":
      return "join";
    case "agent_left":
      return "leave";
    case "typing_started":
    case "typing_cancelled":
      return "typing";
    default:
      return "other";
  }
}

export function eventsToBehavioral(events: readonly CommittedEvent[]): BehavioralEvent[] {
  return [...events]
    .sort((a, b) => (a.pulseIndex ?? 0) - (b.pulseIndex ?? 0))
    .map(eventToBehavioral);
}
