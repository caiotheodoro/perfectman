/**
 * Physical-space model (ADR-0018, docs/embodiment.md section 3).
 *
 * Plain data only. The reducer, `deriveZones`, the validator and the
 * perception builder live in `packages/engine`; the sidecar driver
 * (`SpaceMirror`, turning Director frames into reducer actions) lives in
 * `packages/hotel`. Named `space`, not `world`, so it never collides with the
 * goal-layer "world" (lead resolution R1).
 */

export type RoomId = string;

/** agentId for actors, `h:<userId>` for humans. The `h:` form never reaches a prompt (ADR-0023). */
export type ActorRef = string;

export type Tile = readonly [x: number, y: number];

/** 0 is toward -y, increasing clockwise (same convention as Tilehouse `direction()`). */
export type Direction8 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type AvatarState = "stand" | "walk" | "sit" | "lay" | "dance";

export type Affordance =
  | "sit"
  | "lay"
  | "table"
  | "bar"
  | "screen"
  | "window"
  | "bed"
  | "plant"
  | "rug"
  | "door"
  | "decor"
  | "game";

export type FurniModel = {
  id: number;
  defId: string;
  /** Semantic keyword when one matches, else the sanitized display name (ADR-0023). */
  label: string;
  kinds: Affordance[];
  tiles: Tile[];
  /** Tiles an avatar stands on to use it. */
  front: Tile[];
  state: number;
};

export type ZoneKind =
  | "bar"
  | "seating"
  | "window"
  | "bed"
  | "feature"
  | "decor"
  | "door"
  | "corner"
  | "middle"
  | "dance_floor"
  | "authored";

/** A semantic zone derived from the room layout and furniture (not Tilehouse's paint-only `Zone`). */
export type Zone = {
  id: string;
  kind: ZoneKind;
  /** Sanitized, quoted by the renderer. */
  label: string;
  center: Tile;
  radius: number;
  furniIds: number[];
  tags: string[];
  source: "keyword" | "cluster" | "wall" | "geometry" | "authored";
};

export type ActiveGesture = { a: string; style?: number; until: number };

export type Presence = {
  ref: ActorRef;
  name: string;
  /** Engine-internal ordering and probes only. Never rendered (docs/embodiment.md 5.1, D43). */
  kind: "actor" | "human";
  tile: Tile;
  dir: Direction8;
  state: AvatarState;
  seatId?: number;
  action?: ActiveGesture;
  walkGoal?: Tile;
  typing?: boolean;
  since: number;
  lastSpokeAt?: number;
  lastMovedAt: number;
};

export type RoomAdjacency = { roomId: RoomId; viaDoor: Tile; travelS: number };

export type RoomModel = {
  id: RoomId;
  name: string;
  template: string;
  w: number;
  h: number;
  /** Per-room revision of the last applied Director delta (lead resolution R5): there is no global rev. */
  rev: number;
  /** Wall-clock ms of the last frame (delta, snapshot or `room_ping`) for this room. */
  syncedAtWall: number;
  door: Tile;
  doorDir: Direction8;
  /** 255 = void. */
  heights: Uint8Array;
  furni: Map<number, FurniModel>;
  zones: Zone[];
  occupants: Map<ActorRef, Presence>;
  adjacency: RoomAdjacency[];
  /** A rev gap was seen and the resnapshot has not landed yet. */
  degraded: boolean;
};

export type SpaceModel = {
  rooms: Map<RoomId, RoomModel>;
  agentRoom: Map<string, RoomId | "in_transit">;
  body: Map<string, AgentBody>;
};

/** Per-agent body state, owned by the hotel executor. The engine sees only its events. */
export type AgentBody = {
  plan?: BodyPlan;
  pendingSpeech?: PendingSpeech;
  lastBlocked?: BlockedReason[];
  dwell: { postureSince: number; placeSince: number; lastGestureAt: Record<string, number> };
  budget: { cmdTimes: number[] };
};

export type BodyPlanKind = "go_to" | "approach" | "follow" | "keep_distance" | "leave" | "posture" | "pair";
export type BodyPlanStatus = "moving" | "arrived" | "blocked" | "interrupted";

export type BodyPlan = {
  id: string;
  kind: BodyPlanKind;
  goal: string;
  startedAt: number;
  /** Route tiles x 300 ms. */
  etaMs: number;
  status: BodyPlanStatus;
};

/** A line held until the speaker reaches its addressee (docs/embodiment.md 6.3). */
export type PendingSpeech = {
  intentId: string;
  content: string;
  targetRef: ActorRef;
  /** now + 2 x ETA + 5 s. */
  expiresAt: number;
};

export const BLOCKED_REASON_CODES = [
  "unknown_ref",
  "target_elsewhere",
  "seat_taken",
  "no_route",
  "busy_moving",
  "not_a_seat",
  "room_unreachable",
  "slow_down",
  "too_far",
  "stale_space",
  "not_in_earshot",
  "cooldown",
] as const;

export type BlockedReasonCode = (typeof BLOCKED_REASON_CODES)[number];

/** JSON-safe on purpose: it travels in `body_blocked` event payloads. */
export type BlockedReason = {
  code: BlockedReasonCode;
  /** Which part of the body intent was refused. */
  part?: "move" | "posture" | "gesture" | "expression" | "face" | "speech";
  /** The handle or name involved, already sanitized. */
  ref?: string;
  detail?: string;
};
