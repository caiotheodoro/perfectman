import { z } from "zod";

/** Per-render handle: `p#` person, `z#` place, `f#` furniture, `r#` room. */
export const BodyRefSchema = z
  .string()
  .regex(/^[pzfr]\d+$/)
  .describe("handle from the Body block, e.g. p1, z2, f3, r1");

export const BodyMoveSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("approach"),
    target: BodyRefSchema,
    band: z.enum(["intimate", "personal", "social"]).default("personal"),
  }),
  z.object({ kind: z.literal("go_to"), place: BodyRefSchema }),
  z.object({ kind: z.literal("follow"), target: BodyRefSchema }),
  z.object({
    kind: z.literal("keep_distance"),
    target: BodyRefSchema,
    min: z.number().int().min(2).max(10).default(4),
  }),
  z.object({ kind: z.literal("leave"), to: BodyRefSchema.optional() }),
  z.object({ kind: z.literal("stay") }),
]);

export const BODY_EXPRESSIONS = ["neutral", "smile", "angry", "sad", "surprised", "sleepy"] as const;
export const BODY_GESTURES = ["wave", "kiss", "laugh", "thumbs", "dance", "sign", "stop"] as const;
export const BODY_ORDERS = ["move_then_speak", "speak_then_move", "together"] as const;

/**
 * The optional `body` block of the model's intent packet (ADR-0019,
 * docs/embodiment.md 6.1). Strict: an unknown key rejects the block, and the
 * parser then drops the block, never the speech half of the intent.
 */
export const BodyIntentSchema = z
  .object({
    move: BodyMoveSchema.optional(),
    posture: z.object({ pose: z.enum(["stand", "sit", "lay"]), at: BodyRefSchema.optional() }).optional(),
    gesture: z
      .object({
        kind: z.enum(BODY_GESTURES),
        style: z.number().int().min(0).max(17).optional(),
        toward: BodyRefSchema.optional(),
      })
      .optional(),
    expression: z.enum(BODY_EXPRESSIONS).optional(),
    face: BodyRefSchema.optional(),
    order: z.enum(BODY_ORDERS).default("move_then_speak"),
  })
  .strict();

export type BodyIntent = z.infer<typeof BodyIntentSchema>;
