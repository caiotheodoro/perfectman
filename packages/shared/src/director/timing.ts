/**
 * The timing model, in one place so it can be tuned and tested.
 *
 * A viewer reads at a pace; a balloon stays until its words are read; words
 * land as they are spoken. Paged balloons are paced by the reading, because the
 * next page must not arrive before the last one is finished.
 */
export const PACES = { relaxed: 3.6, normal: 4.6, fast: 6.0 } as const;
export type PaceName = keyof typeof PACES;

/** A single balloon is revealed this much faster than it is read, so the eye is never ahead of the words. */
export const SPEAK_FACTOR = 1.5;
/** Seconds a viewer needs to find a new balloon before they start reading it. */
export const GAZE_SECONDS = 0.6;

const CJK = /[぀-ヿ一-鿿]/;

/** Words, or characters for scripts written without spaces. */
export function tokens(text: string): string[] {
  return CJK.test(text) ? [...text] : text.split(/\s+/).filter(Boolean);
}

export type Timing = {
  wordCount: number;
  /** Seconds from the first word landing to the last. */
  reveal: number;
  /** Seconds from the first word until a viewer has finished reading. */
  read: number;
  tokens: string[];
  /** When each token lands, relative to the start of the line. */
  offsets: number[];
  pages: number;
};

const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

export function timing(text: string, pace: number, pageWords?: number[] | null): Timing {
  const tk = tokens(text);
  const wordCount = CJK.test(text) ? Math.max(1, Math.ceil(tk.length / 2.2)) : tk.length;
  const weight = tk.map((x) => x.length + 1.6);
  const offsets: number[] = [];
  const pages = pageWords && pageWords.length > 1 ? pageWords : null;
  let reveal: number;
  let read: number;
  if (pages) {
    // Each page lasts as long as its words take to read; they land across 90% of that.
    let t0 = 0;
    let k = 0;
    for (const n of pages) {
      const seg = weight.slice(k, k + n);
      const total = seg.reduce((a, b) => a + b, 0) || 1;
      const span = (n / pace) * 0.9;
      let acc = 0;
      for (const w of seg) {
        offsets.push(t0 + (span * acc) / total);
        acc += w;
      }
      t0 += 0.5 + n / pace;
      k += n;
    }
    reveal = t0 - 0.5;
    read = reveal + GAZE_SECONDS;
  } else {
    reveal = clamp(wordCount / (pace * SPEAK_FACTOR), 0.8, 8);
    read = GAZE_SECONDS + wordCount / pace;
    const total = weight.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    for (const w of weight) {
      offsets.push((reveal * acc) / total);
      acc += w;
    }
  }
  return { wordCount, reveal, read, tokens: tk, offsets, pages: pages ? pages.length : 1 };
}
