import { sanitizeUntrustedText } from "@perfectman/shared";

/** Text hygiene at the hotel boundary (ADR-0023, D42). */

export const MAX_CHAT_CHARS = 200;
export const MAX_SENDER_NAME_CHARS = 24;

/** NFKC, no control or bidi characters, collapsed whitespace, clipped to `max` characters (the one shared sanitizer). */
export function sanitizeText(input: string, max: number): string {
  return sanitizeUntrustedText(input, max);
}

/** A name that survives sanitizing, else a stable alias so nothing odd reaches a prompt. */
export function sanitizeName(input: string, userId: number | string): string {
  const name = sanitizeText(input, MAX_SENDER_NAME_CHARS);
  // Letters, digits and the usual name punctuation only; anything else is an alias.
  if (name.length >= 1 && /^[\p{L}\p{N} ._'-]+$/u.test(name)) return name;
  const n = Math.abs(Number(userId) || 0) % 1000;
  return `Guest ${n}`;
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;

/**
 * Links and markdown out of actor text (D42). The hotel strips again on its
 * side; doing it here keeps the logged intent and the delivered line equal.
 */
export function stripBotOutput(input: string): string {
  const text = input
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(URL_RE, " ")
    .replace(/`{1,3}/g, "")
    .replace(/^[ \t]*(?:#{1,6}|>|[-*+])\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~\n]+)[*_~]{1,3}/g, "$1")
    .replace(/[*_~#<>|\\]/g, "");
  return sanitizeText(text, MAX_CHAT_CHARS);
}

/** Lowercase, no diacritics: names are matched this way. */
export function fold(input: string): string {
  return input.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
