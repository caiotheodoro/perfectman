import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bedVolume, buildTimeline, sampleTimeline } from "@perfectman/shared";
import { bedTargets, FilmAudio, moodAt, stepToward } from "../film-audio.js";
import { tinyReplay } from "./replay-fixture.js";

class FakeAudio {
  static made: FakeAudio[] = [];
  volume = 1;
  loop = false;
  preload = "";
  paused = true;
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

  it("wants exactly one bed, and none when sound is off or the film is paused", () => {
    const on = bedTargets("tension", true);

    expect(on.tension).toBe(bedVolume("tension"));
    expect(on.calm).toBe(0);
    expect(on.warmth).toBe(0);
    expect(Object.values(bedTargets("tension", false)).every((v) => v === 0)).toBe(true);
  });
});

const bed = (file: string): FakeAudio => FakeAudio.made.find((a) => a.src.endsWith(file))!;

describe("FilmAudio", () => {
  const T = buildTimeline(tinyReplay());
  T.moods = [{ t: 0, mood: "calm" }, { t: 20, mood: "tension" }];
  const at = (t: number) => sampleTimeline(T, t);

  it("fades the bed in over about two seconds and out again when paused", () => {
    const a = new FilmAudio((id) => ["ana", "bruno", "carla"].indexOf(id));
    a.setSound(true);
    const calm = bed("calm-social.mp3");
    expect(FakeAudio.made.filter((x) => x.src.endsWith(".mp3"))).toHaveLength(3);

    for (let t = 0; t < 1; t += 0.1) a.frame(T, at(t), t, t + 0.1, 0.1, true);
    const half = calm.volume;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(bedVolume("calm") * 0.7);
    expect(calm.paused).toBe(false);

    for (let t = 1; t < 3; t += 0.1) a.frame(T, at(t), t, t + 0.1, 0.1, true);
    expect(calm.volume).toBeCloseTo(bedVolume("calm"), 3);

    for (let t = 3; t < 6; t += 0.1) a.frame(T, at(t), t, t + 0.1, 0.1, false);
    expect(calm.volume).toBe(0);
    expect(calm.paused).toBe(true);
    a.destroy();
  });

  it("crossfades to the next bed when the room's mood changes", () => {
    const a = new FilmAudio(() => 0);
    a.setSound(true);
    const calm = bed("calm-social.mp3"), tension = bed("tension-conflict.mp3");
    for (let t = 0; t < 19; t += 0.1) a.frame(T, at(t), t, t + 0.1, 0.1, true);
    expect(calm.volume).toBeGreaterThan(0);
    expect(tension.volume).toBe(0);

    for (let t = 20; t < 24; t += 0.1) a.frame(T, at(t), t, t + 0.1, 0.1, true);
    expect(tension.volume).toBeGreaterThan(0);
    expect(calm.volume).toBe(0);
    a.destroy();
  });

  it("stays silent until sound is turned on", () => {
    const a = new FilmAudio(() => 0);
    for (let t = 0; t < 3; t += 0.1) a.frame(T, at(t), t, t + 0.1, 0.1, true);

    expect(FakeAudio.made.filter((x) => x.src.endsWith(".mp3"))).toHaveLength(0);
    a.destroy();
  });
});
