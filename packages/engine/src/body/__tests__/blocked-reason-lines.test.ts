import { describe, expect, it } from "vitest";
import { blockedReasonLine } from "../blocked-reason-lines.js";

/** An act the ladder refused for want of a motive or a grievance is told to the model, in its own words, with what would earn it (errata P7). */
describe("blockedReasonLine for the ladder", () => {
  it("says a move is not yet earned when the motive is missing, naming who it was aimed at, in both languages", () => {
    expect(blockedReasonLine({ code: "ladder", part: "act", detail: "motive", ref: "Goulart" }, "pt-BR")).toBe(
      'Ainda não dá pra partir pra cima de "Goulart": falta provocação. Comece com um olhar ou uma ofensa, um passo de cada vez.',
    );
    expect(blockedReasonLine({ code: "ladder", part: "act", detail: "motive", ref: "Goulart" }, "en")).toContain("Goulart");
    expect(blockedReasonLine({ code: "ladder", part: "act", detail: "motive", ref: "Goulart" }, "en")).toContain("one step at a time");
  });

  it("says what would earn it when the grievance is missing: say it to their face first", () => {
    expect(blockedReasonLine({ code: "ladder", part: "act", detail: "grievance", ref: "Caio" }, "pt-BR")).toContain("Diga na cara");
    expect(blockedReasonLine({ code: "ladder", part: "act", detail: "grievance", ref: "Caio" }, "en")).toContain("Say to their face");
  });

  it("is one short line, and a refusal with no name still reads", () => {
    for (const detail of ["motive", "grievance"]) {
      for (const lang of ["pt-BR", "en"] as const) {
        const line = blockedReasonLine({ code: "ladder", detail }, lang)!;
        expect(line.length).toBeGreaterThan(20);
        expect(line.length).toBeLessThan(170);
        expect(line.includes("\n")).toBe(false);
      }
    }
  });

  it("stays silent about the ladder's other refusals: the ceiling, contagion, the rung: the director decides those", () => {
    for (const detail of ["max_rung", "contagion", "rung", undefined]) expect(blockedReasonLine({ code: "ladder", part: "act", ...(detail ? { detail } : {}) }, "en")).toBeUndefined();
  });
});
