/**
 * Adapter: perfectman CommittedEvent → BehavioralEvent stream.
 *
 * `private_motive_summary` events (ADR-0014) never enter the stream as
 * events of their own — they would skew every rate whose denominator is
 * "all events" — but their motive is folded onto the act they explain, so
 * probes see the character's private text with an `engineAuthored` verdict.
 */

import type { CommittedEvent } from "@perfectman/shared";
import type { BehavioralEvent, BehavioralEventKind } from "./types.js";
import { buildMotiveIndex, motiveForEvent, type MotiveIndex } from "../transcript/render-transcript.js";

export function eventToBehavioral(event: CommittedEvent, motives: MotiveIndex = new Map()): BehavioralEvent {
  const payload = event.payload as Record<string, unknown>;
  const kind = kindFor(event.type);
  const content =
    typeof payload.content === "string"
      ? payload.content
      : typeof payload.reaction === "string"
        ? payload.reaction
        : undefined;
  const motive = motiveForEvent(event, motives);
  const legacyMotive = typeof payload.motiveSummary === "string" ? payload.motiveSummary : undefined;

  return {
    kind,
    agentId: event.actorId,
    channelId: event.channelId,
    pulseIndex: event.pulseIndex ?? 0,
    content,
    privateContent: motive?.text ?? legacyMotive,
    ...(motive ? { engineAuthored: motive.engineAuthored } : {}),
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
    case "repetition_blocked":
      return "blocked_repeat";
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
  const motives = buildMotiveIndex(events);
  return [...events]
    .filter(e => e.type !== "private_motive_summary")
    .sort((a, b) => (a.pulseIndex ?? 0) - (b.pulseIndex ?? 0))
    .map(e => eventToBehavioral(e, motives));
}
