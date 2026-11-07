import type {
  AgentBody,
  FurniModel,
  Presence,
  RoomAdjacency,
  RoomId,
  RoomModel,
  SpaceModel,
} from "./space.types.js";

/** One room as one agent sees it: plain arrays instead of maps, plus the computed stale flag. */
export type RoomView = Omit<RoomModel, "furni" | "occupants"> & {
  furni: FurniModel[];
  occupants: Presence[];
  /** `now - syncedAtWall > STALE_MS` at the read. A stale room yields no body commands. */
  stale: boolean;
};

/**
 * Per-agent pure projection of a `SpaceModel`, built once per pulse at its
 * boundary and carried on `EngineSnapshot.space?`. When absent every engine
 * path behaves as before (ADR-0018 decision 2).
 */
export type SpaceView = {
  agentId: string;
  /** Wall-clock ms of the read. */
  readAt: number;
  where: RoomId | "in_transit";
  /** The room the agent is in. Absent while in transit. */
  room?: RoomView;
  self?: Presence;
  /** Rooms reachable from here, by travel time. */
  adjacency: RoomAdjacency[];
  body: AgentBody;
};

/**
 * What the engine needs from the sidecar's space driver. The frame-to-reducer
 * logic stays in `packages/hotel`; this is the seam
 * `engineSnapshotProjection` reads. Named here (lead resolution R1) so the
 * server never imports the hotel package.
 */
export interface SpaceMirror {
  /** The current model. Treat as read-only. */
  model(): SpaceModel;
  /** Projection for one agent at wall-clock `now`, or undefined if the agent is unknown to the mirror. */
  view(agentId: string, now: number): SpaceView | undefined;
}
