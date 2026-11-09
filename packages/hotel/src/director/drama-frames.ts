import type { HotelFrame } from "./index.js";

/**
 * The hotel-to-sidecar frames that exist only in a dialect 2 session (act-contract.md 3.1). The hotel never sends them to
 * a link that is not dialect 2 (NEG-5); the Director client also refuses to pass one up from such a link.
 */
export const DRAMA_HOTEL_TYPES = ["act_started", "act_beat", "act_reaction", "act_done", "drama_consent", "actor_death", "actor_revive", "human_down", "human_up", "scene_cut", "drama_state"] as const;

export type DramaHotelType = (typeof DRAMA_HOTEL_TYPES)[number];

export type DramaFrame = Extract<HotelFrame, { t: DramaHotelType }>;

const DRAMA_TYPE_SET: ReadonlySet<string> = new Set(DRAMA_HOTEL_TYPES);

export function isDramaFrame(frame: HotelFrame): frame is DramaFrame {
  return DRAMA_TYPE_SET.has(frame.t);
}
