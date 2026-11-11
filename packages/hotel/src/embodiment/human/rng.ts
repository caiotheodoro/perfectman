/**
 * Deterministic draws for the human layer. A behaviour's chance is not read from a shared stream that depends on how many other
 * things drew before it: it is a hash of the run's seed and the moment it is for (`hrand(seed, "backchannel", actor, lineNo)`),
 * so the same scene under the same seed plays the same and two behaviours never shift each other's draws.
 */

/** FNV-1a over the parts, then a murmur3-style finalizer: a float in [0, 1). */
export function hrand(seed: number, ...parts: ReadonlyArray<string | number>): number {
  let h = 2166136261 ^ (seed >>> 0);
  for (const part of parts) {
    const s = typeof part === "number" ? `#${part}` : part;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    h = Math.imul(h ^ 0x7c, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A value in [lo, hi] for the moment `parts` names. */
export function hbetween(seed: number, range: readonly [number, number], ...parts: ReadonlyArray<string | number>): number {
  return range[0] + hrand(seed, ...parts) * (range[1] - range[0]);
}

/** Standard normal from two draws (Box-Muller), for lognormal jitter. */
export function hnormal(seed: number, ...parts: ReadonlyArray<string | number>): number {
  const u1 = Math.max(1e-9, hrand(seed, ...parts, "u1"));
  const u2 = hrand(seed, ...parts, "u2");
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** A stable integer seed from a string (a run id, a scene title). */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
