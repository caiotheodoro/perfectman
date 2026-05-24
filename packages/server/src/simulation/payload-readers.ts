import type { ChannelType, EventPayload, EventPayloadValue } from "@perfectman/shared";

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
