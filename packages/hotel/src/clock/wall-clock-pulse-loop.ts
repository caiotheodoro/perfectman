import type { RunPulseOptions } from "@perfectman/server/hotel";
import type { Clock, TimerHandle } from "./clock.js";
import { sleepOn } from "./clock.js";

export const BASE_PULSE_MS = 6000;
export const FOCUS_COALESCE_MS = 300;

export type PulseRunner = (opts: RunPulseOptions) => Promise<unknown>;

export type PulseLoopOptions = {
  clock: Clock;
  runPulse: PulseRunner;
  /** D52: 6 s. A seeded jitter inside 5000..8000 ms is optional. */
  baseIntervalMs?: number;
  coalesceMs?: number;
  /** 0..1; when set the base interval is multiplied by 1 +- jitter*0.25. */
  rng?: () => number;
  onError?: (err: unknown, reason: RunPulseOptions["reason"]) => void;
  /** Bound for `stop()` while a pulse is in flight (the HTTP controller uses 30 s). */
  drainTimeoutMs?: number;
};

/**
 * Wall-clock pulse clock (hotel-package.md 9, D17, D52).
 *
 * Base lane: one pulse in flight at a time, cadence measured from the start of
 * the previous pulse, never a catch-up burst. Focus lane: the first human line
 * fires a focused pulse at once, further lines inside the 300 ms window
 * coalesce into one follow-up. The lanes do not wait for each other; per-agent
 * locks and the shared generate concurrency live in the server scheduler.
 */
export class WallClockPulseLoop {
  private readonly interval: number;
  private readonly coalesce: number;
  private readonly drainMs: number;
  private abort = new AbortController();
  private running = false;
  private lastPulseAt: number;
  private baseInFlight: Promise<void> | null = null;
  private readonly focusInFlight = new Set<Promise<void>>();
  private pending = new Set<string>();
  private windowEnd = 0;
  private armed: TimerHandle | null = null;
  private focusReason: RunPulseOptions["reason"] = "human_chat";

  constructor(private readonly opts: PulseLoopOptions) {
    this.interval = opts.baseIntervalMs ?? BASE_PULSE_MS;
    this.coalesce = opts.coalesceMs ?? FOCUS_COALESCE_MS;
    this.drainMs = opts.drainTimeoutMs ?? 30_000;
    this.lastPulseAt = opts.clock.now();
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.abort = new AbortController();
    this.lastPulseAt = this.opts.clock.now();
    this.baseInFlight = this.baseLane(this.abort.signal);
  }

  /** Stops the timers; an in-flight pulse is left to settle. */
  pause(): void {
    this.running = false;
    this.abort.abort();
    this.armed?.cancel();
    this.armed = null;
    this.pending.clear();
  }

  resume(): void {
    this.start();
  }

  /** Stops, then waits (bounded) for in-flight pulses. Resolves false when the bound was hit. */
  async stop(): Promise<boolean> {
    this.pause();
    const inflight = [this.baseInFlight, ...this.focusInFlight].filter((p): p is Promise<void> => p !== null);
    if (inflight.length === 0) return true;
    const settled = Promise.all(inflight).then(() => true);
    const timedOut = sleepOn(this.opts.clock, this.drainMs).then(() => false);
    return Promise.race([settled, timedOut]);
  }

  requestFocused(ids: string[], reason: RunPulseOptions["reason"] = "human_chat"): void {
    if (!this.running || ids.length === 0) return;
    for (const id of ids) this.pending.add(id);
    this.focusReason = reason;
    const now = this.opts.clock.now();
    if (now >= this.windowEnd) {
      this.windowEnd = now + this.coalesce;
      this.fire();
    } else if (!this.armed) {
      this.armed = this.opts.clock.setTimer(() => {
        this.armed = null;
        this.windowEnd = this.opts.clock.now() + this.coalesce;
        this.fire();
      }, this.windowEnd - now);
    }
  }

  private fire(): void {
    const focusAgentIds = [...this.pending];
    this.pending.clear();
    if (focusAgentIds.length === 0 || !this.running) return;
    const p = this.pulse({ reason: this.focusReason, focusAgentIds });
    this.focusInFlight.add(p);
    void p.finally(() => this.focusInFlight.delete(p));
  }

  private async pulse(base: { reason: RunPulseOptions["reason"]; focusAgentIds?: string[] }): Promise<void> {
    const startedAt = this.opts.clock.now();
    const elapsedMs = Math.max(0, startedAt - this.lastPulseAt);
    this.lastPulseAt = startedAt;
    try {
      await this.opts.runPulse({ ...base, elapsedMs });
    } catch (err) {
      this.opts.onError?.(err, base.reason);
    }
  }

  private nextInterval(): number {
    const r = this.opts.rng;
    return r ? Math.round(this.interval * (1 + (r() - 0.5) * 0.5)) : this.interval;
  }

  private async baseLane(signal: AbortSignal): Promise<void> {
    let nextAt = this.opts.clock.now() + this.nextInterval();
    while (!signal.aborted) {
      const woke = await sleepOn(this.opts.clock, nextAt - this.opts.clock.now(), signal);
      if (!woke || signal.aborted) return;
      const startedAt = this.opts.clock.now();
      await this.pulse({ reason: "base" });
      // Drift-free cadence; an overrun skips the missed beats instead of bursting.
      nextAt = Math.max(this.opts.clock.now(), startedAt + this.nextInterval());
    }
  }
}
