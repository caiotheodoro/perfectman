/**
 * Character colour, assigned by roster position.
 *
 * Not by agent id: the HTML snapshot generator keys its palette on four literal
 * ids and silently leaves every other cast uncoloured. Not by archetype either
 * — `PersonaConfig.archetype` is a free-form string with no closed set. Roster
 * index is the only key that survives an arbitrary cast, and both `agentIds` in
 * a stored replay and `agents` in a live `hello` are stable ordered arrays.
 *
 * The chips are light enough that ink never changes, which keeps a name legible
 * whichever character it belongs to.
 */

export const CHARACTER_CHIPS: readonly string[] = [
  "#C4E2FB",
  "#F5D188",
  "#C2C2FB",
  "#F9B28C",
  "#B1D9A3",
  "#F3C0D4",
];

export function chipFor(index: number): string {
  return CHARACTER_CHIPS[((index % CHARACTER_CHIPS.length) + CHARACTER_CHIPS.length) % CHARACTER_CHIPS.length]!;
}

/**
 * Head shape alternates so a cast is distinguishable in silhouette, not only by
 * colour — the same trick the video renderer uses, and what keeps the figures
 * readable for someone who cannot separate the chips.
 */
export function headShapeFor(index: number): "round" | "speech" {
  return index % 3 === 0 ? "round" : "speech";
}
