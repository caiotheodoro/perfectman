import { describe, it, expect } from "vitest";
import { ENGINE_MOTIVE_PREFIXES, isEngineAuthoredMotive } from "../engine-motive.js";
import { REPETITION_GUARD_MARKER } from "../repetition-guard.js";

describe("isEngineAuthoredMotive", () => {
  it("recognizes every documented engine prefix", () => {
    for (const prefix of ENGINE_MOTIVE_PREFIXES) {
      expect(isEngineAuthoredMotive(`${prefix} some detail`)).toBe(true);
    }
  });

  it("recognizes the repetition guard's own marker form", () => {
    expect(isEngineAuthoredMotive(`${REPETITION_GUARD_MARKER}: blocked near-duplicate after 1 retry`)).toBe(true);
  });

  it("treats a model-written motive as the character's own", () => {
    expect(isEngineAuthoredMotive("I want them to think I am calm while I count the exits")).toBe(false);
    expect(isEngineAuthoredMotive("")).toBe(false);
  });
});
