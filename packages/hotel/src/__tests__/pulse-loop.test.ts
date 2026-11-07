import { describe, expect, it } from "vitest";
import { ManualClock } from "../clock/manual-clock.js";
import { WallClockPulseLoop } from "../clock/wall-clock-pulse-loop.js";

type Call = { reason: string; at: number; focus?: string[]; elapsedMs?: number };

function harness(opts: { duration?: (n: number) => number } = {}) {
  const clock = new ManualClock();
  const calls: Call[] = [];
  const loop = new WallClockPulseLoop({
    clock,
    runPulse: async (o) => {
      calls.push({ reason: o.reason, at: clock.now(), ...(o.focusAgentIds ? { focus: o.focusAgentIds } : {}), ...(o.elapsedMs !== undefined ? { elapsedMs: o.elapsedMs } : {}) });
      const d = opts.duration?.(calls.length) ?? 0;
      if (d > 0) await new Promise<void>((resolve) => clock.setTimer(resolve, d));
    },
  });
  return { clock, calls, loop };
}

describe("wall-clock pulse loop", () => {
  it("fires a base pulse every 6 s without drift", async () => {
    const { clock, calls, loop } = harness();
    const t0 = clock.now();
    loop.start();
    await clock.advance(18_100);
    expect(calls.map((c) => c.at - t0)).toEqual([6000, 12_000, 18_000]);
    expect(calls.every((c) => c.reason === "base")).toBe(true);
  });

  it("does not burst to catch up after an overrunning pulse", async () => {
    const { clock, calls, loop } = harness({ duration: (n) => (n === 1 ? 15_000 : 0) });
    const t0 = clock.now();
    loop.start();
    await clock.advance(30_000);
    // First at 6 s runs until 21 s; the missed beats at 12 and 18 are skipped, the next one starts at once.
    expect(calls.slice(0, 3).map((c) => c.at - t0)).toEqual([6000, 21_000, 27_000]);
  });

  it("fires the first focused request at once and carries elapsed wall time", async () => {
    const { clock, calls, loop } = harness();
    loop.start();
    await clock.advance(2000);
    loop.requestFocused(["duda"]);
    await clock.advance(0);
    expect(calls).toEqual([{ reason: "human_chat", at: clock.now(), focus: ["duda"], elapsedMs: 2000 }]);
  });

  it("coalesces lines inside the 300 ms window into one follow-up pulse", async () => {
    const { clock, calls, loop } = harness();
    loop.start();
    loop.requestFocused(["duda"]);
    await clock.advance(100);
    loop.requestFocused(["rafa"]);
    await clock.advance(50);
    loop.requestFocused(["duda", "gabi"]);
    await clock.advance(500);
    expect(calls.map((c) => c.focus)).toEqual([["duda"], ["rafa", "duda", "gabi"]]);
    expect(calls[1]?.at).toBe(calls[0] ? calls[0].at + 300 : -1);
  });

  it("pause stops both lanes and resume restarts the cadence from now", async () => {
    const { clock, calls, loop } = harness();
    loop.start();
    await clock.advance(3000);
    loop.pause();
    loop.requestFocused(["duda"]);
    await clock.advance(20_000);
    expect(calls).toEqual([]);
    const resumedAt = clock.now();
    loop.resume();
    await clock.advance(6100);
    expect(calls.map((c) => c.at - resumedAt)).toEqual([6000]);
  });

  it("stop resolves true when idle and false when a pulse outlives the drain bound", async () => {
    const idle = harness();
    idle.loop.start();
    expect(await idle.loop.stop()).toBe(true);

    const clock = new ManualClock();
    const loop = new WallClockPulseLoop({ clock, drainTimeoutMs: 1000, runPulse: () => new Promise<void>(() => undefined) });
    loop.start();
    await clock.advance(6000);
    const stopped = loop.stop();
    await clock.advance(1000);
    expect(await stopped).toBe(false);
  });
});
