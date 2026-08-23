import { z } from "zod";
import type { JudgeConfigBase } from "./judge-config.types.js";

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
    retryCount: z.number().int().nonnegative().optional(),
    responseFormatJson: z.boolean().optional(),
  })
  // passthrough so a future superset field (extraBody, headers) never makes
  // an old config unreadable; secrets are still rejected loudly instead of
  // silently stripped.
  .passthrough();

function rejectInlineSecrets(
  value: JudgeConfigBase & Record<string, unknown>,
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

export const JudgeAppConfigSchema = judgeConfigObject
  .extend({ jury: z.array(JudgeEntryConfigSchema).optional() })
  .superRefine(rejectInlineSecrets)
  .superRefine((config, ctx) => {
    // Mirror of the runtime guard in eval's juryJudge (`Duplicate jury
    // judge labels`) — the file is rejected before any judge ever runs.
    const labels = (config.jury ?? []).map((j) => j.label ?? "");
    const duplicates = labels.filter((label, i) => label !== "" && labels.indexOf(label) !== i);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate jury judge labels: ${[...new Set(duplicates)].join(", ")}`,
      });
    }
  });