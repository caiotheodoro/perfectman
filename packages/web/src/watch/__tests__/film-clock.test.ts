import { describe, expect, it } from "vitest";
import { FilmClock } from "../FilmClock.js";
import { formatDuration } from "../film.js";

describe("FilmClock", () => {
  it("only moves while it is playing, and at the chosen speed", () => {
    const c = new FilmClock(100);
    c.tick(0.05);
    expect(c.t).toBe(0);

    c.toggle();
    c.tick(0.05);
    c.speed = 4;
    c.tick(0.05);
    expect(c.t).toBeCloseTo(0.25, 5);
  });

  it("treats a long gap, as a background tab leaves, as one frame", () => {
    const c = new FilmClock(100);
    c.toggle();
    c.tick(30);

    expect(c.t).toBeCloseTo(0.1, 5);
  });

  it("stops at the end and starts again from the top", () => {
    const c = new FilmClock(1);
    c.toggle();
    let ended = false;
    for (let i = 0; i < 100 && !ended; i++) ended = c.tick(0.1);

    expect(ended).toBe(true);
    expect(c.playing).toBe(false);
    expect(c.t).toBe(1);
    c.toggle();
    expect(c.t).toBe(0);
    expect(c.playing).toBe(true);
  });

  it("clamps a seek to the film", () => {
    const c = new FilmClock(10);
    c.seek(-5);
    expect(c.t).toBe(0);
    c.seek(99);
    expect(c.t).toBe(10);
  });

  it("keeps the same place in the story when the film is re-timed", () => {
    const c = new FilmClock(100);
    c.seek(25);
    c.retime(200);

    expect(c.t).toBe(50);
    expect(c.duration).toBe(200);
  });

  it("writes a duration as minutes and seconds", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(564)).toBe("9:24");
    expect(formatDuration(61.9)).toBe("1:01");
  });
});
