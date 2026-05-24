export type DiscordErrorKind =
  | "rate_limited"
  | "missing_permission"
  | "invalid_auth"
  | "not_found"
  | "transient"
  | "validation"
  | "unknown";

export type ClassifiedDiscordError = {
  kind: DiscordErrorKind;
  retryAt?: number;
  status?: number;
  message: string;
};

export function classifyDiscordError(
  error: unknown,
  now: number = Date.now(),
): ClassifiedDiscordError {
  if (error instanceof Error) {
    const anyErr = error as unknown as Record<string, unknown>;
    const status =
      typeof anyErr.status === "number"
        ? anyErr.status
        : typeof anyErr.httpStatus === "number"
          ? anyErr.httpStatus
          : undefined;

    if (status === 429) {
      const retryAfterSec =
        typeof anyErr.retry_after === "number"
          ? anyErr.retry_after
          : typeof anyErr.retryAfter === "number"
            ? anyErr.retryAfter
            : 5;
      return {
        kind: "rate_limited",
        retryAt: now + retryAfterSec * 1000,
        status,
        message: error.message,
      };
    }

    if (status === 401) {
      return { kind: "invalid_auth", status, message: error.message };
    }

    if (status === 403) {
      return { kind: "missing_permission", status, message: error.message };
    }

    if (status === 404) {
      return { kind: "not_found", status, message: error.message };
    }

    if (status !== undefined && status >= 500) {
      return { kind: "transient", status, message: error.message };
    }

    if (error.message.includes("ECONNRESET") || error.message.includes("ETIMEDOUT")) {
      return { kind: "transient", message: error.message };
    }

    return { kind: "unknown", status, message: error.message };
  }

  return { kind: "unknown", message: String(error) };
}

export function isRetryable(classified: ClassifiedDiscordError): boolean {
  return classified.kind === "rate_limited" || classified.kind === "transient";
}
