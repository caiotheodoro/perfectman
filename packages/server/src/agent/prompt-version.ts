/**
 * Deterministic FNV-1a hash over the concatenation of a prompt's parts, used as
 * the stable `promptVersion` for attribution. Content-only: identical rendered
 * prompts hash identically regardless of build, and only real content changes
 * bump the version.
 */
export function promptVersionHash(parts: readonly string[]): string {
  const canonical = parts.join("\u0000");
  let h = 2166136261;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
