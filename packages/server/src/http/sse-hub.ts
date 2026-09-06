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
 * buffers and kicks a writer that drains on its own. Backpressure is absorbed
 * by dropping, not by waiting.
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
  /** SSE `id:`, for `Last-Event-ID` resumption. */
  id?: string | number;
  /**
   * Coalescing key. A newer message with the same key replaces a pending one
   * rather than queueing behind it, so a slow client sees the latest state
   * instead of an ever-growing backlog. Unset means "never drop me".
   */
  coalesceKey?: string;
};

/** Control messages are never coalesced away; this caps the rest. */
const MAX_QUEUE = 64;
/** Past this many buffered bytes the client is not keeping up at all. */
const MAX_BUFFERED_BYTES = 1_000_000;

type Client = {
  id: number;
  sink: SseSink;
  queue: SseMessage[];
  dropped: number;
  writing: boolean;
  /** Socket reported full; only a `drain` resumes writing. */
  paused: boolean;
  closed: boolean;
};

export class SseHub {
  private readonly clients = new Map<number, Client>();
  private nextId = 1;

  /** Replayed to a client that connects mid-run, before anything live. */
  private backlog: SseMessage[] = [];
  private backlogLimit = 0;

  /**
   * @param backlogLimit how many past messages a late joiner receives. Frames
   * beyond it are not resent — the client refetches the replay instead, which
   * is cheaper than keeping the whole run in two places.
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
  }

  subscribe(sink: SseSink): () => void {
    const client: Client = {
      id: this.nextId++,
      sink,
      queue: [...this.backlog],
      dropped: 0,
      writing: false,
      paused: false,
      closed: false,
    };
    this.clients.set(client.id, client);

    const close = (): void => this.remove(client);
    sink.on("close", close);
    sink.on("error", close);

    this.flush(client);
    return close;
  }

  /**
   * Synchronous and total: it never throws, never awaits, and never reports
   * failure to the caller — because the caller is a simulation pulse, and there
   * is nothing useful it could do about a slow browser.
   */
  publish(message: SseMessage): void {
    if (this.backlogLimit > 0) {
      this.backlog.push(message);
      if (this.backlog.length > this.backlogLimit) this.backlog.shift();
    }
    for (const client of this.clients.values()) {
      this.enqueue(client, message);
      this.flush(client);
    }
  }

  /** Best-effort final write, then close every client. */
  closeAll(): void {
    for (const client of [...this.clients.values()]) {
      // A paused client still gets one last attempt: the `stopped` frame is
      // the one message worth pushing at a socket that is behind.
      client.paused = false;
      this.flush(client);
      try {
        client.sink.end();
      } catch {
        // A client that vanished mid-teardown is not a problem worth reporting.
      }
      this.clients.delete(client.id);
    }
  }

  /** Frames dropped across all clients, for the run's counters. */
  droppedTotal(): number {
    let total = 0;
    for (const client of this.clients.values()) total += client.dropped;
    return total;
  }

  private enqueue(client: Client, message: SseMessage): void {
    if (client.closed) return;

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
      }
    }
  }

  private flush(client: Client): void {
    // `paused` is what makes backpressure real. Without it a later `publish`
    // would call `flush` again and write straight into a socket that already
    // said stop — so nothing would ever queue, and nothing would ever coalesce.
    if (client.writing || client.closed || client.paused) return;
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
        // Only the writer waits. Producers keep enqueuing into the bounded
        // buffer and never block on this.
        client.paused = true;
        client.writing = false;
        const resume = (): void => {
          client.sink.off?.("drain", resume);
          client.paused = false;
          this.flush(client);
        };
        client.sink.on("drain", resume);
        return;
      }
    }

    client.writing = false;
  }

  private remove(client: Client, destroy = false): void {
    if (client.closed) return;
    client.closed = true;
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
