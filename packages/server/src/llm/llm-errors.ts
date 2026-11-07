export class LLMError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
    this.name = "LLMError";
  }
}

export class LLMConfigurationError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "LLMConfigurationError";
  }
}

export class LLMTimeoutError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "LLMTimeoutError";
  }
}

export class LLMHttpError extends LLMError {
  constructor(
    public readonly status: number,
    message: string,
    /** Response headers when the transport had them (lower-cased keys); the governor reads `retry-after`. */
    public readonly headers?: Record<string, string>,
  ) {
    super(`HTTP ${status}: ${message}`);
    this.name = "LLMHttpError";
  }
}

export class LLMResponseError extends LLMError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "LLMResponseError";
  }
}

const TRANSPORT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/**
 * True when an error thrown out of a model call is the provider's or the
 * network's fault (timeout, HTTP, unusable response, socket / DNS failure,
 * fetch abort). A bug in our own code is not, so it never feeds the circuit
 * breaker. A configuration error is ours, too.
 */
export function isProviderTransportError(err: unknown): boolean {
  if (err instanceof LLMConfigurationError) return false;
  if (err instanceof LLMError) return true;
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && TRANSPORT_CODES.has(code)) return true;
  const cause = (err as { cause?: unknown }).cause;
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) return true;
  return cause !== undefined && cause !== err && isProviderTransportError(cause);
}
