/**
 * Externally authored strings (names, room names, furniture labels) reach the
 * prompt only through this quoting (ADR-0023). The implementation is the
 * shared one; `quoteText` is this module's historical name for it.
 */
export { escapeAngles, quoteUntrusted as quoteText } from "@perfectman/shared";

export type BodyLanguage = "pt-BR" | "en";
