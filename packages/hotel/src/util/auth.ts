import { createHash, timingSafeEqual } from "node:crypto";

/** SHA-256 both sides, then a constant-time compare: neither content nor length leaks. */
export function secretMatches(provided: string | undefined, secret: string): boolean {
  const a = createHash("sha256").update(provided ?? "").digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

export function bearer(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  const m = raw ? /^Bearer (.+)$/.exec(raw) : null;
  return m?.[1];
}
