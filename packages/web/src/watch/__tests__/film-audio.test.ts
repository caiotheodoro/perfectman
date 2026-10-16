import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bedVolume, buildTimeline, LIBRARY, playlist, sampleTimeline, type Bed, type Mood } from "@perfectman/shared";
import { FilmAudio, moodAt, stepToward } from "../film-audio.js";
import { tinyReplay } from "./replay-fixture.js";

class FakeAudio {
  static made: FakeAudio[] = [];
  volume = 1;
  preload = "";
  paused = true;
  currentTime = 0;
  duration = Number.NaN;
  src: string;
  constructor(src = "") { this.src = src; FakeAudio.made.push(this); }
  play(): Promise<void> { this.paused = false; return Promise.resolve(); }
  pause(): void { this.paused = true; }
}

beforeEach(() => {
  FakeAudio.made = [];
  vi.stubGlobal("Audio", FakeAudio);
});
afterEach(() => vi.unstubAllGlobals());

describe("pure helpers", () => {
  it("moves toward a target and never past it", () => {
    expect(stepToward(0, 1, 0.25)).toBe(0.25);
    expect(stepToward(0.9, 1, 0.25)).toBe(1);
    expect(stepToward(1, 0, 0.4)).toBeCloseTo(0.6, 5);
    expect(stepToward(0.1, 0, 0.4)).toBe(0);
  });

  it("picks the latest mood change not after the moment", () => {
    const moods = [{ t: 0, mood: "calm" as const }, { t: 10, mood: "tension" as const }, { t: 30, mood: "warmth" as const }];

    expect(moodAt(moods, 5)).toBe("calm");
    expect(moodAt(moods, 10)).toBe("tension");
    expect(moodAt(moods, 99)).toBe("warmth");
    expect(moodAt([], 5)).toBe("calm");
  });
});

const SEED = "fixed";
const first = (mood: Mood): Bed => playlist(mood, SEED)[0]!;
const second = (mood: Mood): Bed => playlist(mood, SEED)[1]!;
const el = (bed: Bed): FakeAudio | undefined => FakeAudio.made.find((a) => a.src.endsWith(bed.file));
const mp3s = (): FakeAudio[] => FakeAudio.made.filter((x) => x.src.endsWith(".mp3"));

describe("the music library", () => {
  it("has several tracks for every mood, each one a distinct file", () => {
    for (const mood of ["calm", "tension", "warmth"] as const) {
      expect(LIBRARY[mood].length).toBeGreaterThanOrEqual(3);
      expect(new Set(LIBRARY[mood].map((b) => b.file)).size).toBe(LIBRARY[mood].length);
    }
  });

  it("starts different runs on different tracks, and the same run on the same one", () => {
    const starts = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => playlist("calm", s)[0]!.file));
    expect(starts.size).toBeGreaterThan(1);
    expect(playlist("calm", "same")[0]!.file).toBe(playlist("calm", "same")[0]!.file);
  });
});

describe("FilmAudio", () => {
  const T = buildTimeline(tinyReplay());
  T.moods = [{ t: 0, mood: "calm" }, { t: 20, mood: "tension" }, { t: 40, mood: "calm" }];
  const at = (t: number) => sampleTimeline(T, t);
  const run = (a: FilmAudio, from: number, to: number, playing = true): void => { for (let t = from; t < to; t += 0.1) a.frame(T, at(t), t, t + 0.1, 0.1, playing); };

  it("fades the bed in over about two seconds and out again when paused", () => {
    const a = new FilmAudio((id) => ["ana", "bruno", "carla"].indexOf(id), SEED);
    a.setSound(true);
    run(a, 0, 1);
    const calm = el(first("calm"))!;
    expect(calm.volume).toBeGreaterThan(0);
    expect(calm.volume).toBeLessThan(bedVolume(first("calm")) * 0.7);
    expect(calm.paused).toBe(false);

    run(a, 1, 3);
    expect(calm.volume).toBeCloseTo(bedVolume(first("calm")), 3);

    run(a, 3, 6, false);
    expect(calm.volume).toBe(0);
    expect(calm.paused).toBe(true);
    a.destroy();
  });

  it("loads only the track it needs, not the whole library", () => {
    const a = new FilmAudio(() => 0, SEED);
    a.setSound(true);
    run(a, 0, 5);
    expect(mp3s()).toHaveLength(1);
    a.destroy();
  });

  it("crossfades to a track of the next mood when the room's mood changes", () => {
    const a = new FilmAudio(() => 0, SEED);
    a.setSound(true);
    run(a, 0, 19);
    const calm = el(first("calm"))!;
    expect(calm.volume).toBeGreaterThan(0);
    expect(el(first("tension"))).toBeUndefined();

    run(a, 20, 24);
    expect(el(first("tension"))!.volume).toBeGreaterThan(0);
    expect(calm.volume).toBe(0);
    a.destroy();
  });

  it("plays a different track when a mood comes back", () => {
    const a = new FilmAudio(() => 0, SEED);
    a.setSound(true);
    run(a, 0, 44);
    expect(el(first("calm"))!.volume).toBe(0);
    expect(el(second("calm"))!.volume).toBeGreaterThan(0);
    a.destroy();
  });

  it("moves on to the next track of the same mood when one is nearly over", () => {
    const a = new FilmAudio(() => 0, SEED);
    a.setSound(true);
    run(a, 0, 5);
    const one = el(first("calm"))!;
    one.duration = 100;
    one.currentTime = 98;
    run(a, 5, 9);
    expect(el(second("calm"))!.volume).toBeGreaterThan(0);
    expect(one.volume).toBeLessThan(bedVolume(first("calm")));
    a.destroy();
  });

  it("stays silent until sound is turned on", () => {
    const a = new FilmAudio(() => 0, SEED);
    run(a, 0, 3);

    expect(mp3s()).toHaveLength(0);
    a.destroy();
  });
});
