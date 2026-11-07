/**
 * The one place externally authored text is cleaned and quoted before it can
 * reach a prompt (ADR-0023). The engine's labels, the server's prompt builder
 * and the hotel adapter's ingestion all use these; none keeps its own copy.
 */

// Control (Cc) and format (Cf) characters cover C0/C1 controls, zero-width
// characters, bidi embeddings and isolates, BOM and the tag block that hides
// instructions from a human reader.
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu;

/** NFKC, no control / zero-width / bidi characters (each becomes a space), collapsed whitespace, capped at `maxChars` characters. */
export function sanitizeUntrustedText(text: string, maxChars: number): string {
  const cleaned = text.normalize("NFKC").replace(CONTROL_OR_FORMAT, " ").replace(/\s+/gu, " ").trim();
  const chars = Array.from(cleaned);
  return chars.length > maxChars ? chars.slice(0, maxChars).join("") : cleaned;
}

/** Engine-authored text that may still carry a stray angle bracket. */
export function escapeAngles(text: string): string {
  return text.replace(/</gu, "\\u003c").replace(/>/gu, "\\u003e");
}

/**
 * A JSON string literal with `<` and `>` escaped: quotes and newlines cannot
 * end the line, and no tag can close a prompt container. Reversible for the
 * model, which parses JSON strings natively.
 */
export function quoteUntrusted(text: string): string {
  return escapeAngles(JSON.stringify(text));
}
