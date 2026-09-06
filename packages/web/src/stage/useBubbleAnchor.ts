/**
 * Keeps a balloon attached to a head without letting it leave the room.
 *
 * The natural position is "bottom edge just above the speaker", but a figure at
 * the back of the room has only about fifty pixels of headroom, and a full page
 * of text is twice that. Reserving enough padding for the worst case leaves a
 * dead band above the stage on every ordinary beat, and still only works for
 * the text lengths that were guessed at.
 *
 * So it is measured. The balloon is placed against the head, and if that would
 * carry its top out of the frame it slides down until it fits — overlapping the
 * scene, which is what a balloon over a picture is supposed to do.
 */
import { useLayoutEffect, useRef, useState } from "react";

/** Breathing room between a balloon and the top of the frame. */
export const BUBBLE_MARGIN = 8;

/**
 * Distance from the room's floor to put the balloon's bottom edge.
 *
 * Pure so the guarantee is testable without a browser: whatever the text length
 * or the slot, the result never puts the balloon's top above the frame.
 */
export function bubbleBottom(
  headTop: number,
  roomHeight: number,
  bubbleHeight: number,
  margin = BUBBLE_MARGIN,
): number {
  const wanted = (1 - headTop) * roomHeight + roomHeight * 0.02;
  const ceiling = roomHeight - bubbleHeight - margin;
  return Math.max(0, Math.min(wanted, ceiling));
}

export function useBubbleAnchor(
  /** Fraction from the room's top where the speaker's head begins. */
  headTop: number,
  /** Changes whenever the content does, so the measurement is redone. */
  key: string,
): { ref: React.RefObject<HTMLDivElement>; bottom: string } {
  const ref = useRef<HTMLDivElement>(null);
  const [bottom, setBottom] = useState(`${(1 - headTop) * 100 + 2}%`);

  useLayoutEffect(() => {
    const node = ref.current;
    const room = node?.offsetParent as HTMLElement | null;
    if (!node || !room) return;

    const roomHeight = room.clientHeight;
    if (roomHeight === 0) return;
    setBottom(`${bubbleBottom(headTop, roomHeight, node.offsetHeight)}px`);
  }, [headTop, key]);

  return { ref, bottom };
}
