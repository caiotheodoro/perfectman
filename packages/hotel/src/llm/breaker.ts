import {
  BREAKER_FAILURE_THRESHOLD,
  BREAKER_INITIAL_BACKOFF_MS,
  BREAKER_MAX_BACKOFF_MS,
} from "@perfectman/server/hotel";
import type { BreakerPhase, BreakerState, LlmCircuitBreakerApi } from "@perfectman/server/hotel";
import type { Clock, TimerHandle } from "../clock/clock.js";

export type BreakerOptions = {
  clock: Clock;
  /** One tiny call; true when the provider answered. */
  probe(): Promise<boolean>;
  /** Opened: the run auto-pauses with cause `breaker` and the admin is told. */
  onOpen(): void;
  /** One good half-open call: the run resumes itself (D49) and the admin is told. */
  onClose(): void;
  threshold?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
};

/**
 * Consecutive provider failures (timeouts, 5xx, 429, network; not schema or
 * parse fallbacks) open the breaker; it half-opens after 15 s, doubling to
 * 5 min; ONE successful probe closes it (D49). Never ends a run on a timer.
 */
export class LlmCircuitBreaker implements LlmCircuitBreakerApi {
  private phase: BreakerPhase = "closed";
  private failures = 0;
  private openedAt: number | undefined;
  private nextProbeAt: number | undefined;
  private backoffMs: number;
  private timer: TimerHandle | null = null;
  private pausedRun = false;
  private disposed = false;

  constructor(private readonly o: BreakerOptions) {
    this.backoffMs = o.initialBackoffMs ?? BREAKER_INITIAL_BACKOFF_MS;
  }

  getState(_simulationId?: string): BreakerState {
    return {
      phase: this.phase,
      consecutiveFailures: this.failures,
      ...(this.openedAt !== undefined ? { openedAt: this.openedAt } : {}),
      ...(this.nextProbeAt !== undefined ? { nextProbeAt: this.nextProbeAt } : {}),
      backoffMs: this.backoffMs,
      pausedRun: this.pausedRun,
    };
  }

  recordSuccess(): void {
    if (this.phase === "closed") this.failures = 0;
  }

  recordFailure(): void {
    if (this.phase !== "closed" || this.disposed) return;
    this.failures++;
    if (this.failures >= (this.o.threshold ?? BREAKER_FAILURE_THRESHOLD)) this.open(this.o.initialBackoffMs ?? BREAKER_INITIAL_BACKOFF_MS, true);
  }

  dispose(): void {
    this.disposed = true;
    this.timer?.cancel();
    this.timer = null;
  }

  private open(backoffMs: number, first: boolean): void {
    this.phase = "open";
    this.backoffMs = backoffMs;
    this.openedAt ??= this.o.clock.now();
    this.nextProbeAt = this.o.clock.now() + backoffMs;
    this.pausedRun = true;
    this.timer = this.o.clock.setTimer(() => void this.halfOpen(), backoffMs);
    if (first) this.o.onOpen();
  }

  private async halfOpen(): Promise<void> {
    if (this.disposed) return;
    this.phase = "half_open";
    this.nextProbeAt = undefined;
    let ok = false;
    try {
      ok = await this.o.probe();
    } catch {
      ok = false;
    }
    if (this.disposed) return;
    if (ok) {
      this.phase = "closed";
      this.failures = 0;
      this.openedAt = undefined;
      this.backoffMs = this.o.initialBackoffMs ?? BREAKER_INITIAL_BACKOFF_MS;
      this.pausedRun = false;
      this.o.onClose();
    } else {
      this.open(Math.min(this.o.maxBackoffMs ?? BREAKER_MAX_BACKOFF_MS, this.backoffMs * 2), false);
    }
  }
}
