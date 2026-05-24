import type { EmotionalSalience } from "@perfectman/shared";
import type { DiscordFormattedMessage } from "./discord-formatter.js";
import { classifyDiscordError, isRetryable } from "./discord-errors.js";
import type { ClassifiedDiscordError } from "./discord-errors.js";

export type OutboundDiscordMessage = {
  id: string;
  agentId: string;
  discordChannelId: string;
  payload: DiscordFormattedMessage;
  salience: EmotionalSalience;
  attempts: number;
  notBefore: number;
  createdAt: number;
};

export type DiscordSendFn = (
  channelId: string,
  payload: DiscordFormattedMessage,
) => Promise<{ id: string }>;

export type RateLimiterConfig = {
  maxQueueDepth: number;
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
};

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxQueueDepth: 20,
  maxAttempts: 3,
  baseBackoffMs: 1000,
  maxBackoffMs: 30_000,
};

export class DiscordRateLimiter {
  private readonly queues = new Map<string, OutboundDiscordMessage[]>();
  private readonly config: RateLimiterConfig;
  private readonly now: () => number;

  constructor(config?: Partial<RateLimiterConfig>, now?: () => number) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.now = now ?? (() => Date.now());
  }

  enqueue(msg: OutboundDiscordMessage): boolean {
    const key = `${msg.agentId}:${msg.discordChannelId}`;
    let queue = this.queues.get(key);
    if (!queue) {
      queue = [];
      this.queues.set(key, queue);
    }

    if (queue.length >= this.config.maxQueueDepth) {
      if (msg.salience === "low") return false;
      const lowIdx = queue.findIndex((m) => m.salience === "low");
      if (lowIdx >= 0) queue.splice(lowIdx, 1);
    }

    queue.push(msg);
    return true;
  }

  async flush(
    key: string,
    sendFn: DiscordSendFn,
    onError?: (msg: OutboundDiscordMessage, err: ClassifiedDiscordError) => void,
  ): Promise<void> {
    const queue = this.queues.get(key);
    if (!queue) return;

    while (queue.length > 0) {
      const msg = queue[0]!;
      const currentTime = this.now();

      if (msg.notBefore > currentTime) break;

      try {
        await sendFn(msg.discordChannelId, msg.payload);
        queue.shift();
      } catch (err) {
        const classified = classifyDiscordError(err, currentTime);

        if (classified.kind === "rate_limited" && classified.retryAt) {
          msg.notBefore = classified.retryAt;
          break;
        }

        if (!isRetryable(classified)) {
          const removed = queue.shift()!;
          onError?.(removed, classified);
          continue;
        }

        msg.attempts++;
        if (msg.attempts >= this.config.maxAttempts) {
          const removed = queue.shift()!;
          onError?.(removed, classified);
          continue;
        }

        const backoff = Math.min(
          this.config.baseBackoffMs * 2 ** (msg.attempts - 1),
          this.config.maxBackoffMs,
        );
        msg.notBefore = currentTime + backoff;
        break;
      }
    }

    if (queue.length === 0) this.queues.delete(key);
  }

  async flushAll(
    sendFnByAgent: (agentId: string) => DiscordSendFn,
    onError?: (msg: OutboundDiscordMessage, err: ClassifiedDiscordError) => void,
  ): Promise<void> {
    for (const key of [...this.queues.keys()]) {
      const agentId = key.split(":")[0]!;
      await this.flush(key, sendFnByAgent(agentId), onError);
    }
  }

  queueDepth(key: string): number {
    return this.queues.get(key)?.length ?? 0;
  }

  allKeys(): string[] {
    return [...this.queues.keys()];
  }

  clear(): void {
    this.queues.clear();
  }
}
