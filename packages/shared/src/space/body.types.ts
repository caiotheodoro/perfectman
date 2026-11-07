import type { ActorRef, AvatarState, BlockedReason, BodyPlanStatus, Direction8, RoomId, Tile } from "./space.types.js";

/**
 * Body perception and commands (docs/embodiment.md sections 5 and 7).
 * Types only; the builder is `packages/engine`, the planner is `packages/hotel`.
 */

// ---- perception ------------------------------------------------------------

/** Handle families: `p#` people, `z#` places, `f#` furniture, `r#` rooms. Minted per render. */
export type BodyHandleKind = "person" | "zone" | "furni" | "room";

export type BodyHandleTarget =
  | { kind: "person"; ref: ActorRef }
  | { kind: "zone"; roomId: RoomId; zoneId: string }
  | { kind: "furni"; roomId: RoomId; furniId: number }
  | { kind: "room"; roomId: RoomId };

/** Handle (`p1`, `z2`, ...) to target. Empty when nothing is in view, never absent when `body` is. */
export type BodyHandleMap = Record<string, BodyHandleTarget>;

export type DistanceBand = "intimate" | "personal" | "social" | "public" | "out_of_sight";

/** Relative facing of another person: sector difference 0 or +-1, +-2, else. */
export type FacingKind = "facing" | "side_on" | "back_turned";

export type HearingLevel = "clear" | "garbled" | "notice";

export type BodyPersonLine = {
  handle: string;
  /** Sanitized; the renderer quotes it (ADR-0023). */
  name: string;
  band: DistanceBand;
  steps?: number;
  posture: AvatarState;
  facing?: FacingKind;
  activity?: string;
  /** "someone is very close": a non-intimate person inside the intimate band. */
  tooClose?: boolean;
  /** Interlocutor or addressee: never trimmed. */
  pinned?: boolean;
};

export type BodyGroupLine = { count: number; where?: string; activity?: string; band: DistanceBand };

export type BodyPlaceLine = {
  handle: string;
  label: string;
  steps?: number;
  /** For seating clusters: free seats out of total. */
  freeSeats?: number;
  totalSeats?: number;
};

export type BodyRoomLine = { handle: string; name: string; travelS: number };

export type BodyChange =
  | { kind: "arrived"; name: string }
  | { kind: "left"; name: string; via?: string }
  | { kind: "moved"; name: string }
  | { kind: "gesture"; name: string; a: string };

export type BodyHearingLine = { name: string; level: HearingLevel };

export type BodySelfLine = {
  room: string;
  zone?: string;
  posture: AvatarState;
  /** Label of the thing the actor is facing, if any. */
  facing?: string;
  /** Seconds in the current posture and place. */
  dwellS: number;
};

/** Structured form of the "Seu corpo e o lugar" block; rendering is `ActionIntentPromptBuilder.renderBody`. */
export type BodyPerception = {
  self: BodySelfLine;
  plan?: { goal: string; etaMs?: number; status: BodyPlanStatus };
  blocked: BlockedReason[];
  people: BodyPersonLine[];
  groups: BodyGroupLine[];
  changes: BodyChange[];
  hearing: BodyHearingLine[];
  reach: BodyPlaceLine[];
  places: BodyPlaceLine[];
  rooms: BodyRoomLine[];
  /** The room could not be synced cleanly: the prompt says the actor cannot see clearly. */
  degraded?: boolean;
};

// ---- commands --------------------------------------------------------------

export type SpeechMode = "say" | "shout" | "whisper";

export type PairKind = "kiss" | "hug";

export type BodyCommandBody =
  | { cmd: "walk"; to: Tile; plan?: string }
  | { cmd: "face"; dir?: Direction8; targetTile?: Tile }
  | { cmd: "sit"; furniId: number }
  | { cmd: "stand" }
  | { cmd: "lay" }
  /** `kiss` is sent as the wire action `blow` (docs/embodiment.md 6.1). */
  | { cmd: "gesture"; a: string; style?: number }
  | { cmd: "expression"; face: string }
  | { cmd: "chat"; mode: SpeechMode; text: string; to?: ActorRef }
  | { cmd: "move_room"; to: RoomId }
  | { cmd: "typing"; on: boolean }
  /** `pair` is the sidecar-chosen id echoed back in `pair_reaction`. */
  | { cmd: "pair"; kind: PairKind; with: ActorRef; pair: string };

export type BodyCommandName = BodyCommandBody["cmd"];

/** One command for one actor. Carried on the wire as `actor_cmd`. */
export type BodyCommand = { agentId: string; intentId?: string } & BodyCommandBody;

// ---- frame log -------------------------------------------------------------

/** Timestamped frame in either direction, for body probes (docs/embodiment.md section 10). */
export type BodyFrame = {
  /** Wall-clock ms. */
  atMs: number;
  dir: "in" | "out";
  room?: RoomId;
  kind: string;
  data: Record<string, unknown>;
};

export type BodyFrameLog = {
  frames: BodyFrame[];
  /** Periodic space snapshots (JSON-safe) the probes cross-check against. */
  snapshots: { atMs: number; room: RoomId; occupants: { ref: ActorRef; tile: Tile; dir: Direction8; state: AvatarState }[] }[];
};
