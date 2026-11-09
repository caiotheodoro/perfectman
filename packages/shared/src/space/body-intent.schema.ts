import { z } from "zod";
import { ACT_VERBS } from "./act-verbs.js";

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
 * The drama `act` key (act-contract.md 11.5): a verb the model proposes, with the per-render handle of its
 * target and an optional intensity. Shape only: whether the verb needs a target, has one it must not have,
 * or names a `p#` person is the validator's call (it drops the `act` alone and keeps the rest of the block).
 * The director then approves or vetoes; the model never starts an act by itself.
 */
export const BodyActSchema = z
  .object({
    verb: z.enum(ACT_VERBS),
    target: BodyRefSchema.optional(),
    intensity: z.number().min(0).max(1).optional(),
  })
  .strict();

/** The block as every run without drama has always seen it: the model-facing views are built from this one. */
const BodyIntentBaseSchema = z
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

/**
 * The optional `body` block of the model's intent packet (ADR-0019,
 * docs/embodiment.md 6.1). Strict: an unknown key rejects the block, and the
 * parser then drops the block, never the speech half of the intent. `act`
 * excludes `gesture` and `posture` (act-contract.md 11.5): a block with both is
 * rejected whole, never the speech half.
 */
export const BodyIntentSchema = BodyIntentBaseSchema.extend({ act: BodyActSchema.optional() })
  .strict()
  .superRefine((body, ctx) => {
    if (body.act && body.gesture) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gesture"], message: "act excludes gesture" });
    if (body.act && body.posture) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["posture"], message: "act excludes posture" });
  });

/** `BodyIntentSchema` without `act`: what a run without drama asks the model for (byte-identical prompts and decode grammar). */
export const BodyIntentWithoutActSchema = BodyIntentBaseSchema;

export type BodyIntent = z.infer<typeof BodyIntentSchema>;
export type BodyAct = z.infer<typeof BodyActSchema>;
