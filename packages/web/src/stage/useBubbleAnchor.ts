/**
 * Keeps a balloon attached to a head without letting it leave the room.
 *
 * The natural position is "bottom edge just above the speaker", but a figure at
 * the back of the room has only about fifty pixels of headroom, and a full page
 * of text is twice that. Reserving enough padding for the worst case leaves a
 * dead band above the stage on every ordinary beat, and still only works for
 * the text lengths that were guessed at.
 *
 * So it is measured, twice over. Where the head is comes from the speaker's
 * drawn figure — not from a constant, because the constant assumed a 16:7 room
 * and a room capped by the viewport's height is not 16:7, and because the name
 * tag under a figure is set in pixels. Then the balloon is placed against that
 * head, and if that would carry its top out of the frame it slides down until
 * it fits — overlapping the scene, which is what a balloon over a picture is
 * supposed to do.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from "react";

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

/**
 * Whether the balloon could not fit above the head and had to slide down over
 * the figure. The caller moves it beside the head instead: a balloon over a
 * picture is fine, a balloon over the speaker's face is not.
 */
export function bubbleClamped(
  headTop: number,
  roomHeight: number,
  bubbleHeight: number,
  margin = BUBBLE_MARGIN,
): boolean {
  const wanted = (1 - headTop) * roomHeight + roomHeight * 0.02;
  return wanted > roomHeight - bubbleHeight - margin;
}

/**
 * Where the drawn head begins, as a fraction of the room's height, from the
 * figure's and the room's on-screen boxes. Both boxes move together under a
 * page turn's translate, and the ratio cancels it.
 */
export function measuredHeadTop(figure: DOMRect, room: DOMRect): number | undefined {
  if (room.height <= 0) return undefined;
  return (figure.top - room.top) / room.height;
}

export function useBubbleAnchor(
  /** The speaker's mark. Its `.figure__body` is the drawing whose top is the head. */
  speaker: RefObject<HTMLElement>,
  /** Fraction from the room's top where the head should begin, until measured. */
  headTopGuess: number,
  /** Changes whenever the content does, so the measurement is redone. */
  key: string,
): { ref: RefObject<HTMLDivElement>; bottom: string; beside: boolean } {
  const ref = useRef<HTMLDivElement>(null);
  const [bottom, setBottom] = useState(`${(1 - headTopGuess) * 100 + 2}%`);
  const [beside, setBeside] = useState(false);

  useLayoutEffect(() => {
    const node = ref.current;
    const room = node?.offsetParent as HTMLElement | null;
    if (!node || !room) return;

    const place = (): void => {
      const roomHeight = room.clientHeight;
      if (roomHeight === 0) return;
      const figure = speaker.current?.querySelector<SVGElement>(".figure__body");
      const headTop =
        (figure && measuredHeadTop(figure.getBoundingClientRect(), room.getBoundingClientRect())) ?? headTopGuess;
      setBottom(`${bubbleBottom(headTop, roomHeight, node.offsetHeight)}px`);
      setBeside(bubbleClamped(headTop, roomHeight, node.offsetHeight));
    };
    place();

    // The bottom is in pixels, so a resized room needs a fresh measurement.
    if (typeof ResizeObserver === "undefined") return;
    const watcher = new ResizeObserver(place);
    watcher.observe(room);
    return () => watcher.disconnect();
  }, [speaker, headTopGuess, key]);

  return { ref, bottom, beside };
}
