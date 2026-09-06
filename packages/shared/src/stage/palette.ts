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
 * A character's slot in the palette, stable across views.
 *
 * Position in a roster is not enough on its own: the preset card lists persona
 * files alphabetically while the stage lists agents in the order the scenario
 * cast them, so the same person would be blue in one place and yellow in the
 * other. Sorting the ids first makes both sides agree without either needing to
 * know how the other ordered its list, and still guarantees distinct colours
 * within a cast of six or fewer.
 */
export function chipIndexFor(id: string, allIds: readonly string[]): number {
  const sorted = [...new Set(allIds)].sort();
  const at = sorted.indexOf(id);
  return at < 0 ? 0 : at;
}

/**
 * Head shape alternates so a cast is distinguishable in silhouette, not only by
 * colour — what keeps the figures readable for someone who cannot separate the
 * chips. The video renderer alternates every third figure; every other one is
 * better here, because a web cast is usually three to five people and two
 * identical silhouettes side by side is the common case.
 */
export function headShapeFor(index: number): "round" | "speech" {
  return index % 2 === 0 ? "round" : "speech";
}
