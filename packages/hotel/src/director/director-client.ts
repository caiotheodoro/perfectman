import type { Clock, TimerHandle } from "../clock/clock.js";
import type { Logger } from "../util/log.js";
import { silentLogger } from "../util/log.js";
import type { HotelFrame, SidecarMsg, SidecarFrame } from "./index.js";
import type { DirectorSocket, SocketFactory } from "./transport.js";

export const PROTO = 1;
/** 1, 2, 4, 8 s then 8 s: the whole schedule fits inside the hotel's 15 s grace. */
export const BACKOFF_MS = [1000, 2000, 4000, 8000] as const;
export const HEARTBEAT_MS = 5000;

export type FrameRecorder = (dir: "in" | "out", frame: SidecarFrame | HotelFrame) => void;

export type DirectorHandlers = {
  /** Called for `hello`; returns the run ids the sidecar still holds (`hello_ack.resume`). */
  onHello(hello: Extract<HotelFrame, { t: "hello" }>): number[];
  /** Every frame after `hello`. */
  onFrame(frame: HotelFrame): void;
  onConnectionChange(up: boolean): void;
};

export type DirectorClientOptions = {
  url: string;
  secret: string;
  clock: Clock;
  socketFactory: SocketFactory;
  handlers: DirectorHandlers;
  sidecar: { version: string; build: string; schema_sha256?: string };
  /** 0..1, for the +-20% backoff jitter. */
  rng?: () => number;
  logger?: Logger;
  recorder?: FrameRecorder;
  maxQueue?: number;
  heartbeatMs?: number;
};

type Conn = { socket: DirectorSocket; id: number };

/**
 * The sidecar end of the Director WebSocket (director-protocol.md). Owns the
 * reconnect schedule, `seq` in both directions, the per-run lease table, the
 * 5 s run heartbeat and a bounded send queue for frames sent before
 * `hello_ack` has gone out. Frames sent while the socket is down are dropped
 * (and counted): after a reconnect the hotel bumps every lease, so a queued
 * command would only come back as `stale_lease`.
 */
export class DirectorClient {
  private conn: Conn | null = null;
  private connId = 0;
  private attempt = 0;
  private stopped = true;
  private ready = false;
  private outSeq = 0;
  private inSeq = 0;
  private cid = 0;
  private queue: string[] = [];
  private reconnectTimer: TimerHandle | null = null;
  private heartbeatTimer: TimerHandle | null = null;
  private readonly leases = new Map<number, number>();
  private readonly tracked = new Set<number>();
  private readonly log: Logger;
  droppedWhileDown = 0;

  constructor(private readonly opts: DirectorClientOptions) {
    this.log = opts.logger ?? silentLogger;
  }

  get connected(): boolean {
    return this.ready;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(code = 1000): void {
    this.stopped = true;
    this.reconnectTimer?.cancel();
    this.heartbeatTimer?.cancel();
    this.reconnectTimer = this.heartbeatTimer = null;
    const conn = this.conn;
    this.conn = null;
    this.markDown();
    conn?.socket.close(code, "sidecar stopping");
  }

  /** Command id, unique per connection (the hotel scopes `cid` to the connection). */
  nextCid(): number {
    return ++this.cid;
  }

  leaseOf(run: number): number | undefined {
    return this.leases.get(run);
  }

  setLease(run: number, lease: number): void {
    this.leases.set(run, lease);
  }

  trackRun(run: number): void {
    this.tracked.add(run);
  }

  untrackRun(run: number): void {
    this.tracked.delete(run);
    this.leases.delete(run);
  }

  /** True when the frame went out (or is queued for the post-hello flush). */
  send(msg: SidecarMsg): boolean {
    const conn = this.conn;
    if (!conn) {
      this.droppedWhileDown++;
      return false;
    }
    const text = this.encode(msg);
    if (!this.ready && msg.t !== "hello_ack") {
      if (this.queue.length >= (this.opts.maxQueue ?? 512)) {
        this.droppedWhileDown++;
        return false;
      }
      this.queue.push(text);
      return true;
    }
    conn.socket.send(text);
    return true;
  }

  /** Closes the socket as a protocol failure; the reconnect loop does the rest. */
  fail(code: number, reason: string): void {
    this.log.warn("director link failed", { code, reason });
    this.conn?.socket.close(code, reason);
  }

  private encode(msg: SidecarMsg): string {
    const frame = { ...msg, seq: ++this.outSeq } as SidecarFrame;
    this.opts.recorder?.("out", frame);
    return JSON.stringify(frame);
  }

  private connect(): void {
    if (this.stopped) return;
    const id = ++this.connId;
    this.outSeq = 0;
    this.inSeq = 0;
    this.cid = 0;
    this.queue = [];
    const socket = this.opts.socketFactory(
      this.opts.url,
      { Authorization: `Bearer ${this.opts.secret}` },
      {
        open: () => undefined,
        message: (text) => this.onMessage(id, text),
        close: (code) => this.onClose(id, code),
        error: (message) => this.log.warn("director socket error", { message }),
      },
    );
    this.conn = { socket, id };
  }

  private onMessage(id: number, text: string): void {
    if (this.conn?.id !== id) return;
    let frame: HotelFrame;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object") throw new Error("not an object");
      const candidate = parsed as { t?: unknown; seq?: unknown };
      if (typeof candidate.t !== "string" || typeof candidate.seq !== "number") throw new Error("missing t or seq");
      frame = parsed as HotelFrame;
    } catch (err) {
      this.fail(4000, `bad frame: ${(err as Error).message}`);
      return;
    }
    if (frame.seq !== this.inSeq + 1) {
      this.fail(4005, `seq ${frame.seq} after ${this.inSeq}`);
      return;
    }
    this.inSeq = frame.seq;
    this.opts.recorder?.("in", frame);

    if (frame.t === "lease") this.leases.set(frame.run, frame.lease);
    if (frame.t === "run_start") this.leases.set(frame.run, frame.lease);

    if (frame.t === "hello") {
      this.onHello(frame);
      return;
    }
    if (!this.ready) return; // nothing is meaningful before hello
    this.opts.handlers.onFrame(frame);
  }

  private onHello(hello: Extract<HotelFrame, { t: "hello" }>): void {
    if (hello.proto > PROTO) {
      this.fail(4002, `hotel speaks proto ${hello.proto}, sidecar ${PROTO}`);
      return;
    }
    const resume = this.opts.handlers.onHello(hello);
    this.send({ t: "hello_ack", proto: PROTO, resume, sidecar: this.opts.sidecar });
    this.ready = true;
    this.attempt = 0;
    for (const text of this.queue.splice(0)) this.conn?.socket.send(text);
    this.scheduleHeartbeat();
    this.opts.handlers.onConnectionChange(true);
  }

  private onClose(id: number, code: number): void {
    if (this.conn?.id !== id) return;
    this.conn = null;
    this.markDown();
    if (this.stopped) return;
    const base = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 8000;
    const jitter = 1 + ((this.opts.rng ?? Math.random)() - 0.5) * 0.4;
    this.attempt++;
    this.log.info("director link closed", { code, retryInMs: Math.round(base * jitter) });
    this.reconnectTimer = this.opts.clock.setTimer(() => {
      this.reconnectTimer = null;
      this.connect();
    }, base * jitter);
  }

  private markDown(): void {
    const wasUp = this.ready;
    this.ready = false;
    this.queue = [];
    this.heartbeatTimer?.cancel();
    this.heartbeatTimer = null;
    if (wasUp) this.opts.handlers.onConnectionChange(false);
  }

  private scheduleHeartbeat(): void {
    this.heartbeatTimer?.cancel();
    this.heartbeatTimer = this.opts.clock.setTimer(() => {
      if (!this.ready) return;
      for (const run of this.tracked) this.send({ t: "run_heartbeat", run });
      this.scheduleHeartbeat();
    }, this.opts.heartbeatMs ?? HEARTBEAT_MS);
  }
}
