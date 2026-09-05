import { z } from "zod";

export const JudgeProviderTypeSchema = z.enum([
  "openai-compatible",
  "rule",
  "mock",
]);

function isSecretsField(key: string): boolean {
  return key === "apiKey" || key === "token" || key === "botToken";
}

// Shared shape; each exported schema adds its own superRefine checks AFTER
// extend (extend only exists on ZodObject, not on a superRefined ZodEffects).
const judgeConfigObject = z
  .object({
    providerType: JudgeProviderTypeSchema,
    baseUrl: z.string().min(1).optional(),
    modelName: z.string().min(1),
    apiKeyEnv: z.string().min(1).optional(),
    temperature: z.number().optional(),
    timeoutMs: z.number().int().positive().optional(),
    /** Output budget for one judge call; reasoning models without a thinking switch need headroom. */
    maxTokens: z.number().int().positive().optional(),
    retryCount: z.number().int().nonnegative().optional(),
    responseFormatJson: z.boolean().optional(),
  })
  // passthrough so a future superset field (extraBody, headers) never makes
  // an old config unreadable; secrets are still rejected loudly instead of
  // silently stripped. Unconsumed/unknown keys are surfaced by the eval
  // loader's warn pass, not by rejecting the file.
  .passthrough();

function rejectInlineSecrets(
  value: Record<string, unknown>,
  ctx: z.RefinementCtx,
): void {
  // Same guard as the agent LLM section (parseLLMConfig): secrets must be
  // referenced by env field NAME, never inlined in the config file.
  for (const key of Object.keys(value)) {
    if (isSecretsField(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `${key} must not be defined — reference secrets through env field names only (use apiKeyEnv)`,
      });
    }
  }
}

export const JudgeConfigBaseSchema = judgeConfigObject.superRefine(rejectInlineSecrets);

export const JudgeEntryConfigSchema = judgeConfigObject
  .extend({ label: z.string().min(1).optional() })
  .superRefine(rejectInlineSecrets);

/**
 * The `judge` section. Refinements mirror the runtime guards in eval's
 * `juryJudge` so a misconfigured file dies at parse time, not mid-bench:
 *  - duplicate labels — including entries that only collide after the
 *    runtime's `label ?? judge-N` defaulting;
 *  - duplicate (baseUrl, modelName) endpoints — a jury must be
 *    independently sourced. The mirror is endpoint-level: entries that
 *    omit baseUrl (resolved from env at load time) can only be caught by
 *    the runtime guard. Family diversity (#77's underlying requirement)
 *    is still not expressible — two different families from one proxy
 *    baseUrl are legal, and two same-family endpoints are not.
 */
export const JudgeAppConfigSchema = judgeConfigObject
  .extend({ jury: z.array(JudgeEntryConfigSchema).optional() })
  .superRefine(rejectInlineSecrets)
  .superRefine((config, ctx) => {
    const labels = (config.jury ?? []).map((j, i) => j.label ?? `judge-${i}`);
    const duplicates = labels.filter((label, i) => labels.indexOf(label) !== i);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate jury judge labels: ${[...new Set(duplicates)].join(", ")}`,
      });
    }
  })
  .superRefine((config, ctx) => {
    const endpointOwner = new Map<string, string>();
    (config.jury ?? []).forEach((entry, i) => {
      if (entry.baseUrl === undefined) return;
      const label = entry.label ?? `judge-${i}`;
      const key = `${entry.baseUrl}|${entry.modelName}`;
      const owner = endpointOwner.get(key);
      if (owner !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `Duplicate jury judge endpoint (${entry.baseUrl}, ${entry.modelName}) on labels "${owner}" and "${label}" — a jury must be independently sourced`,
        });
      }
      endpointOwner.set(key, label);
    });
  });
