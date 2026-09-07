import { useEffect, useRef, useState } from "react";

/** Keep unread beats on stage while the reader is in another browser tab. */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const update = (): void => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    update();
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/**
 * Whether the reader asked for less motion. Read in JS as well as CSS because
 * some motion is structural — a page that stays mounted to animate out — and
 * zeroing a duration does not stop it being mounted.
 */
export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Keep a newly selected line in view on phones; background arrivals do not move the reader. */
export function useReadingPosition(beatId: string | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(beatId);
  function reveal(): void {
    if (typeof matchMedia !== "function" || !matchMedia("(max-width: 640px)").matches) return;
    requestAnimationFrame(() => {
      const page = ref.current?.querySelector(".pages");
      if (page) window.scrollTo({ top: Math.max(0, window.scrollY + page.getBoundingClientRect().top - 12), behavior: "instant" });
    });
  }
  useEffect(() => {
    if (previous.current === beatId) return;
    previous.current = beatId;
    const box = ref.current?.querySelector(".pages")?.getBoundingClientRect();
    // Autoplay follows a scene already being read. Scrolling into Details is intentional.
    if (beatId && box && box.bottom > 0 && box.top < window.innerHeight - 100) reveal();
  }, [beatId]);
  return { ref, reveal };
}
