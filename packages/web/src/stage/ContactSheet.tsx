/**
 * The run so far, as a strip of small pictures.
 *
 * This is the scrubber. Each frame is one beat, drawn from the same placement
 * the room used, so the strip is a faithful index of what was on the page and
 * never a transcript. In a live run the beats the run has produced but the
 * reader has not reached yet are there, blank, so the queue is visible without
 * being readable. The current frame is ringed and kept in view unless the
 * reader is already looking at the strip.
 */
import { useEffect, useRef, type KeyboardEvent } from "react";
import { Frame, type FrameModel } from "./Frame.js";
import { reducedMotion } from "./motion.js";

export function ContactSheet({
  frames,
  labels,
  index,
  reached,
  live,
  onSeek,
}: {
  frames: readonly FrameModel[];
  labels: readonly string[];
  index: number;
  /** The furthest beat the reader has been shown. Everything past it is blank while live. */
  reached: number;
  live: boolean;
  onSeek: (index: number) => void;
}): JSX.Element {
  const strip = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLButtonElement>(null);
  const hovering = useRef(false);
  const last = Math.max(0, frames.length - 1);

  // Keep the current frame in view, unless the reader is on the strip already
  // — moving it under a pointer or a focus ring is worse than letting it drift.
  useEffect(() => {
    const node = strip.current;
    const target = current.current;
    if (!node || !target || typeof node.scrollTo !== "function") return;
    if (hovering.current || node.contains(document.activeElement)) {
      if (node.contains(document.activeElement)) target.focus();
      return;
    }
    node.scrollTo({
      left: target.offsetLeft - node.clientWidth / 2 + target.offsetWidth / 2,
      behavior: reducedMotion() ? "auto" : "smooth",
    });
  }, [index]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const to =
      event.key === "ArrowRight"
        ? Math.min(last, index + 1)
        : event.key === "ArrowLeft"
          ? Math.max(0, index - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (to === null) return;
    event.preventDefault();
    onSeek(to);
  };

  return (
    <div
      ref={strip}
      className="sheet"
      role="group"
      aria-label="Frames of the run"
      onKeyDown={onKeyDown}
      onPointerEnter={() => (hovering.current = true)}
      onPointerLeave={() => (hovering.current = false)}
    >
      {frames.map((frame, i) => {
        const here = i === index;
        const blank = live && i > reached;
        return (
          <button
            key={frame.id}
            ref={here ? current : undefined}
            type="button"
            className={`sheet__frame${here ? " sheet__frame--here" : ""}`}
            aria-label={blank ? `Beat ${i + 1}, ahead of you` : labels[i]}
            aria-current={here ? "true" : undefined}
            tabIndex={here ? 0 : -1}
            onClick={() => onSeek(i)}
          >
            <Frame model={frame} blank={blank} />
          </button>
        );
      })}
    </div>
  );
}
