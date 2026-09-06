/**
 * The run loop.
 *
 * `SimulationRuntime.start()` is a `setTimeout` chain with no end condition and
 * no cancellation point — it runs until the process is signalled. A web run
 * needs a bound, a stop button, and a place to publish progress, so it drives
 * `runPulse` itself, the way the eval harness does
 * (packages/eval/src/run/scenario-runner.ts:213).
 *
 * `pulseIntervalMs` is not this loop's sleep. It is the *simulated* clock the
 * emotion and decay math read, so it stays at production pacing while the loop
 * runs as fast as the model allows.
 */
import type { PulseResult } from "../../simulation/pulse-scheduler.js";
import type { SimulationRuntime } from "../../simulation/simulation-runtime.js";

export type LoopStopReason = "completed" | "stopped" | "wall_clock" | "error";

export type LoopOutcome = {
  reason: LoopStopReason;
  pulsesRun: number;
  error?: Error;
};

export type PulseLoopParams = {
  runtime: SimulationRuntime;
  simulationId: string;
  maxPulses: number;
  wallClockCapMs: number;
  signal: AbortSignal;
  /** Called after each pulse settles, with the result the gateways never see. */
  onPulse: (result: PulseResult) => void;
  now?: () => number;
};

/**
 * A handle on the in-flight pulse. `runtime.stop()` clears the scheduler's
 * timer but cannot cancel a pulse already running, and a pulse that lands after
 * teardown would write to a closed database or a flushed gateway — so teardown
 * has to await this before it does anything else.
 */
export type InFlight = { current: Promise<PulseResult> | null };

export async function runPulseLoop(params: PulseLoopParams, inFlight: InFlight): Promise<LoopOutcome> {
  const { runtime, simulationId, maxPulses, wallClockCapMs, signal, onPulse } = params;
  const now = params.now ?? Date.now;
  const startedAt = now();
  let pulsesRun = 0;

  for (let i = 0; i < maxPulses; i++) {
    // Checked between pulses only: there is no way to interrupt one mid-flight.
    if (signal.aborted) return { reason: "stopped", pulsesRun };
    if (now() - startedAt > wallClockCapMs) return { reason: "wall_clock", pulsesRun };

    try {
      inFlight.current = runtime.runPulse(simulationId);
      const result = await inFlight.current;
      pulsesRun++;
      onPulse(result);
    } catch (err) {
      return { reason: "error", pulsesRun, error: err as Error };
    } finally {
      inFlight.current = null;
    }

    // Yield so the SSE writer and any pending HTTP request get a turn; without
    // this a fast mock run starves the event loop for its whole duration.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  return { reason: signal.aborted ? "stopped" : "completed", pulsesRun };
}

/**
 * Waits for an in-flight pulse to settle, with a bound.
 *
 * The bound matters because nothing in the delivery path has a timeout: if a
 * gateway hangs, the pulse hangs, and teardown would wait forever. Returns
 * whether the pulse actually settled, so the caller can mark the run's
 * artifacts as possibly incomplete rather than pretend it finished cleanly.
 */
export async function drainInFlight(inFlight: InFlight, timeoutMs: number): Promise<boolean> {
  const pending = inFlight.current;
  if (!pending) return true;

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const outcome = await Promise.race([pending.then(() => "settled" as const).catch(() => "settled" as const), timeout]);
    return outcome === "settled";
  } finally {
    if (timer) clearTimeout(timer);
  }
}
