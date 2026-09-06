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

/**
 * How tall a figure stands, as a fraction of the room's height.
 *
 * Derived, not measured: a mark is 15% of the room's width, the figure is drawn
 * 100 wide by 168 tall, and the room is 16:7. Balloons hang off the top of a
 * head, so they need this to know where a head ends — and it has to agree with
 * the CSS or a balloon will float or overlap. Change one, change both.
 */
export const FIGURE_HEIGHT_FRACTION = 0.15 * 1.68 * (16 / 7);

/** Where the top of a figure's head sits, as a fraction from the room's top. */
export function headTopFor(slot: StageSlot): number {
  return slot.y - FIGURE_HEIGHT_FRACTION * slot.scale;
}
export type ChannelKind = "public" | "private" | "thought" | "operator";

/*
 * `y` is where the feet land and `scale` is distance from the viewer, so the
 * two move together: further up the frame is further back and smaller. The
 * renderer this came from put its last pair low *and* small, which only worked
 * because that stage had a sidebar cropping the corners.
 */
const PUBLIC_SLOTS: readonly StageSlot[] = [
  { x: 0.29, y: 0.94, scale: 1.0 },
  { x: 0.71, y: 0.94, scale: 1.0 },
  { x: 0.45, y: 0.7, scale: 0.78 },
  { x: 0.63, y: 0.68, scale: 0.76 },
  { x: 0.13, y: 0.52, scale: 0.6 },
  { x: 0.87, y: 0.52, scale: 0.6 },
];

const PRIVATE_SLOTS: readonly StageSlot[] = [
  { x: 0.35, y: 0.94, scale: 1.05 },
  { x: 0.65, y: 0.94, scale: 1.05 },
  { x: 0.5, y: 0.68, scale: 0.78 },
  { x: 0.17, y: 0.52, scale: 0.6 },
  { x: 0.83, y: 0.52, scale: 0.6 },
];

/** A thought has one occupant by definition, and it stands closer. */
const THOUGHT_SLOTS: readonly StageSlot[] = [{ x: 0.5, y: 0.94, scale: 1.25 }];

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
