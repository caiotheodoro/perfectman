import { describe, expect, it } from "vitest";
import { ACTOR_CHAT_PER_WINDOW, ACTOR_CHAT_WINDOW_MS, ChatPacer } from "../run/replay-pacing.js";

/** What the hotel does: 4 chat lines per 6 s per actor, the rest are `rate_limited`. */
function hotelAccepts(times: number[], max = ACTOR_CHAT_PER_WINDOW, windowMs = ACTOR_CHAT_WINDOW_MS): number {
  const window: number[] = [];
  let ok = 0;
  for (const at of times) {
    while (window.length > 0 && at - (window[0] ?? 0) > windowMs) window.shift();
    if (window.length >= max) continue;
    window.push(at);
    ok += 1;
  }
  return ok;
}

/** Plays `due` (when each line was meant to go) through the pacer on a virtual clock and returns when each went. */
function play(due: number[]): number[] {
  const pacer = new ChatPacer();
  const sent: number[] = [];
  let now = 0;
  for (const at of due) {
    now = Math.max(now, at);
    for (let w = pacer.waitMs(now); w > 0; w = pacer.waitMs(now)) now += w;
    pacer.record(now);
    sent.push(now);
  }
  return sent;
}

describe("replay chat pacing", () => {
  it("lets a recorded pace through untouched", () => {
    const due = [0, 2000, 4000, 6500, 9000, 12000];
    expect(play(due)).toEqual(due);
  });

  it("holds lines a 4x replay would have dropped, and the hotel takes every one", () => {
    // 20 lines 1.2 s apart in the recording, squeezed to 0.3 s by a 4x replay
    const due = Array.from({ length: 20 }, (_, i) => i * 300);
    expect(hotelAccepts(due)).toBeLessThan(20);
    const sent = play(due);
    expect(hotelAccepts(sent)).toBe(20);
    expect(sent).toEqual([...sent].sort((a, b) => a - b));
    for (let i = 4; i < sent.length; i += 1) expect((sent[i] ?? 0) - (sent[i - 4] ?? 0)).toBeGreaterThan(ACTOR_CHAT_WINDOW_MS);
  });

  it("never holds the first four lines of a burst", () => {
    expect(play([0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
    expect((play([0, 0, 0, 0, 0])[4] ?? 0)).toBeGreaterThan(ACTOR_CHAT_WINDOW_MS);
  });
});
