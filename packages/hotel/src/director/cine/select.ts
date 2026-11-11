/**
 * Parallel editing (D38): which room, and which item in it, plays next.
 *
 * Each room keeps its own order (a conversation is not reshuffled), and the
 * Director chooses between the rooms' heads by salience. Staying put is
 * favoured, so a cut needs a reason: a clearly better beat elsewhere, the
 * current room running dry, a character it was following through a door, or
 * the current room having held the screen too long.
 */
import { LIVE_KINDS, OPTIONAL_KINDS } from "./types.js";
import type { CineConfig, CineItem } from "./types.js";

export type SelectContext = {
  /** Playback time, ms. */
  now: number;
  room: number | undefined;
  /** Playback time of the last room cut. */
  roomSince: number;
  followRef: string | undefined;
  cfg: CineConfig;
  /** Items whose command the executor is holding until they play: they have not happened yet, so waiting does not make them stale. */
  held?: ReadonlySet<string>;
};

/**
 * How long an optional item may wait. An observed one (it already happened in the room) is only worth a shot while
 * it is fresh. A held one (its command waits for its beat) has not happened, so it may wait for the film to get to it,
 * up to `heldMaxAgeMs`; run 63 lost 32 of its 88 cues to the short limit while lines kept the stage.
 */
export function maxAgeOf(item: CineItem, cfg: CineConfig, held?: ReadonlySet<string>): number {
  const observed = cfg.optionalMaxAgeMs[item.kind as keyof CineConfig["optionalMaxAgeMs"]];
  return held?.has(item.id) ? Math.max(observed, cfg.heldMaxAgeMs) : observed;
}

/** Optional items that waited too long are not shown late; returns what was removed. */
export function expire(queue: CineItem[], clockNow: number, cfg: CineConfig, held?: ReadonlySet<string>): CineItem[] {
  const dropped: CineItem[] = [];
  for (let i = queue.length - 1; i >= 0; i--) {
    const item = queue[i];
    if (!item || !OPTIONAL_KINDS.has(item.kind)) continue;
    const max = maxAgeOf(item, cfg, held);
    if (clockNow - item.at > max) dropped.push(...queue.splice(i, 1));
  }
  return dropped.reverse();
}

export function scoreHead(item: CineItem, clockNow: number, here: boolean, roomHasItems: boolean, ctx: SelectContext): number {
  const age = Math.min(12, Math.max(0, clockNow - item.at) / 1000);
  let score = item.salience * 10 + age * 0.35;
  // A held item the film has put off for half its patience goes next: its actor is standing still waiting for it.
  if (ctx.held?.has(item.id) && clockNow - item.at > ctx.cfg.heldMaxAgeMs / 2) score += 20;
  if (here) {
    score += 2;
    if (item.kind === "hop") score += 2;
  } else if (roomHasItems) {
    score -= 2;
    if (ctx.now - ctx.roomSince < ctx.cfg.minRoomHoldMs) score -= 100;
    if (ctx.now - ctx.roomSince > ctx.cfg.maxRoomHoldMs) score += 6;
    if (ctx.followRef !== undefined && item.ref === ctx.followRef) score += 5;
  } else if (ctx.followRef !== undefined && item.ref === ctx.followRef) {
    score += 5;
  }
  return score;
}

/**
 * The item to play next, or undefined when the queue is empty. `clockNow` is
 * the wall/test clock the items were stamped with; `ctx.now` is playback time.
 */
export function selectNext(queue: readonly CineItem[], clockNow: number, ctx: SelectContext): CineItem | undefined {
  // Speech keeps its order within a room. Live events (a walk, a door, a kiss) are each a candidate, while fresh.
  const heads = new Map<number, CineItem>();
  const candidates: CineItem[] = [];
  for (const item of queue) {
    if (LIVE_KINDS.has(item.kind)) candidates.push(item);
    else if (!heads.has(item.room)) heads.set(item.room, item);
  }
  candidates.push(...heads.values());
  const currentHasItems = ctx.room !== undefined && queue.some((q) => q.room === ctx.room);
  let best: { item: CineItem; score: number } | undefined;
  for (const item of candidates) {
    const score = scoreHead(item, clockNow, item.room === ctx.room, currentHasItems, ctx);
    if (!best || score > best.score || (score === best.score && item.seq < best.item.seq)) best = { item, score };
  }
  return best?.item;
}
