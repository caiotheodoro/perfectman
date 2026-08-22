import { describe, it, expect } from "vitest";
import { ACTION_INTENT_JSON_SCHEMA } from "../intent/intent-json-schema.js";
import type { ActionIntent } from "../intent/intent.types.js";

describe("ACTION_INTENT_JSON_SCHEMA", () => {
  const schema = ACTION_INTENT_JSON_SCHEMA as {
    type: string;
    properties: Record<string, { type?: string; enum?: string[]; anyOf?: unknown[] }>;
    required: string[];
    additionalProperties: boolean;
  };

  it("is a flat object schema with no dangling refs", () => {
    expect(schema.type).toBe("object");
    expect(JSON.stringify(schema)).not.toContain("$ref");
    expect(schema.additionalProperties).toBe(false);
  });

  it("exposes the full intent-type enum", () => {
    expect(schema.properties.intentType?.enum).toContain("send_message");
    expect(schema.properties.intentType?.enum).toContain("no_op");
  });

  it("requires the core identity fields", () => {
    for (const key of ["actorId", "intentType", "privateMotiveSummary"]) {
      expect(schema.required, key).toContain(key);
    }
  });

  it("stays in sync with the zod schema on a known-good intent shape", () => {
    // Smoke: every property of a canonical intent must exist in the schema
    // with a concrete type mapping.
    const intent: ActionIntent = {
      id: "i1",
      actorId: "a1",
      intentType: "send_message",
      channelTarget: "ch",
      personTargets: [],
      visibleContent: "oi",
      privateMotiveSummary: "m",
      emotionDrivers: [],
      motivationDrivers: [],
      memoryWrites: [],
    };
    const unknownKeys = Object.keys(intent).filter(
      k => !("type" in (schema.properties[k] ?? {})) && !("$ref" in (schema.properties[k] ?? {})) && !("anyOf" in (schema.properties[k] ?? {})),
    );
    expect(unknownKeys).toEqual([]);
    expect(schema.properties.memoryWrites?.type).toBe("array");
  });
});
