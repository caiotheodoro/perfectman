import type { PulseResult } from "./pulse-scheduler.js";
import type { RunPulseOptions } from "./hotel-runtime-api.js";

/**
 * Wall-clock pulse loop for hotel runs (ADR-0024, hotel-package.md section 9).
 *
 * `runPulseLoop` runs as fast as the model answers and `SimulationRuntime.start`
 * has a period of interval plus duration; neither keeps a cadence a human can
 * feel. This loop owns two independent lanes on one injected clock:
 *
 *  - base lane: a drift-free timeline at `baseIntervalMs`. A beat that finds the
 *    previous base pulse still in flight is skipped, never queued, so an
 *    overrun cannot turn into a burst.
 *  - focus lane: the first request fires at once; requests inside the next
 *    `focusCoalesceMs` merge into one follow-up focused pulse (D52). No
 *    trailing debounce: typing starts at the model call, so a debounce would
 *    spend the whole p50 budget.
 *
 * Every pulse is told how much wall time passed since the previous pulse of any
 * kind, so the simulation ages by real time. `pause` and `resume` move
 * neither lane's history: a resumed loop starts a fresh interval.
 */
export type LoopTimerHandle = unknown;

export type LoopClock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): LoopTimerHandle;
  clearTimeout(handle: LoopTimerHandle): void;
};

export const systemLoopClock: LoopClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type WallClockPulseLoopOptions = {
  runtime: { runPulse(simulationId: string, opts?: RunPulseOptions): Promise<PulseResult> };
  simulationId: string;
  clock?: LoopClock;
  /** D52: 6000. */
  baseIntervalMs?: number;
  /** Seeded jitter on each beat, inside 5000..8000 ms by default when given an rng. */
  jitter?: { rng: () => number; minMs?: number; maxMs?: number };
  /** D52: 300. */
  focusCoalesceMs?: number;
  /** How long `stop` waits for in-flight pulses (the run controller's 30 s). */
  drainTimeoutMs?: number;
  onError?: (err: unknown) => void;
};

export type LoopState = "idle" | "running" | "paused" | "stopped";

export class WallClockPulseLoop {
  private readonly clock: LoopClock;
  private readonly baseIntervalMs: number;
  private readonly focusCoalesceMs: number;
  private readonly drainTimeoutMs: number;

  private state: LoopState = "idle";
  private baseTimer: LoopTimerHandle | undefined;
  private baseInFlight: Promise<unknown> | null = null;
  private nextBaseAt = 0;
  private lastPulseAt = 0;
  private readonly inFlight = new Set<Promise<unknown>>();

  private pendingFocus = new Set<string>();
  private focusWindowEnd = -Infinity;
  private focusTimer: LoopTimerHandle | undefined;

  constructor(private readonly options: WallClockPulseLoopOptions) {
    this.clock = options.clock ?? systemLoopClock;
    this.baseIntervalMs = options.baseIntervalMs ?? 6_000;
    this.focusCoalesceMs = options.focusCoalesceMs ?? 300;
    this.drainTimeoutMs = options.drainTimeoutMs ?? 30_000;
  }

  getState(): LoopState {
    return this.state;
  }

  start(): void {
    if (this.state === "running") return;
    if (this.state === "stopped") throw new Error("WallClockPulseLoop was stopped");
    this.state = "running";
    this.lastPulseAt = this.clock.now();
    this.nextBaseAt = this.clock.now() + this.interval();
    this.armBase();
  }

  pause(): void {
    if (this.state !== "running") return;
    this.state = "paused";
    this.clearTimers();
    this.pendingFocus.clear();
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.state = "running";
    this.lastPulseAt = this.clock.now();
    this.nextBaseAt = this.clock.now() + this.interval();
    this.armBase();
  }

  /** Stops both lanes and waits (bounded) for pulses already in flight. */
  async stop(): Promise<void> {
    this.state = "stopped";
    this.clearTimers();
    this.pendingFocus.clear();
    if (this.inFlight.size === 0) return;
    let timer: LoopTimerHandle | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = this.clock.setTimeout(resolve, this.drainTimeoutMs);
    });
    await Promise.race([Promise.allSettled([...this.inFlight]).then(() => undefined), timeout]);
    if (timer !== undefined) this.clock.clearTimeout(timer);
  }

  /**
   * Asks for a focused pulse for these agents. Returns false when the loop is
   * not running (a paused or stopped run never pulses).
   */
  requestFocused(agentIds: readonly string[]): boolean {
    if (this.state !== "running" || agentIds.length === 0) return false;
    for (const id of agentIds) this.pendingFocus.add(id);
    const now = this.clock.now();
    if (now >= this.focusWindowEnd) {
      this.focusWindowEnd = now + this.focusCoalesceMs;
      this.fireFocused();
    } else if (this.focusTimer === undefined) {
      this.focusTimer = this.clock.setTimeout(() => {
        this.focusTimer = undefined;
        this.focusWindowEnd = this.clock.now() + this.focusCoalesceMs;
        this.fireFocused();
      }, this.focusWindowEnd - now);
    }
    return true;
  }

  private interval(): number {
    const jitter = this.options.jitter;
    if (!jitter) return this.baseIntervalMs;
    const min = jitter.minMs ?? 5_000;
    const max = jitter.maxMs ?? 8_000;
    return Math.round(min + (max - min) * jitter.rng());
  }

  private armBase(): void {
    this.baseTimer = this.clock.setTimeout(() => this.onBeat(), Math.max(0, this.nextBaseAt - this.clock.now()));
  }

  private onBeat(): void {
    this.baseTimer = undefined;
    if (this.state !== "running") return;
    const now = this.clock.now();
    if (this.baseInFlight === null) {
      this.track(
        this.run({ reason: "base", elapsedMs: now - this.lastPulseAt }, now),
        (p) => (this.baseInFlight = p),
        () => (this.baseInFlight = null),
      );
    }
    // Drift-free: the next beat is on the original timeline. A late timer or an
    // overrun skips the beats it missed instead of firing them back to back.
    do {
      this.nextBaseAt += this.interval();
    } while (this.nextBaseAt <= now);
    this.armBase();
  }

  private fireFocused(): void {
    if (this.state !== "running" || this.pendingFocus.size === 0) return;
    const focusAgentIds = [...this.pendingFocus];
    this.pendingFocus = new Set();
    const now = this.clock.now();
    this.track(this.run({ reason: "human_chat", focusAgentIds, elapsedMs: now - this.lastPulseAt }, now));
  }

  private run(opts: RunPulseOptions, now: number): Promise<unknown> {
    this.lastPulseAt = now;
    return this.options.runtime.runPulse(this.options.simulationId, opts).catch((err: unknown) => {
      this.options.onError?.(err);
    });
  }

  private track(promise: Promise<unknown>, onStart?: (p: Promise<unknown>) => void, onEnd?: () => void): void {
    onStart?.(promise);
    this.inFlight.add(promise);
    void promise.finally(() => {
      this.inFlight.delete(promise);
      onEnd?.();
    });
  }

  private clearTimers(): void {
    if (this.baseTimer !== undefined) this.clock.clearTimeout(this.baseTimer);
    if (this.focusTimer !== undefined) this.clock.clearTimeout(this.focusTimer);
    this.baseTimer = undefined;
    this.focusTimer = undefined;
  }
}
