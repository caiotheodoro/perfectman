/** The light of a place at a story minute, and the helpers the plates share. */

export type Light = { top: string; bot: string; lamp: number; stars: number; L: number; h: number };

type LightKey = [hour: number, top: string, bottom: string, lamp: number, stars: number, brightness: number];
/** Hour of day (5 to 29, so the night runs through midnight), sky top and bottom, lamp, stars, overall brightness. */
const KEYS: LightKey[] = [
  [5, "#2a3a68", "#6b7aa6", 0.8, 0.3, 0.5],
  [6.5, "#7ea0d0", "#f3c9a0", 0, 0, 1],
  [18.5, "#3b5a9a", "#f0a35a", 0, 0, 0.95],
  [20, "#1f2f66", "#7d5a8c", 0.4, 0.3, 0.7],
  [21.5, "#172350", "#34407a", 0.8, 0.7, 0.52],
  [24, "#0f1738", "#1f2a58", 1, 1, 0.42],
  [27, "#0b1130", "#18214a", 1, 1, 0.4],
  [29, "#2a3a68", "#6b7aa6", 0.8, 0.3, 0.5],
];

const channel = (h: string, i: number): number => parseInt(h.slice(i, i + 2), 16);

export function mix(h1: string, h2: string, t: number): string {
  const out = [1, 3, 5].map((i) => {
    const a = channel(h1, i), b = channel(h2, i);
    return Math.round(a + (b - a) * t).toString(16).padStart(2, "0");
  });
  return `#${out.join("")}`;
}

export function light(minute: number): Light {
  let h = (minute / 60) % 24;
  if (h < 5) h += 24;
  let a = KEYS[0]!, b = KEYS[KEYS.length - 1]!;
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (h >= KEYS[i]![0] && h <= KEYS[i + 1]![0]) { a = KEYS[i]!; b = KEYS[i + 1]!; break; }
  }
  const t = b[0] === a[0] ? 0 : (h - a[0]) / (b[0] - a[0]);
  return {
    top: mix(a[1], b[1], t), bot: mix(a[2], b[2], t),
    lamp: a[3] + (b[3] - a[3]) * t, stars: a[4] + (b[4] - a[4]) * t, L: a[5] + (b[5] - a[5]) * t,
    h: (minute / 60) % 24,
  };
}

/** "11:42pm". */
export function clockText(minute: number): string {
  const h = Math.floor(minute / 60) % 24, m = Math.round(minute % 60);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

/** A small seeded random, so a plate looks the same every time it is drawn. */
export function rng(seed: number): () => number {
  let x = seed;
  return () => ((x = (Math.imul(x ^ (x >>> 15), 1 | x) + 0x6d2b79f5) | 0) >>> 0) / 4294967296;
}
