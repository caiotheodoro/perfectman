import type {
  ChannelType,
  EventPayload,
  EventPayloadValue,
  EventVisibilityData,
} from "@perfectman/shared";

export function payloadString(payload: EventPayload, key: string, fallback = ""): string {
  const value = payload[key];
  return typeof value === "string" ? value : fallback;
}

export function payloadStringArray(payload: EventPayload, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function payloadChannelType(payload: EventPayload, key: string, fallback: ChannelType): ChannelType {
  const value = payload[key];
  return isChannelType(value) ? value : fallback;
}

function isChannelType(value: EventPayloadValue | undefined): value is ChannelType {
  return (
    value === "public_channel" ||
    value === "private_channel" ||
    value === "spectator_channel" ||
    value === "operator_channel"
  );
}

export type PayloadDisplayFields = Pick<
  EventVisibilityData,
  "content" | "channelName" | "emoji" | "targetEventId"
>;

/**
 * The display fields that ride an `event_visibility` payload. Both directions
 * of the event_visibility round-trip spread this set: the scheduler builds the
 * operator event from a CommittedEvent, and receivers rebuild the
 * CommittedEvent payload from the operator event. Keys without a value are
 * omitted rather than empty-stringed so absence survives the round-trip.
 */
export function payloadDisplayFields(payload: EventPayload): PayloadDisplayFields {
  const content = payloadString(payload, "content");
  const channelName = payloadString(payload, "channelName");
  const emoji = payloadString(payload, "emoji");
  const targetEventId = payloadString(payload, "targetEventId");
  return {
    ...(content ? { content } : {}),
    ...(channelName ? { channelName } : {}),
    ...(emoji ? { emoji } : {}),
    ...(targetEventId ? { targetEventId } : {}),
  };
}
