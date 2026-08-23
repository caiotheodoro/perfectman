/**
 * Shared OpenAI-compatible chat-completion call — the superset primitive.
 *
 * `judge.ts`'s callJudge/scoreCohesion, `narrator.ts`, and the server's
 * `OpenAiCompatibleProvider` all post to /chat/completions with the same
 * URL shape, Bearer handling, and `choices[0].message.content` parse. This
 * is the one call path; callers keep building their own prompts
 * (PromptSection) and own the response post-processing (axis parsing /
 * JSON extraction / usage accounting).
 *
 * Superset capabilities over the original eval-only extract:
 *  - transport retry (`retryCount`) for transient failures — timeout,
 *    429, 5xx, network errors (mirrors the server provider's isTransient);
 *  - dual timeout: connect via AbortController, body read raced against a
 *    hard deadline (both deadline timers are cleared on settle);
 *  - response-header extraction (lowercased) for routing evidence;
 *  - typed errors aligned with the server's LLMError hierarchy —
 *    `ChatCompletionHttpError` / `ChatCompletionTimeoutError`;
 *  - json_schema response format with an automatic one-shot fallback to
 *    json_object on a 400/422 rejection (does not consume a retry slot,
 *    and is surfaced via `schemaFallbackUsed`).
 *
 * Body precedence contract (pinned by tests): named knobs first, then
 * `extraBody` wins over them — the old provider spread extraBody last —
 * and the response_format block wins over everything.
 */

export type ChatCompletionMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionJsonSchemaFormat = {
  name: string;
  schema: object;
  strict?: boolean;
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
  /** Syntax-only json_object mode. Either this or jsonSchemaFormat enables response_format. */
  responseFormatJson?: boolean;
  /** Shape-constrained json_schema mode. Either this or responseFormatJson enables response_format. */
  jsonSchemaFormat?: ChatCompletionJsonSchemaFormat;
  /** Extra body fields — win over the named knobs (provider parity). */
  extraBody?: Record<string, unknown>;
  timeoutMs?: number;
  /** Transport retries for transient failures; schema-fallback retries are free. */
  retryCount?: number;
};

export type ChatCompletionResult = {
  /** Raw assistant content ("" when the model sent none). */
  content: string;
  /** Response headers, lowercased (x-routed-model, x-fallback-attempts, ...). */
  responseHeaders: Record<string, string>;
  /** The parsed response body — callers own post-processing. */
  data: {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  /** Total HTTP attempts — mirrors the provider's budget arithmetic: the schema-fallback retry does not increment it. */
  attemptCount: number;
  /** True when a 400/422 forced the json_schema → json_object fallback. */
  schemaFallbackUsed: boolean;
};

export class ChatCompletionError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ChatCompletionError";
    this.cause = cause;
  }
}

export class ChatCompletionTimeoutError extends ChatCompletionError {
  constructor(message: string) {
    super(message);
    this.name = "ChatCompletionTimeoutError";
  }
}

export class ChatCompletionHttpError extends ChatCompletionError {
  constructor(
    public readonly status: number,
    message: string,
    /** The response body text, for callers that wrap errors at their boundary. */
    public readonly bodyText: string,
  ) {
    super(message);
    this.name = "ChatCompletionHttpError";
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function isTransient(error: unknown): boolean {
  return (
    error instanceof ChatCompletionTimeoutError ||
    (error instanceof ChatCompletionHttpError &&
      (error.status === 429 || error.status >= 500)) ||
    !(error instanceof ChatCompletionError)
  );
}

/**
 * Race a promise against a hard deadline, clearing the deadline timer on
 * EVERY settle — a bare setTimeout that survives resolution holds the
 * process alive for its full duration, and eval CLIs would sit idle up to
 * timeoutMs after their last LLM call.
 */
function raceWithDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ChatCompletionTimeoutError(timeoutMessage)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** One OpenAI-compatible /chat/completions call (see module header). */
export async function chatCompletion(
  opts: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  const timeoutMs = opts.timeoutMs ?? 60000;
  const url = `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens,
  };
  if (opts.temperature !== undefined) body["temperature"] = opts.temperature;
  // Provider parity: the old OpenAiCompatibleProvider spread extraBody
  // last, so a configured extraBody.temperature/... override wins over the
  // named knobs. The response_format block (below) wins over both.
  Object.assign(body, opts.extraBody);

  if (opts.responseFormatJson === true || opts.jsonSchemaFormat !== undefined) {
    body["response_format"] = opts.jsonSchemaFormat
      ? {
          type: "json_schema",
          json_schema: {
            name: opts.jsonSchemaFormat.name,
            schema: opts.jsonSchemaFormat.schema,
            strict: opts.jsonSchemaFormat.strict ?? false,
          },
        }
      : { type: "json_object" };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
  };

  const maxAttempts = (opts.retryCount ?? 0) + 1;
  let attempts = 0;
  let schemaFallbackUsed = false;

  while (attempts < maxAttempts) {
    attempts++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        clearTimeout(timeoutId);
        // The error-body read needs the same deadline coverage — a proxy
        // hanging mid-error-body is the one window with zero timeout
        // otherwise.
        const errorText = await raceWithDeadline(
          response.text(),
          timeoutMs,
          `error body read timed out after ${timeoutMs}ms`,
        ).catch((error) => {
          if (error instanceof ChatCompletionTimeoutError) throw error;
          return "Unknown error";
        });
        // A 400/422 on a json_schema request usually means the proxy does
        // not support schema-constrained decoding — retry once as
        // json_object on the same budget slot, and surface the fallback.
        if (
          (response.status === 400 || response.status === 422) &&
          !schemaFallbackUsed &&
          opts.jsonSchemaFormat
        ) {
          schemaFallbackUsed = true;
          body["response_format"] = { type: "json_object" };
          attempts--;
          continue;
        }
        throw new ChatCompletionHttpError(
          response.status,
          `${opts.label} HTTP ${response.status}: ${errorText}`,
          errorText,
        );
      }

      // The abort timer stays armed through the body read — response.json()
      // can hang on a slow stream after headers arrive, so race the body
      // read against a hard deadline too (the deadline timer is cleared on
      // settle by raceWithDeadline).
      const data = await raceWithDeadline(
        response.json() as Promise<ChatCompletionResult["data"]>,
        timeoutMs,
        `body read timed out after ${timeoutMs}ms`,
      );
      clearTimeout(timeoutId);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      return {
        content: data.choices?.[0]?.message?.content ?? "",
        responseHeaders,
        data,
        attemptCount: attempts,
        schemaFallbackUsed,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      const resolvedError =
        error instanceof ChatCompletionError
          ? error
          : isAbortError(error)
            ? new ChatCompletionTimeoutError(
                `${opts.label} request timed out after ${timeoutMs}ms`,
              )
            : error instanceof Error
              ? error
              : new Error(String(error));

      if (isTransient(resolvedError) && attempts < maxAttempts) {
        continue;
      }
      throw resolvedError;
    }
  }

  throw new ChatCompletionError("Max retries exceeded without resolving error.");
}
