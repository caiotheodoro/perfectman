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
 * How tall a figure's drawing stands, as a fraction of the room's height, in a
 * 16:7 room: a mark is 18% of the room's width and the figure is a face drawn
 * 100 wide by 100 tall. This is the first-paint guess for where a head begins;
 * the stage measures the real thing once it has laid out, because the name tag
 * under the face is set in pixels and the room is not 16:7 on a phone.
 */
export const FIGURE_HEIGHT_FRACTION = 0.18 * 1.0 * (16 / 7);

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
  { x: 0.29, y: 0.92, scale: 1.0 },
  { x: 0.71, y: 0.92, scale: 1.0 },
  // The mid pair sits inside the front pair's gap so their name tags clear the
  // front faces: a tag under .63 landed inside the face at .71.
  { x: 0.43, y: 0.66, scale: 0.78 },
  { x: 0.57, y: 0.64, scale: 0.76 },
  { x: 0.13, y: 0.46, scale: 0.6 },
  { x: 0.87, y: 0.46, scale: 0.6 },
];

const PRIVATE_SLOTS: readonly StageSlot[] = [
  { x: 0.35, y: 0.92, scale: 1.05 },
  { x: 0.65, y: 0.92, scale: 1.05 },
  { x: 0.5, y: 0.64, scale: 0.78 },
  { x: 0.17, y: 0.46, scale: 0.6 },
  { x: 0.83, y: 0.46, scale: 0.6 },
];

/** A thought has one occupant by definition, and it stands closer. */
const THOUGHT_SLOTS: readonly StageSlot[] = [{ x: 0.5, y: 0.92, scale: 1.25 }];

export function slotsFor(kind: ChannelKind): readonly StageSlot[] {
  if (kind === "thought") return THOUGHT_SLOTS;
  if (kind === "private") return PRIVATE_SLOTS;
  return PUBLIC_SLOTS;
}

/**
 * Keeps whoever is already placed where they are, and fills the lowest free
 * slot for anyone new. `previous` is this channel's last assignment; pass an
 * empty map for a room being entered for the first time.
 *
 * A held slot is only honoured if the new room actually has it. Rooms differ in
 * size — six places in public, five in private, one in a thought — so carrying
 * a slot across without checking hands back a position that does not exist.
 */
export function assignSlots(
  agentIndexes: readonly number[],
  kind: ChannelKind,
  previous: ReadonlyMap<number, number>,
): Map<number, number> {
  const points = slotsFor(kind);
  const visible = agentIndexes.slice(0, points.length);
  const held = new Map(
    [...previous].filter(([index, slot]) => visible.includes(index) && slot < points.length),
  );

  for (const index of visible) {
    if (held.has(index)) continue;
    const taken = new Set(held.values());
    const free = points.findIndex((_, slot) => !taken.has(slot));
    if (free >= 0) held.set(index, free);
  }
  return held;
}
