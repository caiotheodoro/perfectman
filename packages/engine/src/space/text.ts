/**
 * Externally authored strings (names, room names, furniture labels) reach the
 * prompt only through this quoting (ADR-0023): a JSON string with `<` and `>`
 * escaped, so quotes, newlines and tags cannot break the line or close a
 * container.
 */
export function quoteText(raw: string): string {
  return JSON.stringify(raw).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

/** Engine-authored text that may still carry a stray angle bracket. */
export function escapeAngles(raw: string): string {
  return raw.replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

export type BodyLanguage = "pt-BR" | "en";
