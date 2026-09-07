import { describe, expect, it } from "vitest";
import { isEngineAuthoredMotive } from "../engine-motive.js";

describe("isEngineAuthoredMotive", () => {
  it("filters what the engine wrote on the agent's behalf", () => {
    expect(isEngineAuthoredMotive("Fallback applied: Channel target 'x' is not permitted")).toBe(true);
    expect(isEngineAuthoredMotive("operator-directed join")).toBe(true);
    expect(isEngineAuthoredMotive("operator-directed leave")).toBe(true);
  });
  it("lets a person's own thought through", () => {
    expect(isEngineAuthoredMotive("quero fofocar no privado antes da votação")).toBe(false);
  });
});
