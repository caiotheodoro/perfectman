import { applySpaceAction, buildBodyPerception, createSpaceModel, projectSpaceView } from "@perfectman/engine";
import type { AgentRuntimeInput, CommittedEvent, Presence } from "@perfectman/shared";
import { makeAgentRuntimeInput } from "./agent-input-test-helpers.js";

const T0 = 1_000_000;

const person = (ref: string, name: string, tile: [number, number]): Presence => ({
  ref,
  name,
  kind: ref.startsWith("h:") ? "human" : "actor",
  tile,
  dir: 2,
  state: "stand",
  since: 0,
  lastMovedAt: 0,
});

/** A small lounge, three people, built the way the hotel builds it. */
export function hotelPerception() {
  const model = createSpaceModel();
  applySpaceAction(model, { type: "agent_room", agentId: "example-friend", room: "lounge" });
  applySpaceAction(model, {
    type: "room_snapshot",
    at: T0,
    rev: 1,
    room: {
      id: "lounge",
      name: "Lounge",
      template: "lounge",
      w: 12,
      h: 8,
      door: [0, 4],
      doorDir: 2,
      heights: new Array<number>(96).fill(0),
      furni: [
        { id: 1, defId: "bar_counter", label: "bar", kinds: ["bar"], tiles: [[2, 1], [3, 1]], front: [[2, 2], [3, 2]], state: 0 },
        { id: 5, defId: "sofa", label: "sofa", kinds: ["sit"], tiles: [[8, 5]], front: [[8, 4]], state: 0 },
      ],
      occupants: [person("example-friend", "Ex", [4, 4]), person("a2", "Duda", [5, 4]), person("h:42", "Visitante", [3, 3])],
      adjacency: [{ roomId: "terrace", viaDoor: [11, 6], travelS: 6, name: "Terraço" }],
    },
  });
  const view = projectSpaceView(model, "example-friend", T0 + 500)!;
  const built = buildBodyPerception({ view, events: [], names: {}, language: "pt-BR" });
  return { view, ...built };
}

export function hotelInput(events: CommittedEvent[] = []): AgentRuntimeInput {
  const base = makeAgentRuntimeInput({ triggeringEvent: events[0] ?? null, visibleContextEvents: events });
  const { body, handles } = hotelPerception();
  return { ...base, perceptionPacket: { ...base.perceptionPacket, body, bodyHandles: handles } };
}

export const humanLine = (content: string, senderName: string): CommittedEvent => ({
  id: "evt-h1",
  simulationId: "sim-1",
  channelId: "room:lounge",
  actorId: "h:42",
  type: "message_sent",
  payload: { content, untrusted: true, senderKind: "guest", senderName },
  createdAt: 1,
  pulseIndex: 1,
  sourceEventIds: [],
  emotionalSalience: "high",
  visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" },
});

