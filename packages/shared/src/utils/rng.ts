/** Deterministic seeded RNG — mulberry32 algorithm */
export type SeededRng = {
  /** Returns a float in [0, 1) */
  next(): number;
  /** Returns an integer in [0, max) */
  nextInt(max: number): number;
  readonly seed: number;
};

export function createSeededRng(seed: number): SeededRng {
  let state = seed >>> 0;

  function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let z = Math.imul(state ^ (state >>> 15), 1 | state);
    z = (z ^ (z + Math.imul(z ^ (z >>> 7), 61 | z))) >>> 0;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }

  function nextInt(max: number): number {
    return Math.floor(next() * max);
  }

  return { next, nextInt, seed };
}
