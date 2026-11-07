/** All time in this package comes through a Clock, so tests never sleep. */
export type TimerHandle = { cancel(): void };

export interface Clock {
  now(): number;
  setTimer(fn: () => void, ms: number): TimerHandle;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimer(fn, ms) {
    const t = setTimeout(fn, Math.max(0, ms));
    return { cancel: () => clearTimeout(t) };
  },
};

/** Resolves after `ms`, or early (false) when `signal` aborts. */
export function sleepOn(clock: Clock, ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) return resolve(false);
    const onAbort = (): void => {
      timer.cancel();
      resolve(false);
    };
    const timer = clock.setTimer(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
