import { zodToJsonSchema } from "zod-to-json-schema";
import { ActionIntentSchema } from "./intent.schema.js";

/**
 * JSON Schema derived from ActionIntentSchema — the single source of truth
 * (see #49's drift concern: hand-written contract copies are how prompt and
 * validation drifted apart historically).
 *
 * Consumed by OllamaProvider as a structured-output `format` target, so the
 * model can only emit tokens that fit the intent shape at decoding time.
 */
export const ACTION_INTENT_JSON_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze(
  zodToJsonSchema(ActionIntentSchema, {
    $refStrategy: "none",
  }) as Record<string, unknown>,
);
