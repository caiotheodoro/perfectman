import { describe, it, expect, vi } from "vitest";
import { DiscordRateLimiter, type OutboundDiscordMessage } from "../discord-rate-limiter.js";

function makeMsg(
  overrides: Partial<OutboundDiscordMessage> = {},
): OutboundDiscordMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 6)}`,
    agentId: "alice",
    discordChannelId: "dc-1",
    payload: { content: "hello", allowedMentions: { parse: [] } },
    salience: "medium",
    attempts: 0,
    notBefore: 0,
    createdAt: 0,
    ...overrides,
  };
}

describe("DiscordRateLimiter", () => {
  it("delivers in FIFO order", async () => {
    const limiter = new DiscordRateLimiter();
    const order: string[] = [];
    limiter.enqueue(makeMsg({ id: "a", payload: { content: "first", allowedMentions: { parse: [] } } }));
    limiter.enqueue(makeMsg({ id: "b", payload: { content: "second", allowedMentions: { parse: [] } } }));

    const sendFn = vi.fn(async (_ch: string, payload: { content: string }) => {
      order.push(payload.content);
      return { id: "sent" };
    });

    await limiter.flush("alice:dc-1", sendFn);
    expect(order).toEqual(["first", "second"]);
  });

  it("drops low salience when queue full", () => {
    const limiter = new DiscordRateLimiter({ maxQueueDepth: 2 });
    limiter.enqueue(makeMsg({ id: "a", salience: "medium" }));
    limiter.enqueue(makeMsg({ id: "b", salience: "medium" }));
    const accepted = limiter.enqueue(makeMsg({ id: "c", salience: "low" }));
    expect(accepted).toBe(false);
    expect(limiter.queueDepth("alice:dc-1")).toBe(2);
  });

  it("never drops high/critical salience", () => {
    const limiter = new DiscordRateLimiter({ maxQueueDepth: 2 });
    limiter.enqueue(makeMsg({ id: "a", salience: "low" }));
    limiter.enqueue(makeMsg({ id: "b", salience: "medium" }));

    const accepted = limiter.enqueue(makeMsg({ id: "c", salience: "high" }));
    expect(accepted).toBe(true);
    expect(limiter.queueDepth("alice:dc-1")).toBe(2);
  });

  it("rate_limited sets notBefore", async () => {
    let time = 1000;
    const limiter = new DiscordRateLimiter({}, () => time);
    limiter.enqueue(makeMsg({ id: "a" }));

    const sendFn = vi.fn(async () => {
      throw Object.assign(new Error("rate limited"), {
        status: 429,
        retry_after: 5,
      });
    });

    await limiter.flush("alice:dc-1", sendFn);
    expect(limiter.queueDepth("alice:dc-1")).toBe(1);

    time = 6001;
    const okSend = vi.fn(async () => ({ id: "ok" }));
    await limiter.flush("alice:dc-1", okSend);
    expect(okSend).toHaveBeenCalled();
    expect(limiter.queueDepth("alice:dc-1")).toBe(0);
  });

  it("missing_permission calls onError and removes", async () => {
    const limiter = new DiscordRateLimiter();
    limiter.enqueue(makeMsg({ id: "a" }));

    const sendFn = vi.fn(async () => {
      throw Object.assign(new Error("forbidden"), { status: 403 });
    });
    const onError = vi.fn();

    await limiter.flush("alice:dc-1", sendFn, onError);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][1].kind).toBe("missing_permission");
    expect(limiter.queueDepth("alice:dc-1")).toBe(0);
  });

  it("transient retries with backoff, then drops after maxAttempts", async () => {
    let time = 1000;
    const limiter = new DiscordRateLimiter(
      { maxAttempts: 2, baseBackoffMs: 100, maxBackoffMs: 10000 },
      () => time,
    );
    limiter.enqueue(makeMsg({ id: "a" }));

    const sendFn = vi.fn(async () => {
      throw Object.assign(new Error("server error"), { status: 500 });
    });
    const onError = vi.fn();

    await limiter.flush("alice:dc-1", sendFn, onError);
    expect(onError).not.toHaveBeenCalled();
    expect(limiter.queueDepth("alice:dc-1")).toBe(1);

    time = 2000;
    await limiter.flush("alice:dc-1", sendFn, onError);
    expect(onError).toHaveBeenCalledOnce();
    expect(limiter.queueDepth("alice:dc-1")).toBe(0);
  });

  it("skips messages with notBefore > now", async () => {
    let time = 1000;
    const limiter = new DiscordRateLimiter({}, () => time);
    limiter.enqueue(makeMsg({ id: "a", notBefore: 5000 }));

    const sendFn = vi.fn(async () => ({ id: "ok" }));
    await limiter.flush("alice:dc-1", sendFn);
    expect(sendFn).not.toHaveBeenCalled();
  });

  it("flushAll processes all keys", async () => {
    const limiter = new DiscordRateLimiter();
    limiter.enqueue(makeMsg({ agentId: "alice", discordChannelId: "dc-1" }));
    limiter.enqueue(makeMsg({ agentId: "bob", discordChannelId: "dc-2" }));

    const sendFn = vi.fn(async () => ({ id: "ok" }));
    await limiter.flushAll(() => sendFn);
    expect(sendFn).toHaveBeenCalledTimes(2);
    expect(limiter.allKeys()).toHaveLength(0);
  });
});
