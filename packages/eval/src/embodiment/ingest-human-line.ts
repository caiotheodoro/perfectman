import { chebyshev, SAY_CLEAR_TILES } from "@perfectman/engine";
import { parseMentionedAgentIds } from "@perfectman/server";
import type { RoomSpeechArbiter, SimulationRuntime } from "@perfectman/server";
import type { CommittedEvent, EventVisibility } from "@perfectman/shared";
import { hearingInRoom, type FakeGridHotel, type GridEvent } from "./fake-grid-hotel.js";

const UNHEARD: EventVisibility = {
  visibleToAgents: [],
  visibleToSpectators: false,
  visibleToOperators: true,
  visibilityReason: "operator_only",
};

export type IngestedHumanLine = {
  event: CommittedEvent;
  addressedIds: string[];
};

/**
 * The adapter half of guest ingestion (ADR-0022), compact enough for tests:
 * names the addressed actors with the resolver's own matcher (else the only
 * actor within social range), computes who hears the line from the grid, and
 * appends it through `runtime.ingest`. The arbiter is told about the line
 * here, as the hotel does. The caller asks for a focused pulse for
 * `addressedIds`.
 */
export async function ingestHumanLine(args: {
  runtime: SimulationRuntime;
  simulationId: string;
  grid: FakeGridHotel;
  event: Extract<GridEvent, { type: "human_chat" }>;
  /** agentId -> display name, for mention matching. */
  names: Record<string, string>;
  arbiter?: RoomSpeechArbiter;
  /** Wall clock for the arbiter; default the grid's. */
  now?: number;
}): Promise<IngestedHumanLine> {
  const { runtime, simulationId, grid, event, names } = args;
  const room = grid.model().rooms.get(event.room);
  if (!room) throw new Error(`unknown room ${event.room}`);
  const heard = hearingInRoom(room, event.ref, event.mode, event.to);

  let addressedIds = parseMentionedAgentIds(event.text, names);
  if (addressedIds.length === 0 && event.mode === "whisper" && event.to) addressedIds = [event.to];
  if (addressedIds.length === 0) {
    const near = [...room.occupants.values()].filter(
      (o) => o.kind === "actor" && chebyshev(o.tile, event.tile) <= 6 && heard.hearing[o.ref] !== undefined,
    );
    const everyoneElse = [...room.occupants.values()].filter((o) => o.ref !== event.ref);
    // "The only other person within social band" (timing rule 1).
    if (near.length === 1 && everyoneElse.every((o) => o.ref === near[0]!.ref || chebyshev(o.tile, event.tile) > SAY_CLEAR_TILES)) {
      addressedIds = [near[0]!.ref];
    }
  }
  addressedIds = addressedIds.filter((id) => heard.hearing[id] !== undefined);

  const audible = heard.visibleToAgents.length > 0;
  const committed = await runtime.ingest({
    simulationId,
    roomChannelId: `room:${event.room}`,
    actorId: event.ref,
    content: event.text,
    senderKind: "guest",
    senderName: event.name,
    mentionedAgentIds: addressedIds,
    addresseeIds: addressedIds,
    hearing: heard.hearing,
    speakerTile: [event.tile[0], event.tile[1]],
    mode: event.mode,
    visibility: audible
      ? { visibleToAgents: heard.visibleToAgents, visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" }
      : UNHEARD,
    salience: addressedIds.length > 0 || event.mode === "shout" ? "high" : "medium",
  });
  if (audible) {
    args.arbiter?.noteHumanLine(event.room, { eventId: committed.id, at: args.now ?? grid.now(), addressedIds });
  }
  return { event: committed, addressedIds };
}
