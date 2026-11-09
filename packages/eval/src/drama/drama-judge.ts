/**
 * Drama judge: scores one clip (contact sheets + event timeline + transcript)
 * on the six drama axes and returns a `ClipLabel` labeled `judge:<model>`.
 *
 * Same shape as the hotel judge: the model is told the logs are data, the reply
 * is validated, and one malformed reply gets one retry with a stricter system
 * message. What differs:
 *  - images go with the user turn (see `DramaJudgeProvider`);
 *  - separation: the judge model may not be any actor model (self-preference);
 *  - one clip per call, temperature 0, never a pair (position bias);
 *  - a bad reply after the retry throws `DramaJudgeReplyError` instead of
 *    returning a placeholder label, so a calibration run cannot average in a made-up score.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { ChatCompletionImage } from "../llm/chat-completion-error.js";
import { DRAMA_AXES, DRAMA_FAILURE_CODES, type DramaAxis } from "./axes.js";
import { buildDramaJudgePrompt, type DramaPromptInput } from "./judge-prompt.js";
import { parseClipLabel, type ClipLabel } from "./label.js";

export type DramaJudgeRequest = {
  system: string;
  user: string;
  /** Sent after `user`, in order; `user` refers to them as Image 1, Image 2, ... */
  images: readonly ChatCompletionImage[];
  /** Always 0: the same input must give the same prompt and, as far as the model allows, the same answer. */
  temperature: 0;
  maxTokens: number;
};

/**
 * A reply: the text, or the text with the endpoint's `finish_reason`. `"length"` means the model hit
 * `maxTokens` and the text is cut off.
 */
export type DramaJudgeCompletion = string | { content: string; finishReason?: string };

/** A vision model behind some transport. Tests use fakes; the CLI uses `createChatCompletionProvider`. */
export type DramaJudgeProvider = {
  model: string;
  /** Token limit for a call when the caller gives none (the CLI's `DRAMA_JUDGE_MAX_TOKENS`). */
  maxTokens?: number;
  complete(request: DramaJudgeRequest): Promise<DramaJudgeCompletion>;
};

export type JudgeDramaClipInput = DramaPromptInput & {
  provider: DramaJudgeProvider;
  /** Model ids the actors ran on. The judge refuses to run when its own id is one of them. */
  actorModels?: readonly string[];
  /** ISO 8601; default now. */
  labeledAt?: string;
  maxTokens?: number;
};

export class JudgeSeparationError extends Error {
  constructor(readonly model: string) {
    super(`judge model "${model}" is also an actor model; a judge must be a different model from the actors it grades`);
    this.name = "JudgeSeparationError";
  }
}

export class DramaJudgeReplyError extends Error {
  constructor(
    readonly reason: string,
    readonly attempts: number,
    /** The last reply, cut to 2000 characters. */
    readonly raw: string,
  ) {
    super(`drama judge reply was not usable after ${attempts} attempts: ${reason}`);
    this.name = "DramaJudgeReplyError";
  }
}

const normalizeModel = (id: string): string => id.trim().toLowerCase();

export function assertJudgeSeparation(judgeModel: string, actorModels: readonly string[]): void {
  const judge = normalizeModel(judgeModel);
  if (actorModels.some((m) => normalizeModel(m) === judge)) throw new JudgeSeparationError(judgeModel);
}

const KNOWN_FAILURE_IDS: readonly string[] = DRAMA_FAILURE_CODES.map((c) => c.id);

const axisReplySchema = z.object({
  score: z.number().int().min(1).max(5).nullable(),
  evidence: z.string().optional(),
});

const replySchema = z.object({
  scores: z.object(Object.fromEntries(DRAMA_AXES.map((a) => [a, axisReplySchema])) as Record<DramaAxis, typeof axisReplySchema>),
  failureCodes: z.array(z.string().refine((id) => KNOWN_FAILURE_IDS.includes(id), "unknown failure code")),
  pass: z.boolean(),
  notes: z.string().optional(),
});

type DramaReply = z.infer<typeof replySchema>;

const TIMESTAMP = /\b\d+(?:\.\d+)?\s?s\b|\bt\+\d+|\b\d+:\d{2}\b|#\d+|\bframe\s*\d+/i;
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function cites(evidence: string, actIds: readonly string[]): boolean {
  return TIMESTAMP.test(evidence) || actIds.some((id) => new RegExp(`(?<![\\w-])${escapeRegExp(id)}(?![\\w-])`).test(evidence));
}

/** Strips think blocks and code fences, then reads the outermost object. Throws with the reason on anything unusable. */
function parseReply(raw: string, actIds: readonly string[]): DramaReply {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("no JSON object in the reply");
  let json: unknown;
  try {
    json = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error("the reply is not valid JSON");
  }
  const parsed = replySchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".") || "reply"}: ${i.message}`).join("; "));
  }
  const reply = parsed.data;
  for (const axis of DRAMA_AXES) {
    const { score, evidence } = reply.scores[axis];
    if (score !== null && !(evidence !== undefined && cites(evidence, actIds))) {
      throw new Error(`scores.${axis}: a scored axis needs evidence that cites a timestamp, an act_id or a frame number`);
    }
  }
  return reply;
}

function toLabel(reply: DramaReply, clipId: string, model: string, labeledAt: string): ClipLabel {
  const scores = Object.fromEntries(
    DRAMA_AXES.map((axis) => {
      const { score, evidence } = reply.scores[axis];
      return [axis, { score, ...(evidence !== undefined && evidence.trim() !== "" ? { note: evidence.trim() } : {}) }];
    }),
  );
  return parseClipLabel({
    clipId,
    labeler: `judge:${model}`,
    labeledAt,
    scores,
    failureCodes: [...new Set(reply.failureCodes)].sort(),
    pass: reply.pass,
    ...(reply.notes !== undefined && reply.notes.trim() !== "" ? { notes: reply.notes.trim() } : {}),
  });
}

const strictSuffix = (reason: string, truncated: boolean): string =>
  `\n\nYour previous reply was not valid: ${reason.slice(0, 300)}.${truncated ? " Keep every evidence sentence short." : ""} Reply with the JSON object only, starting with { and ending with }. Include all six axes; each score is an integer 1-5 or null, and every scored axis has an evidence string that cites a clip timestamp, an act_id or a frame number.`;

/** Six axes, each with an evidence sentence of up to a few hundred characters, plus codes and notes: well over 900 tokens at worst. */
export const DEFAULT_DRAMA_JUDGE_MAX_TOKENS = 2500;
/** The retry after a cut-off reply doubles the limit up to this. */
const TRUNCATION_RETRY_CAP = 8000;

/**
 * Judges one clip. Throws `JudgeSeparationError` before any call when the judge is an actor model, and
 * `DramaJudgeReplyError` when the model cannot produce a valid reply in two attempts. Provider (transport) errors are not caught.
 */
export async function judgeDramaClip(input: JudgeDramaClipInput): Promise<ClipLabel> {
  assertJudgeSeparation(input.provider.model, input.actorModels ?? []);

  const prompt = buildDramaJudgePrompt(input);
  const images: ChatCompletionImage[] = prompt.images.map((ref) => ({ mediaType: ref.mediaType, base64: readFileSync(ref.path).toString("base64") }));
  const actIds = input.events.flatMap((e) => (e.kind === "act_started" ? [e.actId] : []));
  let maxTokens = input.maxTokens ?? input.provider.maxTokens ?? DEFAULT_DRAMA_JUDGE_MAX_TOKENS;

  let reason = "";
  let raw = "";
  let truncated = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    // A reply cut off at the limit gets one retry with a bigger one (twice as much, up to the cap, never below what it had).
    if (attempt === 2 && truncated) maxTokens = Math.max(maxTokens, Math.min(TRUNCATION_RETRY_CAP, maxTokens * 2));
    const reply = await input.provider.complete({
      system: attempt === 1 ? prompt.system : prompt.system + strictSuffix(reason, truncated),
      user: prompt.user,
      images,
      temperature: 0,
      maxTokens,
    });
    raw = typeof reply === "string" ? reply : reply.content;
    const finishReason = typeof reply === "string" ? undefined : reply.finishReason;
    try {
      return toLabel(parseReply(raw, actIds), input.clipId, input.provider.model, input.labeledAt ?? new Date().toISOString());
    } catch (err) {
      truncated = finishReason === "length";
      reason = truncated ? `the judge reply was cut off at ${maxTokens} tokens: raise DRAMA_JUDGE_MAX_TOKENS` : err instanceof Error ? err.message : String(err);
    }
  }
  throw new DramaJudgeReplyError(reason, 2, raw.slice(0, 2000));
}
