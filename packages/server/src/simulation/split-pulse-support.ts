/**
 * Concurrency primitives for the split pulse (ADR-0020). Both are tiny and
 * deterministic (FIFO within a class) so the scheduler tests can drive them
 * without timers.
 */

/** Per-agent mutual exclusion with FIFO hand-over. An agent is the unit that must not run twice at once. */
export class AgentLocks {
  private readonly queues = new Map<string, Array<() => void>>();

  isLocked(agentId: string): boolean {
    return this.queues.has(agentId);
  }

  /** Resolves with a release function once the agent is free. */
  acquire(agentId: string): Promise<() => void> {
    const release = (): void => {
      const waiters = this.queues.get(agentId);
      const next = waiters?.shift();
      if (next) next();
      else this.queues.delete(agentId);
    };
    const waiters = this.queues.get(agentId);
    if (!waiters) {
      this.queues.set(agentId, []);
      return Promise.resolve(release);
    }
    return new Promise((resolve) => waiters.push(() => resolve(release)));
  }
}

/** 0 addressed, 1 ambient, 2 fidget. Lower runs first. */
export type GeneratePriority = 0 | 1 | 2;

type Waiter = { priority: GeneratePriority; seq: number; grant: () => void };

/**
 * Bounds in-flight model calls across every lane of one run. With more than
 * one slot, one is reserved: only an addressed call may take the last free
 * slot, so a human line never queues behind ambient chatter.
 */
export class GenerateSemaphore {
  private inFlight = 0;
  private seq = 0;
  private readonly waiting: Waiter[] = [];
  private readonly total: number;
  private readonly reserved: number;

  constructor(total: number) {
    this.total = Math.max(1, Math.floor(total));
    this.reserved = this.total > 1 ? 1 : 0;
  }

  getInFlight(): number {
    return this.inFlight;
  }

  acquire(priority: GeneratePriority): Promise<() => void> {
    return new Promise((resolve) => {
      const waiter: Waiter = {
        priority,
        seq: this.seq++,
        grant: () => {
          this.inFlight += 1;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            this.inFlight -= 1;
            this.drain();
          });
        },
      };
      this.waiting.push(waiter);
      this.drain();
    });
  }

  private canStart(priority: GeneratePriority): boolean {
    return priority === 0 ? this.inFlight < this.total : this.inFlight < this.total - this.reserved;
  }

  private drain(): void {
    for (;;) {
      let pick = -1;
      for (let i = 0; i < this.waiting.length; i++) {
        const w = this.waiting[i]!;
        if (!this.canStart(w.priority)) continue;
        const best = pick === -1 ? undefined : this.waiting[pick]!;
        if (!best || w.priority < best.priority || (w.priority === best.priority && w.seq < best.seq)) pick = i;
      }
      if (pick === -1) return;
      const [waiter] = this.waiting.splice(pick, 1);
      waiter!.grant();
    }
  }
}

/**
 * Landing delay of a line in the hotel (docs/embodiment.md 8.1): a draw from
 * the persona's `responseDelayMs` plus ~55 ms per character, capped at 4 s so
 * a slow persona still lands inside the 10 s p95 target. The caller adds it to
 * the consult time and takes the max with the model's completion time.
 */
export const TYPING_MS_PER_CHAR = 55;
export const LANDING_DELAY_CAP_MS = 4_000;

export function sampleLandingDelayMs(
  responseDelayMs: readonly [number, number] | undefined,
  chars: number,
  rng: () => number = Math.random,
): number {
  const [min, max] = responseDelayMs ?? [0, 0];
  const sampled = min + (Math.max(min, max) - min) * rng();
  return Math.min(LANDING_DELAY_CAP_MS, Math.round(sampled + TYPING_MS_PER_CHAR * Math.max(0, chars)));
}
