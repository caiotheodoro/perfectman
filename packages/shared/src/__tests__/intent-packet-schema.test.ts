import { describe, it, expect } from "vitest";
import {
  ModelIntentPacketSchema,
  ModelIntentPacketJsonSchema,
  MemoryWriteProposalJsonSchema,
  composeIntentPacket,
  memoryWriteProposalFieldContract,
} from "../intent/intent-packet.schema.js";
import { MemoryWriteProposalSchema, IntentTypeSchema, MEMORY_TONE_UNSPECIFIED } from "../intent/intent.schema.js";

describe("ModelIntentPacket", () => {
  it("excludes engine-stamped structural fields (id, actorId, preferredDelay, fallbackIfBlocked)", () => {
    const keys = Object.keys(ModelIntentPacketSchema.shape);
    expect(keys).not.toContain("id");
    expect(keys).not.toContain("actorId");
    expect(keys).not.toContain("preferredDelay");
    expect(keys).not.toContain("fallbackIfBlocked");
  });

  it("zod keys and JSON-Schema properties are identical (no drift)", () => {
    const zodKeys = Object.keys(ModelIntentPacketSchema.shape).sort();
    const jsonKeys = Object.keys(ModelIntentPacketJsonSchema.properties).sort();
    expect(jsonKeys).toEqual(zodKeys);
  });

  it("exposes the full intentType enum, not a subset", () => {
    expect(ModelIntentPacketJsonSchema.properties.intentType?.enum).toEqual(IntentTypeSchema.options);
  });

  it("marks the packet flat with no dangling $ref", () => {
    expect(ModelIntentPacketJsonSchema.additionalProperties).toBe(false);
    expect(JSON.stringify(ModelIntentPacketJsonSchema)).not.toContain("$ref");
  });

  it("composeIntentPacket stamps engine fields and carries model decisions", () => {
    const intent = composeIntentPacket({
      kind: "model",
      packet: { intentType: "send_message", channelTarget: "c1", visibleContent: "oi", privateMotiveSummary: "why", memoryWrites: [] },
      agentId: "a1",
    });
    expect(intent.actorId).toBe("a1");
    expect(intent.id).toMatch(/^[0-9A-Za-z]{21}$/);
    expect(intent.intentType).toBe("send_message");
    expect(intent.channelTarget).toBe("c1");
    expect(intent.visibleContent).toBe("oi");
    expect(intent.preferredDelay).toBe(0);
    expect(intent.fallbackIfBlocked).toBe("no_op");
  });

  it("schema mode requires only `summary` of a memory proposal; the full form is the second branch", () => {
    const items = (ModelIntentPacketJsonSchema.properties as Record<string, { items?: { anyOf?: Array<{ required?: string[] }> } }>)["memoryWrites"]?.items;
    expect(items?.anyOf).toHaveLength(2);
    expect(items?.anyOf?.[0]?.required).toEqual(["summary"]);
    expect(items?.anyOf?.[1]?.required).toContain("emotionalTone");
  });

  it("composeIntentPacket turns a short memory proposal into a full one with the placeholder tone", () => {
    const packet = ModelIntentPacketSchema.parse({
      intentType: "send_message",
      privateMotiveSummary: "m",
      memoryWrites: [{ summary: "o Rafa desviou", about: ["rafa"] }, { summary: "não tenho pra onde ir" }],
    });
    const intent = composeIntentPacket({ kind: "model", packet, agentId: "nina" });
    expect(intent.memoryWrites[0]).toMatchObject({ type: "relationship", subjectAgentIds: ["rafa"], emotionalTone: MEMORY_TONE_UNSPECIFIED, unresolved: true });
    expect(intent.memoryWrites[1]).toMatchObject({ type: "self", subjectAgentIds: [] });
  });

  it("composeIntentPacket assigns no fallback for types the engine can't usefully soften", () => {
    const intent = composeIntentPacket({
      kind: "model",
      packet: { intentType: "no_op", privateMotiveSummary: "why", memoryWrites: [] },
      agentId: "a1",
    });
    expect(intent.fallbackIfBlocked).toBeUndefined();
  });

  it("composeIntentPacket builds a controlled fallback without model fields", () => {
    const intent = composeIntentPacket({
      kind: "fallback",
      agentId: "a1",
      intentType: "no_op",
      reason: "budget exceeded",
    });
    expect(intent.intentType).toBe("no_op");
    expect(intent.privateMotiveSummary).toBe("budget exceeded");
    expect(intent.personTargets).toEqual([]);
  });
});

describe("MemoryWriteProposal", () => {
  it("zod keys and JSON-Schema properties are identical (no drift)", () => {
    const zodKeys = Object.keys(MemoryWriteProposalSchema.shape).sort();
    const jsonKeys = Object.keys(MemoryWriteProposalJsonSchema.properties).sort();
    expect(jsonKeys).toEqual(zodKeys);
  });

  it("field contract lists every schema field with required/optional and type", () => {
    const contract = memoryWriteProposalFieldContract();
    expect(contract).toContain('"type" (required): one of: episodic, relationship, self, social_theory, pending_intention, emotional_residue');
    expect(contract).toContain('"summary" (required): string');
    expect(contract).toContain('"confidence" (required): number (0-1)');
    expect(contract).toContain('"intensity" (required): number (0-1)');
    expect(contract).toContain('"unresolved" (required): boolean');
  });

  const validProposal = {
    type: "episodic" as const,
    subjectAgentIds: [],
    summary: "something happened",
    emotionalTone: "neutral",
    confidence: 0.5,
    intensity: 0.5,
    unresolved: false,
  };

  it("accepts intensity at the [0,1] bounds", () => {
    expect(() => MemoryWriteProposalSchema.parse({ ...validProposal, intensity: 0 })).not.toThrow();
    expect(() => MemoryWriteProposalSchema.parse({ ...validProposal, intensity: 1 })).not.toThrow();
  });

  it.each([-0.1, 1.1, 2])("rejects out-of-range intensity %s", (intensity) => {
    expect(() => MemoryWriteProposalSchema.parse({ ...validProposal, intensity })).toThrow();
  });

  it("rejects a proposal missing intensity", () => {
    const { intensity: _omitted, ...withoutIntensity } = validProposal;
    expect(() => MemoryWriteProposalSchema.parse(withoutIntensity)).toThrow();
  });
});
