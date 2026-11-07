import { describe, it, expect } from "vitest";
import { BodyIntentSchema } from "../body-intent.schema.js";
import {
  ModelIntentPacketSchema,
  ModelIntentPacketJsonSchema,
  ModelIntentPacketWithBodyJsonSchema,
  composeIntentPacket,
  modelIntentPacketFieldContract,
} from "../../intent/intent-packet.schema.js";
import { EventTypeSchema } from "../../event/event.schema.js";

describe("BodyIntentSchema", () => {
  it("accepts a move plus gesture and fills the defaults", () => {
    const body = BodyIntentSchema.parse({
      move: { kind: "approach", target: "p1" },
      gesture: { kind: "wave", toward: "p1" },
    });
    expect(body.move).toEqual({ kind: "approach", target: "p1", band: "personal" });
    expect(body.order).toBe("move_then_speak");
  });

  it("accepts the empty block and every move kind", () => {
    expect(BodyIntentSchema.safeParse({}).success).toBe(true);
    for (const move of [
      { kind: "go_to", place: "z2" },
      { kind: "follow", target: "p3" },
      { kind: "keep_distance", target: "p3" },
      { kind: "leave" },
      { kind: "leave", to: "r1" },
      { kind: "stay" },
    ]) {
      expect(BodyIntentSchema.safeParse({ move }).success).toBe(true);
    }
  });

  it.each([
    ["a raw id instead of a handle", { move: { kind: "go_to", place: "bar" } }],
    ["a coordinate-style key", { move: { kind: "go_to", place: "z1" }, x: 3 }],
    ["a sign style out of range", { gesture: { kind: "sign", style: 18 } }],
    ["keep_distance below its floor", { move: { kind: "keep_distance", target: "p1", min: 1 } }],
  ])("rejects %s", (_name, input) => {
    expect(BodyIntentSchema.safeParse(input).success).toBe(false);
  });
});

describe("body in the intent packet", () => {
  const base = { intentType: "send_message", privateMotiveSummary: "m" };

  it("is optional, and a packet without it is today's packet", () => {
    const packet = ModelIntentPacketSchema.parse(base);
    expect(packet.body).toBeUndefined();
    expect(composeIntentPacket({ kind: "model", packet, agentId: "a1" }).body).toBeUndefined();
  });

  it("is copied onto the ActionIntent", () => {
    const packet = ModelIntentPacketSchema.parse({ ...base, body: { move: { kind: "go_to", place: "z1" } } });
    const intent = composeIntentPacket({ kind: "model", packet, agentId: "a1" });
    expect(intent.body?.move).toEqual({ kind: "go_to", place: "z1" });
  });

  it("drops an invalid body block and keeps the speech (ADR-0019)", () => {
    const parsed = ModelIntentPacketSchema.safeParse({
      ...base,
      visibleContent: "oi",
      body: { move: { kind: "go_to", place: "nope" } },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.body).toBeUndefined();
    expect(parsed.success && parsed.data.visibleContent).toBe("oi");
  });
});

describe("describePacketFieldType: object and anyOf branches", () => {
  it("leaves the default contract and decode schema without body (non-hotel runs are unchanged)", () => {
    expect(modelIntentPacketFieldContract().some((l) => l.startsWith('"body"'))).toBe(false);
    expect(Object.keys(ModelIntentPacketJsonSchema.properties)).not.toContain("body");
  });

  it("lists body fields with their enums and ranges instead of collapsing to string", () => {
    const line = modelIntentPacketFieldContract({ body: true }).find((l) => l.startsWith('"body"'));
    expect(line).toBeDefined();
    expect(line).toMatch(/^"body" \(optional\): object \(/);
    expect(line).toContain("pose: one of: stand, sit, lay");
    expect(line).toContain("style: integer (0-17)");
    expect(line).toContain("expression: one of: neutral, smile, angry, sad, surprised, sleepy");
    expect(line).toContain("band: one of: intimate, personal, social");
    expect(line).toContain("min: integer (2-10)");
    // the discriminated union renders every branch, not just the first
    expect(line).toContain('kind: "approach"');
    expect(line).toContain('kind: "stay"');
    expect(line).toContain("string matching ^[pzfr]\\d+$");
    expect(line).not.toMatch(/body" \(optional\): string/);
  });

  it("keeps the with-body decode schema flat and in step with the zod keys", () => {
    expect(Object.keys(ModelIntentPacketWithBodyJsonSchema.properties).sort()).toEqual(
      Object.keys(ModelIntentPacketSchema.shape).sort(),
    );
    expect(JSON.stringify(ModelIntentPacketWithBodyJsonSchema)).not.toContain("$ref");
  });
});

describe("hotel event types", () => {
  it("are accepted by EventTypeSchema", () => {
    for (const t of ["body_action_committed", "body_arrived", "moved_room", "body_blocked", "speech_deferred", "paired_act_aborted"]) {
      expect(EventTypeSchema.safeParse(t).success).toBe(true);
    }
  });
});
