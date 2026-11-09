import { describe, expect, it } from "vitest";
import { ACT_VERBS } from "../act-verbs.js";
import { BodyActSchema, BodyIntentSchema } from "../body-intent.schema.js";
import {
  ModelIntentPacketSchema,
  ModelIntentPacketWithActJsonSchema,
  ModelIntentPacketWithBodyJsonSchema,
  modelIntentPacketFieldContract,
} from "../../intent/intent-packet.schema.js";

const packet = { intentType: "send_message", privateMotiveSummary: "m", visibleContent: "oi" };

describe("the body act key (act-contract.md 11.5)", () => {
  it("[ACT-6] accepts every one of the 18 verbs, with a target handle and an intensity", () => {
    for (const verb of ACT_VERBS) {
      expect(BodyIntentSchema.safeParse({ act: { verb, target: "p1", intensity: 0.5 } }).success, verb).toBe(true);
    }
    expect(BodyIntentSchema.parse({ act: { verb: "cry" } }).act).toEqual({ verb: "cry" });
  });

  it.each([
    ["a verb outside the 18", { act: { verb: "bite", target: "p1" } }],
    ["an unknown key inside act", { act: { verb: "slap", target: "p1", with: "p1" } }],
    ["a raw avatar id as the target", { act: { verb: "slap", target: "9" } }],
    ["an intensity above 1", { act: { verb: "slap", target: "p1", intensity: 1.1 } }],
    ["a negative intensity", { act: { verb: "slap", target: "p1", intensity: -0.1 } }],
    ["a non-finite intensity", { act: { verb: "slap", target: "p1", intensity: Number.NaN } }],
    ["a verb with no value", { act: {} }],
  ])("[ACT-4] rejects %s", (_name, input) => {
    expect(BodyIntentSchema.safeParse(input).success).toBe(false);
  });

  it("[ACT-4] leaves a missing or surplus target to the validator, which drops the act and keeps the rest", () => {
    // ACT-7 and ACT-8 are the validator's rows; the schema only checks the shape.
    expect(BodyActSchema.safeParse({ verb: "slap" }).success).toBe(true);
    expect(BodyActSchema.safeParse({ verb: "cry", target: "p1" }).success).toBe(true);
  });

  it("[ACT-4] excludes gesture and posture: a block with act and either one is rejected whole", () => {
    expect(BodyIntentSchema.safeParse({ act: { verb: "hug", target: "p1" }, gesture: { kind: "wave" } }).success).toBe(false);
    expect(BodyIntentSchema.safeParse({ act: { verb: "cry" }, posture: { pose: "sit" } }).success).toBe(false);
    expect(BodyIntentSchema.safeParse({ act: { verb: "hug", target: "p1" }, move: { kind: "stay" }, expression: "smile", face: "p1" }).success).toBe(true);
  });

  it("[ACT-4] a malformed act drops the body block and keeps the speech", () => {
    const parsed = ModelIntentPacketSchema.safeParse({ ...packet, body: { act: { verb: "bite", target: "p1" } } });
    expect(parsed.success && parsed.data.body).toBeUndefined();
    expect(parsed.success && parsed.data.visibleContent).toBe("oi");
    const good = ModelIntentPacketSchema.safeParse({ ...packet, body: { act: { verb: "glare", target: "p1" } } });
    expect(good.success && good.data.body?.act).toEqual({ verb: "glare", target: "p1" });
  });
});

describe("what the model is asked for", () => {
  it("[NEG-2] the default with-body views do not mention act, so a run without drama is byte-identical", () => {
    expect(Object.keys(ModelIntentPacketWithBodyJsonSchema.properties)).toContain("body");
    expect(JSON.stringify(ModelIntentPacketWithBodyJsonSchema)).not.toContain('"act"');
    const line = modelIntentPacketFieldContract({ body: true }).find((l) => l.startsWith('"body"'));
    expect(line).not.toContain("act:");
    expect(line).not.toContain("freeze_gasp");
  });

  it("offers an act-aware view (for the prompt packet P4) that lists the 18 verb ids and the handle shape", () => {
    expect(JSON.stringify(ModelIntentPacketWithActJsonSchema)).toContain('"act"');
    const line = modelIntentPacketFieldContract({ body: true, act: true }).find((l) => l.startsWith('"body"'));
    expect(line).toContain(`verb: one of: ${ACT_VERBS.join(", ")}`);
    expect(line).toContain("intensity: number (0-1)");
    expect(JSON.stringify(ModelIntentPacketWithActJsonSchema)).not.toContain("$ref");
  });
});
