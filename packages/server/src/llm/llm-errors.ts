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
  constructor(public readonly status: number, message: string) {
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
