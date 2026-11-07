/**
 * Strings written by strangers (chat lines, usernames, room and furniture
 * names) reach the prompt in the hotel (ADR-0023). The adapter sanitizes at
 * ingestion; this module is the renderer's own defense in depth, so a string
 * that skipped the adapter still cannot break out of its line.
 */

/** Chat 200, names 24, labels 32 (ADR-0023 decision 1). */
export const UNTRUSTED_LIMITS = { chat: 200, name: 24, label: 32 } as const;

// C0/C1 controls, zero-width characters, bidi overrides and isolates, BOM.
const INVISIBLE_OR_CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu;

/** NFKC, no control / zero-width / bidi characters, collapsed whitespace, capped. */
export function sanitizeUntrustedText(text: string, maxChars: number): string {
  const cleaned = text
    .normalize("NFKC")
    .replace(INVISIBLE_OR_CONTROL, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const chars = Array.from(cleaned);
  return chars.length > maxChars ? chars.slice(0, maxChars).join("") : cleaned;
}

/**
 * A JSON string literal with `<` and `>` escaped: quotes and newlines cannot
 * end the line, and no tag can close a prompt container. Reversible for the
 * model, which parses JSON strings natively.
 */
export function quoteUntrusted(text: string): string {
  return JSON.stringify(text).replace(/</gu, "\\u003c").replace(/>/gu, "\\u003e");
}

const NAME_PATTERN = /^[\p{L}\p{N} _.'-]{1,24}$/u;

/** A username that is still odd after sanitizing becomes a neutral alias (ADR-0023). */
export function safeDisplayName(name: string | undefined, alias: string): string {
  const cleaned = sanitizeUntrustedText(name ?? "", UNTRUSTED_LIMITS.name);
  return NAME_PATTERN.test(cleaned) ? cleaned : alias;
}
