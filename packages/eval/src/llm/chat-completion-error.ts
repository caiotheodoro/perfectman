/**
 * Label-scoped chat-completion surface for the judge/narrator path, backed
 * by the server's SDK transport.
 *
 * The hand-rolled fetch in `chat-completion.ts` was a second implementation
 * of the same OpenAI-compatible protocol the server providers own. This
 * module keeps the parts of that contract that are eval-specific — the
 * caller's `label` prefix on transport errors and the raw-content return —
 * and delegates the transport itself to the SDK-backed path exported by
 * `@perfectman/server`, the only package allowed to depend on the AI SDKs.
 */
import { generateOpenAiCompatibleIntent } from "@perfectman/server";
import type { BuiltPrompt, LLMConfig, LlmTransportDeps } from "@perfectman/server";
import { LLMResponseError } from "@perfectman/server";

export type ChatCompletionMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionOptions = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Caller label used as the error prefix, e.g. "LLM judge". */
  label: string;
  messages: ChatCompletionMessage[];
  temperature?: number;
  maxTokens: number;
  responseFormatJson?: boolean;
  timeoutMs?: number;
};

export class ChatCompletionError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ChatCompletionError";
    this.cause = cause;
  }
}

// The judge/narrator configs resolve secrets to VALUES, while the server
// seam resolves them by env NAME (the agent pattern). Bridge that by
// injecting the value into a private env slot that only this call reads
// back — the sentinel never touches the surrounding process.env.
const API_KEY_SENTINEL = "__PERFECTMAN_EVAL_SHARED_KEY__";

function buildPrompt(messages: ChatCompletionMessage[]): BuiltPrompt {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const user = messages
    .filter((m) => m.role !== "system")
    .map((m) => m.content)
    .join("\n");
  return {
    system,
    user,
    inputTokensEstimate: 0,
    // The transport reads only system/user/inputTokensEstimate; the
    // remaining fields are agent-prompt identity stamps, inert here.
    purpose: "action_intent",
    version: "eval-chat-v1",
    templateVersion: "eval-chat-v1",
  };
}

/** Resolves to the raw assistant content ("" when the model sent none). */
export async function chatCompletion(opts: ChatCompletionOptions): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 60000;
  const config: LLMConfig = {
    // Any OpenAI-compatible endpoint; the transport never reads
    // providerType, so a plain union member is the placeholder.
    providerType: "openai-compatible",
    baseUrl: opts.baseUrl,
    apiKeyEnv: opts.apiKey ? API_KEY_SENTINEL : undefined,
    modelName: opts.model,
    maxInputTokens: 0,
    maxOutputTokens: opts.maxTokens,
    temperature: opts.temperature ?? 0,
    timeoutMs,
    // The judge/narrator plan their own retries (llmJudge retries with a
    // stricter system suffix); the transport itself is single-shot.
    retryCount: 0,
    responseFormatJson: opts.responseFormatJson ?? false,
    // Never schema-constrained: these callers parse raw text themselves
    // (extractJsonObject) and need the plain json_object form only.
    responseFormatJsonSchema: false,
  };

  const deps: LlmTransportDeps = opts.apiKey ? { env: { [API_KEY_SENTINEL]: opts.apiKey } } : {};

  try {
    const result = await generateOpenAiCompatibleIntent(config, buildPrompt(opts.messages), Date.now(), deps);
    return result.content;
  } catch (error) {
    if (error instanceof LLMResponseError) {
      // The seam reports missing content as a typed error; the old
      // primitive resolved "" instead — keep the caller contract.
      return "";
    }
    // LLMHttpError already carries "HTTP <status>: <message>", so the
    // label prefix reproduces the old "caller HTTP 500: boom" wording.
    throw new ChatCompletionError(
      `${opts.label} ${error instanceof Error ? error.message : "unknown transport error"}`,
      error instanceof Error ? error : undefined,
    );
  }
}