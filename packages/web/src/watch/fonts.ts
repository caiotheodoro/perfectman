import { LETTERING, SHOUT_FONT, THOUGHT_FONT, type BalloonFont, type TextMeasurer } from "@perfectman/shared";

const FAMILIES: BalloonFont[] = [...Object.values(LETTERING), SHOUT_FONT, THOUGHT_FONT];

/**
 * Waits for the lettering faces, so text is measured in the font it will be
 * drawn in. Where the browser has no font loading API (tests) it resolves at once.
 */
export async function loadLettering(): Promise<void> {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts) return;
  const seen = new Set<string>();
  await Promise.all(FAMILIES.filter((f) => !seen.has(f.family) && seen.add(f.family)).map((f) => fonts.load(`${f.style ?? "normal"} ${f.weight} ${f.size}px "${f.family}"`).catch(() => [])));
}

/** Measures text with a canvas; falls back to an average glyph width where there is no canvas. */
export function canvasMeasurer(): TextMeasurer {
  const ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  return (text, font) => {
    if (!ctx) return text.length * font.size * 0.5;
    ctx.font = `${font.style ?? "normal"} ${font.weight} ${font.size}px "${font.family}"`;
    return ctx.measureText(text).width;
  };
}
