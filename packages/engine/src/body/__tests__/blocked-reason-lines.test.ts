import { describe, expect, it } from "vitest";
import { applySpaceAction } from "../../space/space-reducer.js";
import { loungeModel, person, T0, viewOf } from "../../space/__tests__/fixture.js";
import { buildBodyPerception } from "../../perception/build-body-perception.js";
import { compressBodyPerception, renderBodyBlock } from "../../perception/render-body-perception.js";
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

describe("the note reaches the prompt's body block", () => {
  it("a ladder refusal in the body's lastBlocked is a Blocked line, in the room's language, and compression never drops it", () => {
    const model = loungeModel([person("a1", "Ana", [5, 4]), person("a2", "Goulart", [6, 4])], ["a1", "a2"]);
    applySpaceAction(model, { type: "agent_body", agentId: "a1", patch: { lastBlocked: [{ code: "ladder", part: "act", detail: "motive", ref: "Goulart" }] } });
    const built = buildBodyPerception({ view: viewOf(model, "a1", T0 + 1000), events: [], language: "pt-BR" });
    const lines = renderBodyBlock(built.body, { language: "pt-BR" });
    expect(lines.find((l) => l.startsWith("Bloqueado:"))).toContain("falta provocação");
    for (const level of [1, 2, 3] as const) expect(renderBodyBlock(compressBodyPerception(built.body, level), { language: "pt-BR" }).some((l) => l.includes("falta provocação"))).toBe(true);
    // The ladder's other refusals say nothing: no Blocked line at all.
    applySpaceAction(model, { type: "agent_body", agentId: "a1", patch: { lastBlocked: [{ code: "ladder", part: "act", detail: "max_rung" }] } });
    const quiet = buildBodyPerception({ view: viewOf(model, "a1", T0 + 1000), events: [], language: "en" });
    expect(renderBodyBlock(quiet.body, { language: "en" }).some((l) => l.startsWith("Blocked:"))).toBe(false);
  });
});
