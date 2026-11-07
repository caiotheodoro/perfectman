import { classifyFurni as classifyCatalogItem, deriveZones } from "@perfectman/engine";
import type { ZoneRoomInput } from "@perfectman/engine";
import type { Affordance, Zone } from "@perfectman/shared";

/**
 * Semantic layer over the engine (embodiment.md 4). The mirror derives zones
 * with the engine's `deriveZones`; this file only adds what the Director's
 * catalog knows and the engine's name-based classifier cannot: the definition's
 * `seat` and `lay` flags.
 */
export type DeriveZones = (room: ZoneRoomInput) => Zone[];

export const deriveRoomZones: DeriveZones = (room) => deriveZones(room);

/** Affordances and a semantic label for a furni definition (display names are untrusted, ADR-0023). */
export function classifyFurni(defId: string, name: string, seat: boolean, lay: boolean): { kinds: Affordance[]; label: string } {
  const { kinds: byName, label } = classifyCatalogItem(defId, name);
  const kinds = new Set<Affordance>(byName);
  if (seat) kinds.add("sit");
  if (lay) kinds.add("lay");
  if (kinds.size > 1) kinds.delete("decor");
  return { kinds: [...kinds], label };
}
