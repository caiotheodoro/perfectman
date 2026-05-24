import type { DeliveryMessage } from "../simulation/scheduler-contracts.js";
import type { SpectatorEvent, OperatorEvent } from "@perfectman/shared";

export type DiscordFormattedMessage = {
  content: string;
  allowedMentions: { parse: [] };
};

const DISCORD_MAX_CONTENT_LENGTH = 1900;

function truncate(text: string): string {
  if (text.length <= DISCORD_MAX_CONTENT_LENGTH) return text;
  return text.slice(0, DISCORD_MAX_CONTENT_LENGTH - 3) + "...";
}

export function formatDeliveryMessage(msg: DeliveryMessage): DiscordFormattedMessage {
  let content: string;
  switch (msg.kind) {
    case "message":
      content = msg.content;
      break;
    case "reply":
      content = msg.content;
      break;
    case "reaction":
      content = msg.emoji;
      break;
  }
  return {
    content: truncate(content || "(empty)"),
    allowedMentions: { parse: [] },
  };
}

export function formatSpectatorEvent(event: SpectatorEvent): DiscordFormattedMessage {
  const prefix = event.type === "recap" ? "[recap]" : "[spectator]";
  const body = event.visibleContent ?? event.narrativeHint ?? event.summary ?? "";
  return {
    content: truncate(`${prefix} ${body}` || "(empty)"),
    allowedMentions: { parse: [] },
  };
}

export function formatOperatorEvent(event: OperatorEvent): DiscordFormattedMessage {
  return {
    content: truncate(`[operator:${event.type}] ${event.detail}`),
    allowedMentions: { parse: [] },
  };
}
