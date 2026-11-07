import { LlmCircuitBreaker } from "@perfectman/server/hotel";
import type { OperatorEvent } from "@perfectman/shared";
import type { BreakerState } from "@perfectman/server/hotel";
import type { Clock, TimerHandle } from "../clock/clock.js";

export type BreakerDriverOptions = {
  clock: Clock;
  /** The run's simulation id: the server breaker keys its state by it. */
  simulationId: string;
  /** One tiny call; true when the provider answered. */
  probe(): Promise<boolean>;
  /**
   * The breaker opened. Return false when the run could not be paused for it
   * (an admin pause already holds it): the breaker then never resumes the run.
   */
  onOpen(): boolean;
  /** One good half-open call. `pausedRun` says whether this breaker owned the pause (D49). */
  onClose(pausedRun: boolean): void;
  /** `llm_circuit_open` (first opening only) and `llm_circuit_closed`, for the admin. */
  notice(code: "llm_circuit_open" | "llm_circuit_closed"): void;
  initialBackoffMs?: number;
  threshold?: number;
};

/**
 * Drives the server's `LlmCircuitBreaker` (ADR-0025, D49) for one run. The state
 * machine is the server's, fed by the run's operator events through its gateway
 * seat (`gateway`, passed in `extraGateways`). What the server cannot do is
 * move time: this class schedules the half-open probe on the hotel clock, makes
 * the tiny health call, and reports the answer to the breaker as one observed
 * call, so a good probe closes it and a bad one reopens it with doubled backoff.
 * Never ends a run on a timer.
 */
export class BreakerDriver {
  readonly gateway: LlmCircuitBreaker;
  private timer: TimerHandle | null = null;
  private disposed = false;

  constructor(private readonly o: BreakerDriverOptions) {
    this.gateway = new LlmCircuitBreaker({
      clock: () => o.clock.now(),
      ...(o.initialBackoffMs !== undefined ? { initialBackoffMs: o.initialBackoffMs } : {}),
      ...(o.threshold !== undefined ? { threshold: o.threshold } : {}),
      onOpen: () => o.onOpen(),
      onClose: (_id, state) => {
        o.notice("llm_circuit_closed");
        o.onClose(state.pausedRun);
      },
      emit: (event) => {
        if (this.disposed || event.type !== "llm_circuit_open") return;
        if (event.data?.["reopened"] !== true) o.notice("llm_circuit_open");
        this.schedule();
      },
    });
  }

  getState(): BreakerState {
    return this.gateway.getState(this.o.simulationId);
  }

  dispose(): void {
    this.disposed = true;
    this.timer?.cancel();
    this.timer = null;
    this.gateway.clear(this.o.simulationId);
  }

  private schedule(): void {
    this.timer?.cancel();
    const at = this.getState().nextProbeAt ?? this.o.clock.now();
    this.timer = this.o.clock.setTimer(() => void this.probe(), Math.max(0, at - this.o.clock.now()));
  }

  private async probe(): Promise<void> {
    if (this.disposed || !this.gateway.beginProbe(this.o.simulationId)) return;
    let ok = false;
    try {
      ok = await this.o.probe();
    } catch {
      ok = false;
    }
    if (this.disposed) return;
    this.gateway.observe(this.probeEvent(ok));
  }

  /** A probe is one more observed call: the same motive prefixes the scheduler's events carry. */
  private probeEvent(ok: boolean): OperatorEvent {
    return {
      type: "action_intent",
      simulationId: this.o.simulationId,
      pulseIndex: 0,
      detail: "Circuit breaker probe",
      data: { privateMotiveSummary: ok ? "Circuit breaker probe answered." : "Provider failed: circuit breaker probe" },
      createdAt: this.o.clock.now(),
    };
  }
}
