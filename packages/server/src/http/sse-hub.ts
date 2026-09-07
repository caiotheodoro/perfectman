/**
 * Server-sent events, fanned out without ever blocking the producer.
 *
 * This is the load-bearing constraint of the whole live view. Every delivery
 * gateway call is awaited inline inside the pulse
 * (packages/server/src/simulation/pulse-scheduler.ts:704), fanned out with
 * `Promise.all`, and nothing on that path has a timeout. So a gateway that
 * awaited a slow browser would not merely lag — it would slow the simulation
 * down, and a browser that stopped reading entirely would hang the run forever.
 *
 * Therefore: `publish` is synchronous and never fails. It appends to per-client
 * buffers and kicks a writer that drains on its own. Overloaded clients
 * reconnect to retained history; producers never wait for them.
 */

/** The bits of `ServerResponse` used here, so tests need no socket. */
export type SseSink = {
  write(chunk: string): boolean;
  end(): void;
  destroy?(): void;
  on(event: "drain" | "close" | "error", listener: () => void): void;
  off?(event: "drain" | "close" | "error", listener: () => void): void;
  writableLength?: number;
};

export type SseMessage = {
  /** SSE `event:` name. */
  type: string;
  data: unknown;
  /** SSE `id:`. Reconnects replay retained revisions, which the client deduplicates. */
  id?: string | number;
  /**
   * Coalescing key. A newer message with the same key replaces a pending one
   * rather than queueing behind it, so a slow client sees the latest state
   * instead of an ever-growing backlog. Distinct pulse content never uses it.
   */
  coalesceKey?: string;
  /** Cumulative revisions replace only the same logical message, without loss. */
  replayKey?: string;
  /** Current bootstrap state survives eviction of historical pulse frames. */
  bootstrapKey?: string;
};

/** Disconnect a slow client rather than silently dropping distinct pulse content. */
const MAX_QUEUE = 64;
/** Past this many buffered bytes the client is not keeping up at all. */
const MAX_BUFFERED_BYTES = 1_000_000;
/** Final delivery gets a chance to drain, but a dead socket must not outlive a run. */
const FINAL_DRAIN_TIMEOUT_MS = 30_000;

type Client = {
  id: number;
  sink: SseSink;
  queue: SseMessage[];
  dropped: number;
  writing: boolean;
  /** Socket reported full; only a `drain` resumes writing. */
  paused: boolean;
  closed: boolean;
  closing: boolean;
  closeTimer?: NodeJS.Timeout;
  drain?: () => void;
};

export class SseHub {
  private readonly clients = new Map<number, Client>();
  private nextId = 1;

  /** Replayed to a client that connects mid-run, before anything live. */
  private backlog: SseMessage[] = [];
  private readonly bootstrap = new Map<string, SseMessage>();
  private historyTruncated = false;
  private ended = false;
  private backlogLimit = 0;

  /**
   * @param backlogLimit how many historical messages a late joiner receives,
   * keeping only the latest cumulative revision for a replay key. Bootstrap
   * state is retained separately; an expired pulse history is announced.
   */
  constructor(backlogLimit = 0) {
    this.backlogLimit = backlogLimit;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Clears the replay backlog for a new run, keeping connected clients.
   * The hub outlives any single run so a client that subscribed early is not
   * silently orphaned when the next one starts.
   */
  resetBacklog(): void {
    this.backlog = [];
    this.bootstrap.clear();
    this.historyTruncated = false;
    this.ended = false;
  }

  subscribe(sink: SseSink): () => void {
    const client: Client = {
      id: this.nextId++,
      sink,
      queue: [
        ...[...this.bootstrap.values()].sort((a, b) => Number(b.type === "hello") - Number(a.type === "hello")),
        ...(this.historyTruncated ? [{ type: "notice", data: { type: "notice", notice: {
          type: "history_truncated",
          detail: "Earlier live history has expired. This view starts at the oldest retained turn.",
        } } }] : []),
        ...this.backlog,
      ],
      dropped: 0,
      writing: false,
      paused: false,
      closed: false,
      closing: false,
    };
    this.clients.set(client.id, client);

    const close = (): void => this.remove(client);
    sink.on("close", close);
    sink.on("error", close);

    if (this.ended) this.finishClient(client);
    else this.flush(client);
    return close;
  }

  /**
   * Synchronous and total: it never throws, never awaits, and never reports
   * failure to the caller — because the caller is a simulation pulse, and there
   * is nothing useful it could do about a slow browser.
   */
  publish(message: SseMessage): void {
    if (message.bootstrapKey) {
      this.bootstrap.set(message.bootstrapKey, message);
    } else if (this.backlogLimit > 0) {
      const previous = message.replayKey
        ? this.backlog.findIndex((entry) => entry.replayKey === message.replayKey)
        : -1;
      if (previous !== -1) this.backlog.splice(previous, 1);
      this.backlog.push(message);
      if (this.backlog.length > this.backlogLimit) {
        if (this.backlog.shift()?.type === "pulse") this.historyTruncated = true;
      }
    }
    for (const client of this.clients.values()) {
      this.enqueue(client, message);
      this.flush(client);
    }
  }

  /** Finish queued delivery before ending; only the writer waits for a drain. */
  closeAll(): void {
    this.ended = true;
    for (const client of [...this.clients.values()]) {
      this.finishClient(client);
    }
  }

  private finishClient(client: Client): void {
    if (client.closing || client.closed) return;
    client.closing = true;
    client.closeTimer = setTimeout(() => this.remove(client, true), FINAL_DRAIN_TIMEOUT_MS);
    client.closeTimer.unref();
    this.flush(client);
  }

  /** Frames dropped across all clients, for the run's counters. */
  droppedTotal(): number {
    let total = 0;
    for (const client of this.clients.values()) total += client.dropped;
    return total;
  }

  private enqueue(client: Client, message: SseMessage): void {
    if (client.closed || client.closing) return;

    if (message.replayKey) {
      const existing = client.queue.findIndex((m) => m.replayKey === message.replayKey);
      if (existing !== -1) {
        client.queue.splice(existing, 1);
        client.queue.push(message);
        return;
      }
    }

    if (message.coalesceKey) {
      const existing = client.queue.findIndex((m) => m.coalesceKey === message.coalesceKey);
      if (existing !== -1) {
        client.queue[existing] = message;
        client.dropped++;
        return;
      }
    }

    client.queue.push(message);

    if (client.queue.length > MAX_QUEUE) {
      // Drop the oldest coalescable message; control messages stay.
      const victim = client.queue.findIndex((m) => m.coalesceKey !== undefined);
      if (victim !== -1) {
        client.queue.splice(victim, 1);
        client.dropped++;
      } else {
        // EventSource reconnects to retained history; an expired history is
        // explicitly announced to the new subscriber rather than concealed.
        this.remove(client, true);
      }
    }
  }

  private flush(client: Client): void {
    // `paused` is what makes backpressure real. Without it a later `publish`
    // would call `flush` again and write straight into a socket that already
    // said stop — so nothing would ever queue, and nothing would ever coalesce.
    if (client.writing || client.closed || (client.paused && client.queue.length > 0)) return;
    client.writing = true;

    while (client.queue.length > 0) {
      const message = client.queue.shift();
      if (!message) break;
      const chunk = encode(message, client.dropped);
      let ok: boolean;
      try {
        ok = client.sink.write(chunk);
      } catch {
        this.remove(client);
        return;
      }
      if (!ok) {
        if ((client.sink.writableLength ?? 0) > MAX_BUFFERED_BYTES) {
          this.remove(client, true);
          return;
        }
        // write(false) still accepted the chunk. end() will flush it; only
        // messages that have not been written need a later drain callback.
        if (client.closing && client.queue.length === 0) break;
        // Only the writer waits. Producers keep enqueuing into the bounded
        // buffer and never block on this.
        client.paused = true;
        client.writing = false;
        const resume = (): void => {
          client.sink.off?.("drain", resume);
          client.drain = undefined;
          client.paused = false;
          this.flush(client);
        };
        client.drain = resume;
        client.sink.on("drain", resume);
        return;
      }
    }

    client.writing = false;
    if (client.closing) {
      this.remove(client);
      try {
        client.sink.end();
      } catch {
        // A client that vanished during teardown needs no further delivery.
      }
    }
  }

  private remove(client: Client, destroy = false): void {
    if (client.closed) return;
    client.closed = true;
    if (client.closeTimer) clearTimeout(client.closeTimer);
    if (client.drain) client.sink.off?.("drain", client.drain);
    this.clients.delete(client.id);
    if (destroy) {
      try {
        client.sink.destroy?.();
      } catch {
        // Already gone.
      }
    }
  }
}

function encode(message: SseMessage, dropped: number): string {
  const data = dropped > 0 && message.coalesceKey ? withDropped(message.data, dropped) : message.data;
  const lines = [`event: ${message.type}`];
  if (message.id !== undefined) lines.push(`id: ${message.id}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join("\n")}\n\n`;
}

function withDropped(data: unknown, dropped: number): unknown {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? { ...(data as Record<string, unknown>), droppedBefore: dropped }
    : data;
}

/** The SSE handshake, including the headers proxies need to stop buffering. */
export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};
