import type {
  CommittedEvent,
  SimulationSettings,
  SpectatorEvent,
  Channel,
} from "@perfectman/shared";
import { filterVisibleEventsForSpectator } from "@perfectman/engine";
import type { IDeliveryGateway } from "../scheduler-contracts.js";
import { payloadString } from "../payload-readers.js";

function sanitize(event: CommittedEvent): Omit<SpectatorEvent, "narrativeHint"> {
  return {
    type: event.type,
    simulationId: event.simulationId,
    actorId: event.actorId,
    channelId: event.channelId,
    visibleContent: payloadString(event.payload, "content"),
    createdAt: event.createdAt,
    pulseIndex: event.pulseIndex,
  };
}

function sanitizeMotiveSummary(summary: string): string {
  // Truncate private details — keep to a safe length
  return summary.slice(0, 80);
}

function summarizeDelay(event: CommittedEvent): string {
  const intentType = payloadString(event.payload, "intentType", "action");
  return `Agent delayed a ${intentType}`;
}

function summarizeBlockedIntent(event: CommittedEvent): string {
  const intentType = payloadString(event.payload, "intentType", "action");
  return `Agent blocked from ${intentType}`;
}

export class SpectatorProjection {
  constructor(private readonly gateway: IDeliveryGateway) {}

  async project(
    event: CommittedEvent,
    channels: Channel[],
    settings: SimulationSettings,
  ): Promise<void> {
    const spectatorEvent = this.buildSpectatorEvent(event, settings);
    if (spectatorEvent) {
      // Visibility filter using engine's pure function
      const filtered = filterVisibleEventsForSpectator([event], channels, settings);
      if (filtered.length === 0 && !this.isAlwaysSpectatorVisible(event.type)) return;
      await this.gateway.sendSpectatorEvent(spectatorEvent);
    }
  }

  private isAlwaysSpectatorVisible(type: CommittedEvent["type"]): boolean {
    return (
      type === "no_op_recorded" ||
      type === "intent_delayed" ||
      type === "intent_blocked" ||
      type === "private_motive_summary"
    );
  }

  buildSpectatorEvent(event: CommittedEvent, settings: SimulationSettings): SpectatorEvent | null {
    switch (event.type) {
      case "message_sent":
      case "reply_sent":
      case "reaction_sent":
        return { ...sanitize(event), narrativeHint: null };
      case "no_op_recorded":
        return {
          type: "spectator_hint",
          simulationId: event.simulationId,
          actorId: event.actorId,
          channelId: event.channelId,
          visibleContent: sanitizeMotiveSummary(payloadString(event.payload, "privateMotiveSummary", "[internal]")),
          narrativeHint: null,
          createdAt: event.createdAt,
          pulseIndex: event.pulseIndex,
        };
      case "intent_delayed":
        return {
          type: "spectator_hint",
          simulationId: event.simulationId,
          actorId: event.actorId,
          channelId: event.channelId,
          visibleContent: summarizeDelay(event),
          narrativeHint: null,
          createdAt: event.createdAt,
          pulseIndex: event.pulseIndex,
        };
      case "intent_blocked":
        return {
          type: "spectator_hint",
          simulationId: event.simulationId,
          actorId: event.actorId,
          channelId: event.channelId,
          visibleContent: summarizeBlockedIntent(event),
          narrativeHint: null,
          createdAt: event.createdAt,
          pulseIndex: event.pulseIndex,
        };
      case "channel_created":
        return { ...sanitize(event), narrativeHint: "New private space created" };
      case "private_motive_summary":
        return {
          type: "motive_reveal",
          simulationId: event.simulationId,
          actorId: event.actorId,
          summary: payloadString(event.payload, "summary"),
          createdAt: event.createdAt,
          pulseIndex: event.pulseIndex,
        };
      default:
        return settings.omniscientSpectatorMode
          ? { ...sanitize(event), narrativeHint: null }
          : null;
    }
  }
}
