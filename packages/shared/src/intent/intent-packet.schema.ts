import { z } from "zod";
import { createId } from "../utils/id.js";
import type { ActionIntent, IntentType } from "./intent.types.js";
import { IntentTypeSchema, IntentChannelTypeSchema, MemoryWriteProposalSchema } from "./intent.schema.js";

/**
 * The model-decision packet: only the fields the model legitimately decides.
 * Structural fields the engine owns (id, actorId, preferredDelay,
 * fallbackIfBlocked) are intentionally NOT here — they are stamped by
 * `composeIntentPacket`, not requested from the model. This is the single
 * source of truth for both the prompt contract and constrained decoding.
 */
export const ModelIntentPacketSchema = z.object({
  intentType: IntentTypeSchema,
  channelTarget: z.string().optional(),
  personTargets: z.array(z.string()).default([]),
  visibleContent: z.string().optional(),
  privateMotiveSummary: z.string().min(1),
  emotionDrivers: z.array(z.string()).default([]),
  motivationDrivers: z.array(z.string()).default([]),
  memoryWrites: z.array(MemoryWriteProposalSchema).default([]),
  replyToEventId: z.string().optional(),
  emoji: z.string().optional(),
  targetEventId: z.string().optional(),
  channelName: z.string().optional(),
  channelType: IntentChannelTypeSchema.optional(),
  invitedAgentIds: z.array(z.string()).optional(),
  spectatorSummary: z.string().optional(),
});

export type ModelIntentPacket = z.infer<typeof ModelIntentPacketSchema>;

/**
 * JSON Schema mirror of the packet, used for constrained decoding
 * (Ollama `format` object / OpenAI `response_format.json_schema`). Kept in
 * lockstep with ModelIntentPacketSchema; a drift-test asserts field parity.
 */
export const ModelIntentPacketJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intentType", "privateMotiveSummary"],
  properties: {
    intentType: { enum: IntentTypeSchema.options },
    channelTarget: { type: "string" },
    personTargets: { type: "array", items: { type: "string" } },
    visibleContent: { type: "string" },
    privateMotiveSummary: { type: "string", minLength: 1 },
    emotionDrivers: { type: "array", items: { type: "string" } },
    motivationDrivers: { type: "array", items: { type: "string" } },
    memoryWrites: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "subjectAgentIds", "summary", "emotionalTone", "confidence", "unresolved"],
        properties: {
          type: {
            enum: ["episodic", "relationship", "self", "social_theory", "pending_intention", "emotional_residue"],
          },
          subjectAgentIds: { type: "array", items: { type: "string" } },
          summary: { type: "string", minLength: 1 },
          emotionalTone: { type: "string", minLength: 1 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          unresolved: { type: "boolean" },
        },
      },
    },
    replyToEventId: { type: "string" },
    emoji: { type: "string" },
    targetEventId: { type: "string" },
    channelName: { type: "string" },
    channelType: { enum: IntentChannelTypeSchema.options },
    invitedAgentIds: { type: "array", items: { type: "string" } },
    spectatorSummary: { type: "string" },
  },
} as const;

type JsonSchemaProp = {
  type?: string;
  enum?: readonly string[];
  items?: { type?: string; properties?: Record<string, unknown> };
};

function describePacketFieldType(def: JsonSchemaProp): string {
  if (def.enum) return `one of: ${def.enum.join(", ")}`;
  if (def.type === "array") {
    const items = def.items;
    if (items?.type === "object" && items.properties) {
      return `array of objects (${Object.keys(items.properties).join(", ")})`;
    }
    return "array of strings";
  }
  return "string";
}

/**
 * Compact per-field guidance derived straight from `ModelIntentPacketJsonSchema`,
 * so the prompt's field list can never drift from what the parser and
 * constrained decoding actually accept (the drift test above pins zod/JSON
 * Schema parity; this pins prompt/schema parity on top of that). Needed on
 * decode paths where the schema isn't actually enforced by the provider
 * (json_object fallback, `responseFormatJsonSchema:false`, non-strict
 * `json_schema` backends) — the tolerant parser can't repair a field the
 * model was never shown.
 */
export function modelIntentPacketFieldContract(): string[] {
  const { properties, required } = ModelIntentPacketJsonSchema;
  return Object.entries(properties).map(([name, def]) => {
    const isRequired = (required as readonly string[]).includes(name);
    return `"${name}" (${isRequired ? "required" : "optional"}): ${describePacketFieldType(def as JsonSchemaProp)}`;
  });
}

/**
 * Merges a validated model packet with the engine-stamped structural fields
 * to produce the full engine-side ActionIntent. `defaultIntentType` is used by
 * controlled fallbacks (no_op / delay_response) so those never pass through
 * the model boundary at all.
 */
export type IntentComposeInput =
  | { kind: "model"; packet: ModelIntentPacket; agentId: string }
  | { kind: "fallback"; agentId: string; intentType: IntentType; reason: string };

/**
 * Merges either a validated model packet (engine stamps id/actorId/preferredDelay)
 * or a controlled fallback spec into a full engine-side ActionIntent. The
 * discriminated input keeps the two paths typed — no casts, no silent mixing.
 */
export function composeIntentPacket(spec: IntentComposeInput): ActionIntent {
  if (spec.kind === "fallback") {
    return {
      id: createId(),
      actorId: spec.agentId,
      intentType: spec.intentType,
      personTargets: [],
      privateMotiveSummary: spec.reason,
      emotionDrivers: [],
      motivationDrivers: [],
      memoryWrites: [],
      preferredDelay: spec.intentType === "delay_response" ? 0 : undefined,
    };
  }
  const { packet } = spec;
  return {
    id: createId(),
    actorId: spec.agentId,
    intentType: packet.intentType,
    preferredDelay: 0,
    channelTarget: packet.channelTarget,
    personTargets: packet.personTargets,
    visibleContent: packet.visibleContent,
    privateMotiveSummary: packet.privateMotiveSummary,
    emotionDrivers: packet.emotionDrivers,
    motivationDrivers: packet.motivationDrivers,
    memoryWrites: packet.memoryWrites,
    replyToEventId: packet.replyToEventId,
    emoji: packet.emoji,
    targetEventId: packet.targetEventId,
    channelName: packet.channelName,
    channelType: packet.channelType,
    invitedAgentIds: packet.invitedAgentIds,
    spectatorSummary: packet.spectatorSummary,
  };
}
