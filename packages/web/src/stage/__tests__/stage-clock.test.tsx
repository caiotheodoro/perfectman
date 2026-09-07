/**
 * The clock's high-water mark. `behind` is how deep the queue is from where
 * you are; `reached` is how far you have ever been. The sheet draws up to
 * `reached` and leaves the rest blank, so seeking back must not un-draw.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StageBeat } from "@perfectman/shared";
import { useStageClock } from "../useStageClock.js";

function beat(id: string): StageBeat {
  return {
    id, kind: "message", pulseIndex: 0, channelId: "c", actorId: "a", text: id,
    audienceIds: [], participantIds: ["a"], duration: 99, page: 0,
  };
}
const BEATS = ["a", "b", "c", "d"].map(beat);

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
