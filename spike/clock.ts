/**
 * Two interchangeable clocks:
 *  - VirtualClock: discrete-event, deterministic, ~1000x faster than wall time. Real CPU work still
 *    happens (the scheduler, engine steps, repos) but sleeps cost nothing. Date.now is patched to it.
 *  - RealClock: plain setTimeout, used for a short validation run and the event-loop-lag measurement.
 */
export interface Clock {
  now(): number; // ms since run start
  sleep(ms: number): Promise<void>;
  withDeadline<T>(p: Promise<T>, ms: number): Promise<T>;
}

type Timer = { at: number; seq: number; fn: () => void; cancelled: boolean };

export class VirtualClock implements Clock {
  private t = 0;
  private seq = 0;
  private heap: Timer[] = [];
  /** real ms spent processing each virtual instant (proxy for event-loop blocking) */
  readonly busyMs: number[] = [];

  now(): number {
    return this.t;
  }

  private push(ms: number, fn: () => void): Timer {
    const timer: Timer = { at: this.t + Math.max(0, ms), seq: this.seq++, fn, cancelled: false };
    this.heap.push(timer);
    return timer;
  }

  sleep(ms: number): Promise<void> {
    return new Promise((r) => this.push(ms, r));
  }

  withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = this.push(ms, () => reject(new Error(`deadline ${ms}ms`)));
      p.then(
        (v) => { timer.cancelled = true; resolve(v); },
        (e) => { timer.cancelled = true; reject(e); },
      );
    });
  }

  private popEarliest(): Timer | undefined {
    let bi = -1;
    for (let i = 0; i < this.heap.length; i++) {
      const c = this.heap[i]!;
      if (c.cancelled) continue;
      const b = bi < 0 ? undefined : this.heap[bi]!;
      if (!b || c.at < b.at || (c.at === b.at && c.seq < b.seq)) bi = i;
    }
    if (bi < 0) { this.heap = []; return undefined; }
    const [t] = this.heap.splice(bi, 1);
    if (this.heap.length > 256) this.heap = this.heap.filter((x) => !x.cancelled);
    return t;
  }

  private async drain(): Promise<void> {
    await new Promise<void>((r) => setImmediate(r));
  }

  /** advance virtual time until `until()` is true or no timers remain */
  async runUntil(until: () => boolean): Promise<void> {
    await this.drain();
    while (!until()) {
      const next = this.popEarliest();
      if (!next) break;
      this.t = next.at;
      const t0 = performance.now();
      next.fn();
      await this.drain();
      this.busyMs.push(performance.now() - t0);
    }
  }
}

export class RealClock implements Clock {
  private t0 = Date.now();
  now(): number { return Date.now() - this.t0; }
  sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
  withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const h = setTimeout(() => reject(new Error(`deadline ${ms}ms`)), ms);
      p.then((v) => { clearTimeout(h); resolve(v); }, (e) => { clearTimeout(h); reject(e); });
    });
  }
}
