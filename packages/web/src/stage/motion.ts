/**
 * Whether the reader asked for less motion. Read in JS as well as CSS because
 * some motion is structural — a page that stays mounted to animate out — and
 * zeroing a duration does not stop it being mounted.
 */
export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
