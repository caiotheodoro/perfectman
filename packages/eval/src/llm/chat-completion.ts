/**
 * Shared minimal OpenAI-compatible chat-completion call.
 *
 * `judge.ts`'s callJudge/scoreCohesion and `narrator.ts` each hand-rolled
 * the same POST /chat/completions fetch — same URL shape, same Bearer
 * header handling, same `choices[0].message.content` parse. This is the
 * one call path; callers keep building their own prompts (PromptSection)
 * and own the response post-processing (axis parsing / JSON extraction).
 *
 * Behavior is identical to what each caller did before the extraction:
 * a single request under full-request `AbortSignal.timeout`, and a
 * non-2xx response throws a typed `ChatCompletionError` prefixed with the
 * caller's `label`. The transport-retry / dual-timeout / response-header
 * capabilities that `OpenAiCompatibleProvider` (server) has are the
 * documented seam to adopt next — the provider and these callers can then
 * share this primitive.
 */

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

/** Resolves to the raw assistant content ("" when the model sent none). */
export async function chatCompletion(opts: ChatCompletionOptions): Promise<string> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens,
  };
  if (opts.temperature !== undefined) body["temperature"] = opts.temperature;
  if (opts.responseFormatJson) body["response_format"] = { type: "json_object" };

  const res = await fetch(`${opts.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60000),
  });
  if (!res.ok) {
    throw new ChatCompletionError(`${opts.label} HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}