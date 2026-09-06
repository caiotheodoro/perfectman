/**
 * Where figures stand.
 *
 * Ported from the video renderer's fixed anchor points, converted to fractions
 * of the stage box so the web view can scale to any window instead of assuming
 * 1920×1080. The structure is unchanged: an ordered list per channel kind, the
 * first slots being the strong front-of-frame positions, and a hard ceiling on
 * how many figures a room shows at once.
 *
 * Assignment is sticky per channel (see `assignSlots`) because a figure that
 * jumps to a different spot between two lines reads as a different person.
 */

export type StageSlot = { x: number; y: number; scale: number };
export type ChannelKind = "public" | "private" | "thought" | "operator";

const PUBLIC_SLOTS: readonly StageSlot[] = [
  { x: 0.28, y: 0.66, scale: 1.0 },
  { x: 0.72, y: 0.66, scale: 1.0 },
  { x: 0.44, y: 0.4, scale: 0.74 },
  { x: 0.62, y: 0.38, scale: 0.72 },
  { x: 0.13, y: 0.8, scale: 0.66 },
  { x: 0.87, y: 0.8, scale: 0.66 },
];

const PRIVATE_SLOTS: readonly StageSlot[] = [
  { x: 0.34, y: 0.66, scale: 1.05 },
  { x: 0.66, y: 0.66, scale: 1.05 },
  { x: 0.5, y: 0.38, scale: 0.74 },
  { x: 0.16, y: 0.8, scale: 0.64 },
  { x: 0.84, y: 0.8, scale: 0.64 },
];

/** A thought has one occupant by definition. */
const THOUGHT_SLOTS: readonly StageSlot[] = [{ x: 0.5, y: 0.6, scale: 1.3 }];

export function slotsFor(kind: ChannelKind): readonly StageSlot[] {
  if (kind === "thought") return THOUGHT_SLOTS;
  if (kind === "private") return PRIVATE_SLOTS;
  return PUBLIC_SLOTS;
}

/**
 * Keeps whoever is already placed where they are, and fills the lowest free
 * slot for anyone new. `previous` is this channel's last assignment; pass an
 * empty map for a room being entered for the first time.
 */
export function assignSlots(
  agentIndexes: readonly number[],
  kind: ChannelKind,
  previous: ReadonlyMap<number, number>,
): Map<number, number> {
  const points = slotsFor(kind);
  const visible = agentIndexes.slice(0, points.length);
  const held = new Map([...previous].filter(([index]) => visible.includes(index)));

  for (const index of visible) {
    if (held.has(index)) continue;
    const taken = new Set(held.values());
    const free = points.findIndex((_, slot) => !taken.has(slot));
    if (free >= 0) held.set(index, free);
  }
  return held;
}
