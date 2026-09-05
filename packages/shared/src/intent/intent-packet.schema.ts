import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { createId } from "../utils/id.js";
import type { ActionIntent, IntentType } from "./intent.types.js";
import { IntentTypeSchema, IntentChannelTypeSchema, MemoryWriteProposalSchema } from "./intent.schema.js";

/**
 * The model-decision packet: only the fields the model legitimately decides.
 * Structural fields the engine owns (id, actorId, preferredDelay,
 * fallbackIfBlocked) are intentionally NOT here — they are computed by
 * `composeIntentPacket` from `intentType` (see `ENGINE_FALLBACK_ELIGIBLE_TYPES`
 * below), not requested from the model. This is the single source of truth
 * for both the prompt contract and constrained decoding.
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

type JsonSchemaProp = {
  type?: string;
  enum?: readonly string[];
  items?: { type?: string; properties?: Record<string, JsonSchemaProp> };
  minimum?: number;
  maximum?: number;
};

type JsonSchemaObject = {
  type: "object";
  properties: Record<string, JsonSchemaProp>;
  required: readonly string[];
  additionalProperties: false;
};

/**
 * JSON Schema mirror of `MemoryWriteProposalSchema`, derived straight from
 * the zod schema via zod-to-json-schema (flattened — no `$ref` wrappers) so
 * it cannot drift the way a hand-written mirror can. Used both embedded in
 * `ModelIntentPacketJsonSchema.memoryWrites` (action_intent's inline memory
 * writes) and standalone by any reasoning-only surface that proposes memory
 * consolidations on its own (e.g. background_reflection).
 */
export const MemoryWriteProposalJsonSchema = zodToJsonSchema(MemoryWriteProposalSchema, {
  $refStrategy: "none",
}) as JsonSchemaObject;

/**
 * JSON Schema mirror of the packet, used for constrained decoding
 * (Ollama `format` object / OpenAI `response_format.json_schema`). Derived
 * straight from `ModelIntentPacketSchema` via zod-to-json-schema, so the zod
 * schema stays the single source of truth for both the prompt contract and
 * the decode-time grammar.
 */
export const ModelIntentPacketJsonSchema = zodToJsonSchema(ModelIntentPacketSchema, {
  $refStrategy: "none",
}) as JsonSchemaObject;

function describePacketFieldType(def: JsonSchemaProp): string {
  if (def.enum) return `one of: ${def.enum.join(", ")}`;
  if (def.type === "array") {
    const items = def.items;
    if (items?.type === "object" && items.properties) {
      // Recurse one level: a bare key list (e.g. "memoryWrites: array of
      // objects (type, confidence, ...)") never told the model that "type"
      // is an enum or that "confidence" must be a number — it just guessed,
      // and every guess (e.g. type: "observation") failed schema validation
      // and silently degraded a real turn into a no_op. See
      // intent-packet-field-contract.test.ts for the live-run evidence.
      const nested = Object.entries(items.properties)
        .map(([key, prop]) => `${key}: ${describePacketFieldType(prop)}`)
        .join("; ");
      return `array of objects (${nested})`;
    }
    return "array of strings";
  }
  if (def.type === "number") {
    return def.minimum !== undefined && def.maximum !== undefined
      ? `number (${def.minimum}-${def.maximum})`
      : "number";
  }
  if (def.type === "boolean") return "boolean";
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
 * Same per-field guidance as `modelIntentPacketFieldContract`, scoped to a
 * single memory-write proposal — for surfaces (like background_reflection)
 * that emit `MemoryWriteProposal` objects directly rather than embedded in
 * an intent packet.
 */
export function memoryWriteProposalFieldContract(): string[] {
  const { properties, required } = MemoryWriteProposalJsonSchema;
  return Object.entries(properties).map(([name, def]) => {
    const isRequired = (required as readonly string[]).includes(name);
    return `"${name}" (${isRequired ? "required" : "optional"}): ${describePacketFieldType(def as JsonSchemaProp)}`;
  });
}

/**
 * Primary intent types the engine assigns an automatic `no_op` fallback to
 * when denied. Deliberately single-target: the engine has no way to judge
 * which softer alternative fits a specific denial reason the way a model
 * could, so it always falls back to the one universally-available,
 * never-blocked action (see `computeAvailableActions`) instead of guessing.
 * Types left out (no_op, delay_response, leave_channel, typing_start/cancel,
 * write_memory) are already low-risk or already unblockable — no fallback
 * safety net is needed for them.
 */
const ENGINE_FALLBACK_ELIGIBLE_TYPES: ReadonlySet<IntentType> = new Set([
  "send_message",
  "reply_to_message",
  "react",
  "create_channel",
  "invite_agent",
]);

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
    fallbackIfBlocked: ENGINE_FALLBACK_ELIGIBLE_TYPES.has(packet.intentType) ? "no_op" : undefined,
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
