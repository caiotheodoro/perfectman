import type { BlockedReason, RoomId } from "./space.types.js";

/**
 * Payload shapes for the body event types (ADR-0018). Type aliases, not
 * interfaces, so each is assignable to the JSON-only `EventPayload`.
 * `body_blocked` is operator-only; the rest follow the visibility of the act.
 */

export type BodyActionCommittedPayload = {
  intentId: string;
  /** Names of the `BodyCommand`s dispatched for this intent. */
  commands: string[];
  planId?: string;
};

export type BodyArrivedPayload = {
  planId: string;
  room: RoomId;
  tile: [number, number];
};

export type MovedRoomPayload = {
  from: RoomId;
  to: RoomId;
  planId?: string;
};

export type BodyBlockedPayload = {
  intentId?: string;
  reasons: BlockedReason[];
};

export type SpeechDeferredPayload = {
  intentId: string;
  targetRef: string;
  expiresAt: number;
  etaMs: number;
};

export type PairedActAbortedPayload = {
  pairId: string;
  kind: "kiss" | "hug";
  with: string;
  cause: "movement" | "refused" | "dodge" | "push" | "target_lost" | "timeout";
};
