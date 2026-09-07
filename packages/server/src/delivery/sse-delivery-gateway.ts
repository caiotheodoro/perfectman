/**
 * A delivery gateway that streams the run to connected browsers.
 *
 * Structured like `StdoutDeliveryGateway`: every method mutates in-memory state
 * and returns an already-resolved promise. Nothing here awaits I/O, because
 * gateway calls are awaited inside the pulse and have no timeout — an SSE
 * gateway that waited on a socket would throttle the simulation itself.
 *
 * It accumulates a frame as operator events arrive and publishes it when the
 * loop seals the pulse. Sealing is the loop's job because `PulseResult` is
 * never delivered to gateways — it is the return value of `runPulse`.
 */
import type {
  ChannelType,
  EndReason,
  EndingOffer,
  LiveChannel,
  LiveMessage,
  LiveNotice,
  LivePulseFrame,
  LiveThinking,
  OperatorEvent,
  SpectatorEvent,
  LiveEmotion,
} from "@perfectman/shared";
import type { PulseResult } from "../simulation/pulse-scheduler.js";
import type { DeliveryMessage, IDeliveryGateway } from "../simulation/scheduler-contracts.js";
import type { GatewayRuntimeMetadata } from "../config/simulation-config.js";
import type { SseHub } from "../http/sse-hub.js";
import {
  emotionFromState,
  isNoticeType,
  messageFromVisibility,
  noticeFrom,
  thinkingFromIntent,
} from "./live-frame-assembly.js";
import type { SerializedAgentState } from "../agent/agent-state-serializer.js";

type PartialFrame = {
  messages: LiveMessage[];
  thinking: Record<string, LiveThinking>;
  emotions: Record<string, LiveEmotion>;
  notices: LiveNotice[];
};

function emptyFrame(): PartialFrame {
  return { messages: [], thinking: {}, emotions: {}, notices: [] };
}

export class SseDeliveryGateway implements IDeliveryGateway {
  private frames = new Map<number, PartialFrame>();
  /**
   * Every channel the viewer has been told about, with the members it was
   * told. The viewer draws a room from its member list, so a membership
   * change is republished; a room whose members did not change is not.
   */
  private readonly channels = new Map<string, { type: ChannelType; members: Set<string> }>();

  constructor(
    private readonly hub: SseHub,
    private readonly meta: GatewayRuntimeMetadata,
  ) {
    // Announced by `hello`; only a change in membership needs republishing.
    for (const id of Object.keys(meta.channels)) this.channels.set(id, { type: "public_channel", members: new Set() });
  }

  /**
   * Called by the run loop once a pulse settles. Publishes whatever the pulse
   * produced, even when that is nothing — an empty frame still advances the
   * scrubber, so the pulse axis stays dense.
   */
  commitPulse(result: PulseResult): LivePulseFrame {
    const partial = this.frames.get(result.pulseIndex) ?? emptyFrame();
    this.frames.delete(result.pulseIndex);

    const frame: LivePulseFrame = {
      pulseIndex: result.pulseIndex,
      eventsCommitted: result.eventsCommitted,
      agentsCalled: result.agentsCalled,
      ...partial,
    };
    // Not coalescable. A replaced frame takes every line in it with it, and
    // a private aside is often one pulse long, so coalescing erased whole
    // private conversations for a client that fell a frame behind. The hub's
    // backlog cap bounds the queue; a slow client works through it.
    this.hub.publish({ type: "pulse", data: { type: "pulse", frame }, id: result.pulseIndex });
    return frame;
  }

  sendAgentMessage(_channelId: string, _message: DeliveryMessage): Promise<void> {
    // Messages reach the viewer through `event_visibility`, which also carries
    // the audience the POV filter needs. Taking them from here as well would
    // double every line.
    return Promise.resolve();
  }

  createChannel(channelId: string, type: ChannelType, memberAgentIds: string[]): Promise<void> {
    const known = this.channels.get(channelId);
    if (!known) {
      this.channels.set(channelId, { type, members: new Set(memberAgentIds) });
      this.publishChannel(channelId);
      return Promise.resolve();
    }
    const before = known.members.size;
    for (const id of memberAgentIds) known.members.add(id);
    if (known.members.size !== before) this.publishChannel(channelId);
    return Promise.resolve();
  }

  addMember(channelId: string, agentId: string): Promise<void> {
    const known = this.channels.get(channelId);
    if (known && !known.members.has(agentId)) {
      known.members.add(agentId);
      this.publishChannel(channelId);
    }
    return Promise.resolve();
  }

  removeMember(channelId: string, agentId: string): Promise<void> {
    const known = this.channels.get(channelId);
    if (known?.members.delete(agentId)) this.publishChannel(channelId);
    return Promise.resolve();
  }

  private publishChannel(channelId: string): void {
    const known = this.channels.get(channelId);
    if (!known) return;
    const channel: LiveChannel = {
      id: channelId,
      name: this.meta.channels[channelId]?.name ?? channelId,
      type: known.type,
      memberAgentIds: [...known.members],
    };
    this.hub.publish({ type: "channel", data: { type: "channel", channel } });
  }

  sendSpectatorEvent(_event: SpectatorEvent): Promise<void> {
    return Promise.resolve();
  }

  sendOperatorEvent(event: OperatorEvent): Promise<void> {
    const frame = this.frameFor(event.pulseIndex);
    switch (event.type) {
      case "agent_state_snapshot": {
        const state = event.data?.["state"] as unknown as SerializedAgentState | undefined;
        if (state && event.agentId) frame.emotions[event.agentId] = emotionFromState(state);
        break;
      }
      case "action_intent": {
        const thinking = thinkingFromIntent(event);
        if (thinking) frame.thinking[thinking.agentId] = thinking;
        break;
      }
      case "event_visibility": {
        const message = messageFromVisibility(event);
        if (message) frame.messages.push(message);
        break;
      }
      default: {
        if (isNoticeType(event.type)) {
          const notice = noticeFrom(event);
          if (notice) frame.notices.push(notice);
        }
      }
    }
    return Promise.resolve();
  }

  onSimulationStopped(
    _simulationId: string,
    _endReason?: EndReason,
    _endingOffer?: EndingOffer,
  ): Promise<void> {
    // The controller publishes `stopped` once artifacts are on disk, so the
    // event carries a replay URL that actually resolves.
    return Promise.resolve();
  }

  private frameFor(pulseIndex: number): PartialFrame {
    const existing = this.frames.get(pulseIndex);
    if (existing) return existing;
    const frame = emptyFrame();
    this.frames.set(pulseIndex, frame);
    return frame;
  }
}
