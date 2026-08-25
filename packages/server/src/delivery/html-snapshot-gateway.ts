/**
 * HtmlSnapshotGateway — stream-fed receiver that renders the HTML snapshot
 * artifact (US-004 / FR-003).
 *
 * Everything the generator needs is derived from delivered events plus
 * construction-time metadata: agent states come from `agent_state_snapshot`
 * operator events, thinking from `action_intent`, committed-event rows from
 * `event_visibility`, channel topology from `createChannel`/`addMember`/
 * `removeMember` calls, and names/archetypes from the runtime metadata. The
 * receiver never touches repositories or runtime state; the artifact flushes
 * on `onSimulationStopped` (spec edge case: receivers flush partial output).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  ChannelType,
  CommittedEvent,
  EventPayloadValue,
  OperatorEvent,
  SpectatorEvent,
} from "@perfectman/shared";
import type { GatewayRuntimeMetadata } from "../config/simulation-config.js";
import type { DeliveryMessage, IDeliveryGateway } from "../simulation/scheduler-contracts.js";
import { payloadString, payloadStringArray } from "../simulation/payload-readers.js";
import type { SerializedAgentState } from "../agent/agent-state-serializer.js";
import type { AgentThinking, PulseFrame, SimulationReplay } from "../html/replay-types.js";
import { generateHtml } from "../html/snapshot-html-generator.js";

function serializedState(value: EventPayloadValue | undefined): SerializedAgentState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  // The scheduler emits the output of the shared serializer directly (D-4);
  // EventPayload is loose, so the deep object needs a structural double cast.
  return value as unknown as SerializedAgentState;
}

type ChannelView = {
  type: ChannelType;
  memberAgentIds: Set<string>;
};

export class HtmlSnapshotGateway implements IDeliveryGateway {
  private readonly frames = new Map<number, PulseFrame>();
  private readonly channels = new Map<string, ChannelView>();

  constructor(
    private readonly meta: GatewayRuntimeMetadata,
    private readonly outputPath: string,
  ) {}

  sendAgentMessage(_channelId: string, _message: DeliveryMessage): Promise<void> {
    // Message content and recipients travel in `event_visibility` events;
    // the generator renders committed events, not delivery messages.
    return Promise.resolve();
  }

  createChannel(channelId: string, type: ChannelType, memberAgentIds: string[]): Promise<void> {
    const existing = this.channels.get(channelId);
    if (existing) {
      for (const agentId of memberAgentIds) existing.memberAgentIds.add(agentId);
    } else {
      this.channels.set(channelId, { type, memberAgentIds: new Set(memberAgentIds) });
    }
    return Promise.resolve();
  }

  addMember(channelId: string, agentId: string): Promise<void> {
    this.channels.get(channelId)?.memberAgentIds.add(agentId);
    return Promise.resolve();
  }

  removeMember(channelId: string, agentId: string): Promise<void> {
    this.channels.get(channelId)?.memberAgentIds.delete(agentId);
    return Promise.resolve();
  }

  sendSpectatorEvent(_event: SpectatorEvent): Promise<void> {
    return Promise.resolve();
  }

  sendOperatorEvent(event: OperatorEvent): Promise<void> {
    const frame = this.frameFor(event.pulseIndex);
    frame.operatorEvents.push(event);
    switch (event.type) {
      case "agent_state_snapshot": {
        const state = serializedState(event.data?.["state"]);
        if (state && event.agentId) frame.agentStates[event.agentId] = state;
        break;
      }
      case "action_intent": {
        const thinking = this.thinkingFromEvent(event);
        if (event.agentId) {
          if (!(event.agentId in frame.agentThinking)) frame.result.agentsCalled += 1;
          frame.agentThinking[event.agentId] = thinking;
        }
        break;
      }
      case "event_visibility": {
        frame.committedEvents.push(this.eventRowFromVisibility(event));
        frame.result.eventsCommitted += 1;
        break;
      }
      default:
        break;
    }
    return Promise.resolve();
  }

  /** Flushes the artifact on simulation stop (partial frames included). */
  async onSimulationStopped(_simulationId: string): Promise<void> {
    const html = generateHtml(this.toReplay());
    await mkdir(dirname(this.outputPath), { recursive: true });
    await writeFile(this.outputPath, html, "utf-8");
  }

  /** The replay assembled purely from delivered events + metadata. */
  toReplay(): SimulationReplay {
    const agentNames: Record<string, string> = {};
    const agentArchetypes: Record<string, string> = {};
    for (const [id, agent] of Object.entries(this.meta.agents)) {
      agentNames[id] = agent.name;
      agentArchetypes[id] = agent.archetype;
    }
    return {
      simulationId: this.meta.simulationId,
      simulationName: this.meta.simulationName,
      agentIds: Object.keys(this.meta.agents),
      agentNames,
      agentArchetypes,
      channels: [...this.channels.entries()].map(([id, channel]) => ({
        id,
        name: this.meta.channels[id]?.name ?? id,
        type: channel.type,
        memberAgentIds: [...channel.memberAgentIds],
      })),
      pulses: [...this.frames.values()].sort((a, b) => a.pulseIndex - b.pulseIndex),
    };
  }

  private frameFor(pulseIndex: number): PulseFrame {
    let frame = this.frames.get(pulseIndex);
    if (!frame) {
      frame = {
        pulseIndex,
        // D-9: PulseResult is not delivered; honest stream-derived approximation.
        result: { pulseIndex, eventsCommitted: 0, agentsCalled: 0 },
        committedEvents: [],
        agentStates: {},
        agentThinking: {},
        operatorEvents: [],
      };
      this.frames.set(pulseIndex, frame);
    }
    return frame;
  }

  private thinkingFromEvent(event: OperatorEvent): AgentThinking {
    const data = event.data ?? {};
    const visibleContent = data["visibleContent"];
    return {
      agentId: event.agentId ?? "",
      intentType: payloadString(data, "intentType"),
      visibleContent: typeof visibleContent === "string" ? visibleContent : undefined,
      privateMotiveSummary: payloadString(data, "privateMotiveSummary"),
      emotionDrivers: payloadStringArray(data, "emotionDrivers"),
      motivationDrivers: payloadStringArray(data, "motivationDrivers"),
    };
  }

  private eventRowFromVisibility(event: OperatorEvent): CommittedEvent {
    const data = event.data ?? {};
    const content = payloadString(data, "content");
    const channelName = payloadString(data, "channelName");
    return {
      id: payloadString(data, "eventId"),
      simulationId: event.simulationId,
      channelId: payloadString(data, "channelId"),
      actorId: payloadString(data, "actorId", event.agentId ?? ""),
      type: payloadString(data, "eventType") as CommittedEvent["type"],
      payload: {
        ...(content ? { content } : {}),
        ...(channelName ? { channelName } : {}),
      },
      sourceEventIds: [],
      emotionalSalience: "low",
      visibility: {
        visibleToAgents: payloadStringArray(data, "visibleToAgents"),
        visibleToSpectators: true,
        visibleToOperators: true,
        visibilityReason: "public",
      },
      createdAt: event.createdAt,
      pulseIndex: event.pulseIndex,
    };
  }
}