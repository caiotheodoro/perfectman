/** Banheiro, Bar e Lounge, Cozinha, Elevador e Corredor. The scene is the distance. */
export const WING_ROOMS: ReadonlySet<number> = new Set([45, 43, 44, 49]);

/** Drop a walk that would pull someone off the tile enterRoom already chose. */
export function dropWalk(home: number, plan: string | undefined): boolean {
  return WING_ROOMS.has(home) && !plan?.endsWith(":enter");
}

/** Drop the hug or kiss the planner sends when it wants people closer. */
export function dropPair(home: number): boolean {
  return WING_ROOMS.has(home);
}

/** Wing rooms speak. They do not show the rehearsal. */
export function drawThought(home: number): boolean {
  return !WING_ROOMS.has(home);
}

/** Wing rooms stay in the room. A hop after a dropped walk would film a departure that never happens. */
export function dropLeave(home: number): boolean {
  return WING_ROOMS.has(home);
}
