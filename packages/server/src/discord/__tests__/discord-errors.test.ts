import { describe, it, expect } from "vitest";
import { classifyDiscordError, isRetryable } from "../discord-errors.js";

describe("classifyDiscordError", () => {
  const now = 1_000_000;

  it("classifies 429 as rate_limited with retryAt", () => {
    const err = Object.assign(new Error("rate limited"), { status: 429, retry_after: 3 });
    const result = classifyDiscordError(err, now);
    expect(result.kind).toBe("rate_limited");
    expect(result.retryAt).toBe(now + 3000);
  });

  it("defaults retryAfter to 5s when missing", () => {
    const err = Object.assign(new Error("rate limited"), { status: 429 });
    const result = classifyDiscordError(err, now);
    expect(result.retryAt).toBe(now + 5000);
  });

  it("classifies 401 as invalid_auth", () => {
    const err = Object.assign(new Error("bad token"), { status: 401 });
    expect(classifyDiscordError(err, now).kind).toBe("invalid_auth");
  });

  it("classifies 403 as missing_permission", () => {
    const err = Object.assign(new Error("forbidden"), { status: 403 });
    expect(classifyDiscordError(err, now).kind).toBe("missing_permission");
  });

  it("classifies 404 as not_found", () => {
    const err = Object.assign(new Error("not found"), { status: 404 });
    expect(classifyDiscordError(err, now).kind).toBe("not_found");
  });

  it("classifies 5xx as transient", () => {
    const err = Object.assign(new Error("server err"), { status: 502 });
    expect(classifyDiscordError(err, now).kind).toBe("transient");
  });

  it("classifies ECONNRESET as transient", () => {
    const err = new Error("read ECONNRESET");
    expect(classifyDiscordError(err, now).kind).toBe("transient");
  });

  it("classifies ETIMEDOUT as transient", () => {
    const err = new Error("connect ETIMEDOUT");
    expect(classifyDiscordError(err, now).kind).toBe("transient");
  });

  it("classifies unknown errors", () => {
    expect(classifyDiscordError(new Error("wat"), now).kind).toBe("unknown");
    expect(classifyDiscordError("string err", now).kind).toBe("unknown");
  });
});

describe("isRetryable", () => {
  it("rate_limited is retryable", () => {
    expect(isRetryable({ kind: "rate_limited", message: "" })).toBe(true);
  });

  it("transient is retryable", () => {
    expect(isRetryable({ kind: "transient", message: "" })).toBe(true);
  });

  it("invalid_auth is not retryable", () => {
    expect(isRetryable({ kind: "invalid_auth", message: "" })).toBe(false);
  });

  it("missing_permission is not retryable", () => {
    expect(isRetryable({ kind: "missing_permission", message: "" })).toBe(false);
  });
});
