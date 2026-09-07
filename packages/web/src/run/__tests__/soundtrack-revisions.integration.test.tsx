import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StageBeat } from "@perfectman/shared";
import { useSoundtrack } from "../useSoundtrack.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

let played: string[];
let sounds: Array<{ src: string; paused: boolean }>;
const line: StageBeat = {
  id: "same-line", kind: "message", pulseIndex: 0, channelId: "room", actorId: "iris",
  text: "Already here", audienceIds: [], participantIds: ["iris"], duration: 3, page: 0,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
  played = [];
  sounds = [];
  // Audio, preference writes and animation are I/O sinks; observe media output.
  vi.stubGlobal("Audio", class {
    paused = true;
    volume = 0;
    constructor(public src = "") { sounds.push(this); }
    play() { this.paused = false; played.push(this.src); return Promise.resolve(); }
    pause() { this.paused = true; }
  });
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

it("updates the music for a revised emotion without repeating the message cue", () => {
  const { rerender } = renderHook(({ beat }) => useSoundtrack(beat, true, true), { initialProps: { beat: line } });
  rerender({ beat: { ...line, emotion: { source: "snapshot", values: { anger: 0.95, valence: -0.8, arousal: 0.9 } } } });
  expect(played).toEqual(["/audio/calm-social.mp3", "/audio/message.ogg", "/audio/tension-conflict.mp3"]);
});

it.each(["hidden", "muted"])("stops an in-flight cue when the scene becomes %s", (reason) => {
  const { result, rerender } = renderHook(({ active }) => useSoundtrack(line, active, true), { initialProps: { active: true } });
  const cue = sounds.find((sound) => sound.src === "/audio/message.ogg");
  expect(cue?.paused).toBe(false);
  if (reason === "hidden") rerender({ active: false });
  else act(() => result.current.toggle());
  expect(cue?.paused).toBe(true);
});
