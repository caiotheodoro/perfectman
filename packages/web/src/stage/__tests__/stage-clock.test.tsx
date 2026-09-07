/**
 * The clock's high-water mark. `behind` is how deep the queue is from where
 * you are; `reached` is how far you have ever been. The sheet draws up to
 * `reached` and leaves the rest blank, so seeking back must not un-draw.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StageBeat } from "@perfectman/shared";
import { useStageClock } from "../useStageClock.js";

function beat(id: string): StageBeat {
  return {
    id, kind: "message", pulseIndex: 0, channelId: "c", actorId: "a", text: id,
    audienceIds: [], participantIds: ["a"], duration: 99, page: 0,
  };
}
const BEATS = ["a", "b", "c", "d"].map(beat);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useStageClock.reached", () => {
  it("starts at the first beat", () => {
    const { result } = renderHook(() => useStageClock(BEATS));
    expect(result.current.reached).toBe(0);
  });

  it("rises with a seek forward and stays up on a seek back", () => {
    const { result } = renderHook(() => useStageClock(BEATS));
    act(() => result.current.seek(3));
    expect(result.current.reached).toBe(3);
    act(() => result.current.seek(1));
    expect(result.current.index).toBe(1);
    expect(result.current.reached).toBe(3);
    expect(result.current.behind).toBe(2);
  });
});

describe("useStageClock lifecycle", () => {
  it("starts the first reading interval only when the buffered beats become visible", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ ready }) => useStageClock(BEATS, { ready, runId: "first" }),
      { initialProps: { ready: false } },
    );
    act(() => vi.advanceTimersByTime(200_000));
    rerender({ ready: true });
    act(() => vi.advanceTimersByTime(98_999));
    expect(result.current.beat?.text).toBe("a");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.beat?.text).toBe("b");
  });

  it("gives a different run its full first reading interval even when beat IDs repeat", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ runId }) => useStageClock(BEATS, { runId }),
      { initialProps: { runId: "first" } },
    );
    act(() => vi.advanceTimersByTime(90_000));
    rerender({ runId: "second" });
    act(() => vi.advanceTimersByTime(98_999));
    expect(result.current.beat?.text).toBe("a");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.beat?.text).toBe("b");
  });

  it("resets the playhead, revealed frames and paused state for a different run", () => {
    const { result, rerender } = renderHook(
      ({ runId }) => useStageClock(BEATS, { runId }),
      { initialProps: { runId: "first" } },
    );
    act(() => result.current.step(3));
    rerender({ runId: "second" });
    expect([result.current.index, result.current.reached, result.current.playing]).toEqual([0, 0, true]);
  });
});
