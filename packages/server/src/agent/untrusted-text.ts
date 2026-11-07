/**
 * Strings written by strangers (chat lines, usernames, room and furniture
 * names) reach the prompt in the hotel (ADR-0023). The adapter sanitizes at
 * ingestion; this module is the renderer's own defense in depth, so a string
 * that skipped the adapter still cannot break out of its line.
 */

import { sanitizeUntrustedText } from "@perfectman/shared";

/** Chat 200, names 24, labels 32 (ADR-0023 decision 1). */
export const UNTRUSTED_LIMITS = { chat: 200, name: 24, label: 32 } as const;

// C0/C1 controls, zero-width characters, bidi overrides and isolates, BOM.
export { sanitizeUntrustedText, quoteUntrusted } from "@perfectman/shared";

const NAME_PATTERN = /^[\p{L}\p{N} _.'-]{1,24}$/u;

/** A username that is still odd after sanitizing becomes a neutral alias (ADR-0023). */
export function safeDisplayName(name: string | undefined, alias: string): string {
  const cleaned = sanitizeUntrustedText(name ?? "", UNTRUSTED_LIMITS.name);
  return NAME_PATTERN.test(cleaned) ? cleaned : alias;
}
