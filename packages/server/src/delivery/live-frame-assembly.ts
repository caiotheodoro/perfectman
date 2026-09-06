/**
 * Operator events → the curated per-pulse frame the viewer reads.
 *
 * Pure functions, separated from the gateway so the mapping can be tested
 * without a socket or a simulation.
 *
 * The three event types that matter are the ones with no table behind them:
 * `agent_state_snapshot` (per-pulse emotion), `action_intent` (thinking), and
 * `event_visibility` (committed events with their audience). They exist only as
 * gateway calls, which is why the live view and the stored replay both have to
 * be built from the stream rather than read back from the database.
 *
 * Reading mirrors `HtmlSnapshotGateway`, which is the parity-tested consumer of
 * the same stream.
 */
import type { CommittedEvent, EventPayload, OperatorEvent } from "@perfectman/shared";
import type { LiveEmotion, LiveMessage, LiveNotice, LiveThinking } from "@perfectman/shared";
import type { SerializedAgentState } from "../agent/agent-state-serializer.js";
import { payloadDisplayFields, payloadString, payloadStringArray } from "../simulation/payload-readers.js";

/** Social emotions below this are noise, not signal. */
const EMOTION_FLOOR = 0.15;
const TOP_EMOTIONS = 3;

/** Operator event types surfaced to the viewer as notices. */
const NOTICE_TYPES = new Set<string>([
  "llm_failure",
  "intent_blocked",
  "intent_delayed",
  "stagnation_detected",
  "stagnation_warning",
  "attractor_detected",
  "scheduler_error",
]);

export function isNoticeType(type: string): boolean {
  return NOTICE_TYPES.has(type);
}

export function emotionFromState(state: SerializedAgentState): LiveEmotion {
  const social = (state.socialEmotions ?? {}) as unknown as Record<string, number>;
  const top = Object.entries(social)
    .filter(([, value]) => typeof value === "number" && value >= EMOTION_FLOOR)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_EMOTIONS)
    .map(([key, value]) => ({ key, value }));

  return {
    valence: state.coreMood?.valence ?? 0,
    arousal: state.coreMood?.arousal ?? 0,
    top,
  };
}

export function thinkingFromIntent(event: OperatorEvent): LiveThinking | null {
  if (!event.agentId) return null;
  const data = event.data ?? {};
  const visibleContent = data["content"];
  return {
    agentId: event.agentId,
    intentType: payloadString(data, "intentType", "unknown"),
    ...(typeof visibleContent === "string" && visibleContent.length > 0
      ? { visibleContent }
      : {}),
    privateMotiveSummary: payloadString(data, "privateMotiveSummary"),
    emotionDrivers: payloadStringArray(data, "emotionDrivers"),
    motivationDrivers: payloadStringArray(data, "motivationDrivers"),
  };
}

/**
 * `event_visibility` carries a committed event plus who could see it. The
 * audience is the whole point — it is what makes a per-agent point of view, and
 * therefore inferred exclusion, visible in the UI.
 */
export function messageFromVisibility(event: OperatorEvent): LiveMessage | null {
  const data = event.data ?? {};
  const eventId = payloadString(data, "eventId");
  const eventType = payloadString(data, "eventType");
  const channelId = payloadString(data, "channelId");
  const actorId = payloadString(data, "actorId", event.agentId ?? "");
  if (!eventId || !eventType || !channelId || !actorId) return null;

  return {
    eventId,
    channelId,
    actorId,
    eventType,
    text: displayText(payloadDisplayFields(data)),
    visibleToAgents: payloadStringArray(data, "visibleToAgents"),
    pulseIndex: event.pulseIndex,
    createdAt: event.createdAt,
  };
}

/** The same mapping for an event read back from the log rather than the stream. */
export function messageFromCommitted(event: CommittedEvent): LiveMessage {
  return {
    eventId: event.id,
    channelId: event.channelId,
    actorId: event.actorId,
    eventType: event.type,
    text: displayText(event.payload),
    visibleToAgents: event.visibility?.visibleToAgents ?? [],
    pulseIndex: event.pulseIndex,
    createdAt: event.createdAt,
  };
}

export function noticeFrom(event: OperatorEvent): LiveNotice | null {
  if (!NOTICE_TYPES.has(event.type)) return null;
  const data = event.data ?? {};
  return {
    type: event.type,
    ...(event.agentId ? { agentId: event.agentId } : {}),
    detail: event.detail || payloadString(data, "reason") || payloadString(data, "message"),
  };
}

/** Whatever the event actually shows a reader: message text, or an emoji. */
function displayText(payload: EventPayload): string {
  const content = payloadString(payload, "content");
  if (content) return content;
  const emoji = payloadString(payload, "emoji");
  if (emoji) return emoji;
  return payloadString(payload, "channelName");
}
