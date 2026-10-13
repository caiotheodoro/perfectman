import { describe, it, expect } from "vitest";
import { formatStoryClock, isValidStoryClockStart } from "../story-clock.js";

describe("formatStoryClock", () => {
  const clock = { start: "23:40", minutesPerPulse: 4 };

  it("opens at the scene's start time", () => {
    expect(formatStoryClock(clock, 0)).toBe("11:40pm");
  });

  it("advances by minutesPerPulse per pulse", () => {
    expect(formatStoryClock(clock, 3)).toBe("11:52pm");
  });

  it("wraps past midnight into am", () => {
    expect(formatStoryClock(clock, 5)).toBe("12:00am");
    expect(formatStoryClock(clock, 12)).toBe("12:28am");
  });

  it("reads noon as 12pm and a morning start as am", () => {
    expect(formatStoryClock({ start: "12:00", minutesPerPulse: 5 }, 0)).toBe("12:00pm");
    expect(formatStoryClock({ start: "06:05", minutesPerPulse: 5 }, 1)).toBe("6:10am");
  });
});

describe("isValidStoryClockStart", () => {
  it("accepts 24-hour HH:MM and rejects everything else", () => {
    expect(isValidStoryClockStart("23:40")).toBe(true);
    expect(isValidStoryClockStart("7:05")).toBe(true);
    expect(isValidStoryClockStart("24:00")).toBe(false);
    expect(isValidStoryClockStart("11:40pm")).toBe(false);
    expect(isValidStoryClockStart("")).toBe(false);
  });
});
