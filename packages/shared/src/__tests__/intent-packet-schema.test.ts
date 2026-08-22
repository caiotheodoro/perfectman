import { describe, it, expect } from "vitest";
import {
  ModelIntentPacketSchema,
  ModelIntentPacketJsonSchema,
  MemoryWriteProposalJsonSchema,
  composeIntentPacket,
  memoryWriteProposalFieldContract,
} from "../intent/intent-packet.schema.js";
import { MemoryWriteProposalSchema } from "../intent/intent.schema.js";

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
    expect(contract).toContain('"unresolved" (required): boolean');
  });
});
