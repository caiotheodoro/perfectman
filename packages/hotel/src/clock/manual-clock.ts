import type { Clock, TimerHandle } from "./clock.js";

type Scheduled = { at: number; seq: number; fn: () => void };

/**
 * Deterministic clock for tests. `advance` fires due timers in order and lets
 * promise continuations run between them, so code that awaits a timer and then
 * schedules the next one sees a consistent "now".
 */
export class ManualClock implements Clock {
  private t: number;
  private seq = 0;
  private timers: Scheduled[] = [];

  constructor(start = 1_000_000) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  setTimer(fn: () => void, ms: number): TimerHandle {
    const entry: Scheduled = { at: this.t + Math.max(0, ms), seq: this.seq++, fn };
    this.timers.push(entry);
    return { cancel: () => void (this.timers = this.timers.filter((x) => x !== entry)) };
  }

  pending(): number {
    return this.timers.length;
  }

  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      await flush();
      const due = this.timers.filter((x) => x.at <= target).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.t = Math.max(this.t, due.at);
      due.fn();
    }
    this.t = target;
    await flush();
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
