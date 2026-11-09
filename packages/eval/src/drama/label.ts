/**
 * One human (or judge) label for one clip: a 1-5 score per drama axis, the
 * failure codes that apply, and a pass/fail. This is the unit the agreement
 * statistics in `kappa.ts` compare.
 */
import { z } from "zod";
import { DRAMA_AXES, type DramaAxis } from "./axes.js";

const axisScoreSchema = z
  .object({
    /** 1..5, or null when the axis does not apply to this clip (never a default 3). */
    score: z.number().int().min(1).max(5).nullable(),
    note: z.string().optional(),
  })
  .strict();

const scoresShape = Object.fromEntries(DRAMA_AXES.map((a) => [a, axisScoreSchema])) as Record<DramaAxis, typeof axisScoreSchema>;

/** `D1`..`D7` plus any catalog code from the wider failure catalog (`E10`, `T3`), kept as free strings. */
export const FAILURE_CODE_PATTERN = /^[A-Z]\d+$/;

export const clipLabelSchema = z
  .object({
    clipId: z.string().min(1),
    labeler: z.string().min(1),
    labeledAt: z.string().datetime({ offset: true }),
    scores: z.object(scoresShape).strict(),
    failureCodes: z.array(z.string().regex(FAILURE_CODE_PATTERN)),
    pass: z.boolean(),
    notes: z.string().optional(),
  })
  .strict();

export type AxisScore = { score: number | null; note?: string };

export type ClipLabel = {
  clipId: string;
  labeler: string;
  /** ISO 8601 timestamp. */
  labeledAt: string;
  scores: Record<DramaAxis, AxisScore>;
  failureCodes: string[];
  pass: boolean;
  notes?: string;
};

/** Parses a label from an object or its JSON text. Throws `ZodError` on a bad shape, `Error` on bad JSON. */
export function parseClipLabel(input: unknown): ClipLabel {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error("clip label is not valid JSON");
    }
  }
  return clipLabelSchema.parse(value) as ClipLabel;
}

/** One-line JSON with a fixed key order (for JSONL files that diff cleanly). Validates first. */
export function serializeClipLabel(label: ClipLabel): string {
  const l = clipLabelSchema.parse(label) as ClipLabel;
  const scores = Object.fromEntries(
    DRAMA_AXES.map((axis) => {
      const s = l.scores[axis];
      return [axis, { score: s.score, ...(s.note !== undefined ? { note: s.note } : {}) }];
    }),
  );
  return JSON.stringify({
    clipId: l.clipId,
    labeler: l.labeler,
    labeledAt: l.labeledAt,
    scores,
    failureCodes: l.failureCodes,
    pass: l.pass,
    ...(l.notes !== undefined ? { notes: l.notes } : {}),
  });
}
