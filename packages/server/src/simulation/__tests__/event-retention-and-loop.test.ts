import { describe, it, expect, vi } from "vitest";
import { InMemoryEventRepository } from "../in-memory-stores.js";
import { WallClockPulseLoop, type LoopClock } from "../wall-clock-pulse-loop.js";
import type { SimulationEvent } from "@perfectman/shared";

const event = (n: number, over: Partial<SimulationEvent> = {}): SimulationEvent => ({
  simulationId: "s",
  channelId: "c",
  actorId: "a1",
  type: "message_sent",
  payload: { n },
  sourceEventIds: [],
  emotionalSalience: "low",
  pulseIndex: Math.floor(n / 4),
  visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" },
  ...over,
});

describe("bounded in-memory event store (ADR-0024)", () => {
  it("unbounded by default: an unknown cursor still rejects, as before", async () => {
    const repo = new InMemoryEventRepository();
    await repo.append("s", [event(0)]);
    await expect(repo.getAfter("s", "nope")).rejects.toThrow(/not found/);
  });

  it("evicts past the window, streams the evicted to the sink, and returns the window start for an evicted cursor", async () => {
    const evicted: string[] = [];
    const repo = new InMemoryEventRepository({ maxRetained: 100, onEvict: (_s, es) => evicted.push(...es.map((e) => e.id)) });
    const first = (await repo.append("s", [event(0)]))[0]!;
    for (let i = 1; i < 400; i++) await repo.append("s", [event(i)]);
    const kept = await repo.getAfter("s");
    expect(kept.length).toBeLessThanOrEqual(164); // window plus the eviction slack (64)
    expect(kept.length).toBeGreaterThanOrEqual(100);
    expect(evicted.length + kept.length).toBe(400); // nothing lost: the sink gets the rest
    expect(evicted[0]).toBe(first.id);
    expect(await repo.getById("s", first.id)).toBeNull();
    const gap = await repo.getAfter("s", first.id); // evicted cursor: window start, no rejection
    expect(gap).toHaveLength(kept.length);
    const tail = kept.at(-5)!;
    expect((await repo.getAfter("s", tail.id)).map((e) => e.payload["n"])).toEqual([396, 397, 398, 399].slice(-4));
  });

  it("getWindow returns the last visible events, each agent's last messages and everything since a pulse, in log order", async () => {
    const repo = new InMemoryEventRepository({ maxRetained: 1000 });
    const hidden = { visibleToAgents: [], visibleToSpectators: false, visibleToOperators: true, visibilityReason: "operator_only" } as const;
    for (let i = 0; i < 60; i++) {
      await repo.append("s", [event(i, { actorId: i % 2 === 0 ? "a1" : "a2" }), event(1000 + i, { type: "no_op_recorded", visibility: hidden, pulseIndex: 0 })]);
    }
    const win = await repo.getWindow("s", { contextLimit: 5, ownHistoryLimit: 2, agentIds: ["a1", "a2"], sincePulseIndex: 1000 });
    const visible = win.filter((e) => e.visibility.visibilityReason !== "operator_only").map((e) => e.payload["n"]);
    expect(visible.slice(-5)).toEqual([55, 56, 57, 58, 59]); // the last 5 visible are in
    const ids = win.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const full = await repo.getAfter("s");
    expect(ids).toEqual(full.filter((e) => ids.includes(e.id)).map((e) => e.id)); // log order
  });
});

class FakeClock implements LoopClock {
  t = 0;
  private timers: Array<{ at: number; fn: () => void; id: number; live: boolean }> = [];
  private nextId = 1;
  now(): number { return this.t; }
  setTimeout(fn: () => void, ms: number): unknown {
    const timer = { at: this.t + ms, fn, id: this.nextId++, live: true };
    this.timers.push(timer);
    return timer;
  }
  clearTimeout(handle: unknown): void { (handle as { live: boolean }).live = false; }
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.live && x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      due.live = false;
      this.t = due.at;
      due.fn();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    }
    this.t = end;
  }
}

describe("WallClockPulseLoop (ADR-0024, D52)", () => {
  function make(runPulse = vi.fn(() => Promise.resolve({ pulseIndex: 0, eventsCommitted: 0, agentsCalled: 0 }))) {
    const clock = new FakeClock();
    const loop = new WallClockPulseLoop({ runtime: { runPulse }, simulationId: "s", clock });
    return { clock, loop, runPulse };
  }

  it("beats every 6 s without drift and tells each pulse the wall time since the previous one", async () => {
    const { clock, loop, runPulse } = make();
    loop.start();
    await clock.advance(18_100);
    expect(runPulse.mock.calls.map((c) => c[1])).toEqual([
      { reason: "base", elapsedMs: 6000 },
      { reason: "base", elapsedMs: 6000 },
      { reason: "base", elapsedMs: 6000 },
    ]);
  });

  it("skips beats an overrunning pulse missed instead of bursting", async () => {
    let release: () => void = () => undefined;
    const runPulse = vi
      .fn<(s: string, o?: unknown) => Promise<{ pulseIndex: number; eventsCommitted: number; agentsCalled: number }>>()
      .mockImplementationOnce(() => new Promise((r) => { release = () => r({ pulseIndex: 0, eventsCommitted: 0, agentsCalled: 0 }); }))
      .mockResolvedValue({ pulseIndex: 1, eventsCommitted: 0, agentsCalled: 0 });
    const { clock, loop } = make(runPulse);
    loop.start();
    await clock.advance(25_000); // first pulse still open through four beats
    expect(runPulse).toHaveBeenCalledTimes(1);
    release();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await clock.advance(5_000); // next beat is at 30 s on the original timeline
    expect(runPulse).toHaveBeenCalledTimes(2);
  });

  it("fires the first human line at once and merges the next ones within 300 ms into one follow-up", async () => {
    const { clock, loop, runPulse } = make();
    loop.start();
    await clock.advance(1_000);
    loop.requestFocused(["a1"]);
    expect(runPulse).toHaveBeenCalledTimes(1);
    expect(runPulse.mock.calls[0]![1]).toMatchObject({ reason: "human_chat", focusAgentIds: ["a1"], elapsedMs: 1000 });
    await clock.advance(100);
    loop.requestFocused(["a2"]);
    loop.requestFocused(["a3", "a2"]);
    expect(runPulse).toHaveBeenCalledTimes(1);
    await clock.advance(250);
    expect(runPulse).toHaveBeenCalledTimes(2);
    expect(runPulse.mock.calls[1]![1]).toMatchObject({ reason: "human_chat", focusAgentIds: ["a2", "a3"] });
  });

  it("pause stops both lanes, resume starts a fresh interval, and a paused loop refuses focus", async () => {
    const { clock, loop, runPulse } = make();
    loop.start();
    await clock.advance(6_100);
    loop.pause();
    expect(loop.requestFocused(["a1"])).toBe(false);
    await clock.advance(60_000);
    expect(runPulse).toHaveBeenCalledTimes(1);
    loop.resume();
    await clock.advance(6_100);
    expect(runPulse).toHaveBeenCalledTimes(2);
    expect(runPulse.mock.calls[1]![1]).toMatchObject({ reason: "base", elapsedMs: 6000 }); // not the 60 s pause
    await loop.stop();
    expect(loop.getState()).toBe("stopped");
  });
});
