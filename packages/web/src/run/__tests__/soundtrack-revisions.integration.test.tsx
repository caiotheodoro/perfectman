import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { StageBeat } from "@perfectman/shared";
import { useSoundtrack } from "../useSoundtrack.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("updates the music for a revised emotion without repeating the message cue", () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  vi.stubGlobal("localStorage", { getItem: () => null });
  const played: string[] = [];
  // Audio and animation output are I/O sinks; record only which media play.
  vi.stubGlobal("Audio", class {
    paused = true;
    volume = 0;
    constructor(public src = "") {}
    play() { this.paused = false; played.push(this.src); return Promise.resolve(); }
    pause() { this.paused = true; }
  });
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  const line: StageBeat = {
    id: "same-line", kind: "message", pulseIndex: 0, channelId: "room", actorId: "iris",
    text: "Already here", audienceIds: [], participantIds: ["iris"], duration: 3, page: 0,
  };
  const { rerender } = renderHook(({ beat }) => useSoundtrack(beat, true, true), { initialProps: { beat: line } });
  rerender({ beat: { ...line, emotion: { source: "snapshot", values: { anger: 0.95, valence: -0.8, arousal: 0.9 } } } });
  expect(played).toEqual(["/audio/calm-social.mp3", "/audio/message.ogg", "/audio/tension-conflict.mp3"]);
});
