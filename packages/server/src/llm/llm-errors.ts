export class LlmError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
    this.name = "LlmError";
  }
}

export class LlmConfigurationError extends LlmError {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigurationError";
  }
}

export class LlmTimeoutError extends LlmError {
  constructor(message: string) {
    super(message);
    this.name = "LlmTimeoutError";
  }
}

export class LlmHttpError extends LlmError {
  constructor(public readonly status: number, message: string) {
    super(`HTTP ${status}: ${message}`);
    this.name = "LlmHttpError";
  }
}

export class LlmResponseError extends LlmError {
  constructor(message: string) {
    super(message);
    this.name = "LlmResponseError";
  }
}
