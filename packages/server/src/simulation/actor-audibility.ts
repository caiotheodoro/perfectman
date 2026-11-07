import { SAY_CLEAR_TILES, SAY_GARBLED_TILES, chebyshev } from "@perfectman/engine";
import type { HearingLevel, SpaceModel, SpeechMode } from "@perfectman/shared";
import type { AudibilityResult } from "./intent-resolver.js";

/** Bystanders this close to a whisper notice that it happened (docs/embodiment.md 5.2). */
export const WHISPER_NOTICE_TILES = 2;

/**
 * Who hears a line, and how well, from the speaker's position in the space
 * model (docs/embodiment.md 5.2, D29): `say` is clear within 6 tiles and
 * garbled to 10; `shout` reaches the whole room; a `whisper` reaches its
 * target, and bystanders within 2 tiles only notice it. Only actors are
 * listeners here (humans keep room-wide chat). Returns undefined when the
 * speaker's position is unknown, so the event is left unstamped.
 */
export function computeActorAudibility(
  model: SpaceModel,
  speakerRef: string,
  mode: SpeechMode,
  whisperTo?: string,
): AudibilityResult | undefined {
  const roomId = model.agentRoom.get(speakerRef);
  if (roomId === undefined || roomId === "in_transit") return undefined;
  const room = model.rooms.get(roomId);
  const speaker = room?.occupants.get(speakerRef);
  if (!room || !speaker) return undefined;

  const hearing: Record<string, HearingLevel> = {};
  for (const occupant of room.occupants.values()) {
    if (occupant.ref === speakerRef || occupant.kind !== "actor") continue;
    const distance = chebyshev(speaker.tile, occupant.tile);
    let level: HearingLevel | undefined;
    if (mode === "shout") level = "clear";
    else if (mode === "whisper") {
      if (occupant.ref === whisperTo) level = "clear";
      else if (distance <= WHISPER_NOTICE_TILES) level = "notice";
    } else if (distance <= SAY_CLEAR_TILES) level = "clear";
    else if (distance <= SAY_GARBLED_TILES) level = "garbled";
    if (level) hearing[occupant.ref] = level;
  }
  return { visibleToAgents: Object.keys(hearing), hearing };
}
