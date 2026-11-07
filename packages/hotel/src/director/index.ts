import type { HotelMsg, SidecarMsg } from "./generated.js";

export * from "./generated.js";

/**
 * Every frame on the sidecar socket carries `seq` (u64, from 1 per connection
 * and direction) beside `t`. The schema leaves it out so the unions stay named
 * types, so the envelope is added here.
 */
export type SidecarFrame = SidecarMsg & { seq: number };
export type HotelFrame = HotelMsg & { seq: number };

/** The frame types, i.e. every value of `t`. */
export type SidecarFrameType = SidecarMsg["t"];
export type HotelFrameType = HotelMsg["t"];

/** Narrow a union member by its `t` tag, e.g. `SidecarOf<"actor_spawn">`. */
export type SidecarOf<T extends SidecarFrameType> = Extract<SidecarMsg, { t: T }>;
export type HotelOf<T extends HotelFrameType> = Extract<HotelMsg, { t: T }>;

export function isSidecarMsg<T extends SidecarFrameType>(
  msg: SidecarMsg,
  t: T,
): msg is SidecarOf<T> {
  return msg.t === t;
}

export function isHotelMsg<T extends HotelFrameType>(msg: HotelMsg, t: T): msg is HotelOf<T> {
  return msg.t === t;
}
