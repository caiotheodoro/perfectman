import type { SpaceModel, SpaceView, RoomView } from "@perfectman/shared";
import { STALE_MS } from "./constants.js";
import { defaultAgentBody } from "./space-reducer.js";

/**
 * Per-agent projection of the model at wall-clock `now` (the pulse boundary).
 * Undefined when the model has never heard of the agent. A room that has not
 * produced a frame for STALE_MS is `stale`; walkers are not dead-reckoned here
 * (the mirror owns that: it knows the route).
 */
export function projectSpaceView(model: SpaceModel, agentId: string, now: number): SpaceView | undefined {
  const where = model.agentRoom.get(agentId);
  if (where === undefined) return undefined;
  const body = model.body.get(agentId) ?? defaultAgentBody();
  if (where === "in_transit") {
    return { agentId, readAt: now, where, adjacency: [], body };
  }
  const room = model.rooms.get(where);
  if (!room) return { agentId, readAt: now, where: "in_transit", adjacency: [], body };
  const view: RoomView = {
    ...room,
    furni: [...room.furni.values()],
    occupants: [...room.occupants.values()],
    stale: now - room.syncedAtWall > STALE_MS,
  };
  const self = room.occupants.get(agentId);
  return {
    agentId,
    readAt: now,
    where,
    room: view,
    ...(self ? { self } : {}),
    adjacency: room.adjacency,
    body,
  };
}
