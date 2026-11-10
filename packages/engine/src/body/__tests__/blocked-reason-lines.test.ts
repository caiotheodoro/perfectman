import { describe, expect, it } from "vitest";
import { applySpaceAction } from "../../space/space-reducer.js";
import { loungeModel, person, T0, viewOf } from "../../space/__tests__/fixture.js";
import { buildBodyPerception } from "../../perception/build-body-perception.js";
import { compressBodyPerception, renderBodyBlock } from "../../perception/render-body-perception.js";
import { blockedReasonLine } from "../blocked-reason-lines.js";

/**
 * An act the ladder refused is told to the model, in its own words, with what would earn it (errata P7, P8): a missing motive or grievance (what to say to whom), a skipped
 * rung, a blow nobody would see, a room already on fire. The ceiling and the spacing between blows stay unshown.
 */
describe("blockedReasonLine for the ladder", () => {
  it("says a move is not yet earned when the motive is missing, naming who it was aimed at and what earns it (a direct insult with their name), in both languages", () => {
    expect(blockedReasonLine({ code: "ladder", part: "act", detail: "motive", ref: "Goulart" }, "pt-BR")).toBe(
      'Ainda não dá pra partir pra cima de "Goulart": falta provocação. Uma ofensa direta com o nome da pessoa esquenta. Um passo de cada vez.',
    );
    const en = blockedReasonLine({ code: "ladder", part: "act", detail: "motive", ref: "Goulart" }, "en")!;
    expect(en).toContain("Goulart");
    expect(en).toContain("direct insult");
    expect(en).toContain("One step at a time");
  });

  it("says what would earn it when the grievance is missing: a threat or an accusation to their face, with their name", () => {
    expect(blockedReasonLine({ code: "ladder", part: "act", detail: "grievance", ref: "Caio" }, "pt-BR")).toContain("ameaça ou acusação na cara");
    expect(blockedReasonLine({ code: "ladder", part: "act", detail: "grievance", ref: "Caio" }, "en")).toContain("threat or an accusation to their face");
  });

  it("a skipped rung is told too: one step at a time, a look or an insult first", () => {
    expect(blockedReasonLine({ code: "ladder", part: "act", detail: "rung", ref: "Caio" }, "pt-BR")).toBe('Um passo de cada vez com "Caio": antes um olhar ou uma ofensa.');
    expect(blockedReasonLine({ code: "ladder", part: "act", detail: "rung", ref: "Caio" }, "en")).toContain("One step at a time");
  });

  it("no witness and a room already on fire are told: not with nobody watching, wait for it to cool", () => {
    expect(blockedReasonLine({ code: "ladder", part: "act", detail: "zero_witness", ref: "Caio" }, "pt-BR")).toContain("Não com ninguém olhando");
    expect(blockedReasonLine({ code: "ladder", part: "act", detail: "zero_witness", ref: "Caio" }, "en")).toContain("nobody watching");
    expect(blockedReasonLine({ code: "ladder", part: "act", detail: "contagion", ref: "Caio" }, "pt-BR")).toContain("pegando fogo");
    expect(blockedReasonLine({ code: "ladder", part: "act", detail: "contagion", ref: "Caio" }, "en")).toContain("on fire");
  });

  it("is one short line, and a refusal with no name still reads", () => {
    for (const detail of ["motive", "grievance", "rung", "zero_witness", "contagion"]) {
      for (const lang of ["pt-BR", "en"] as const) {
        const line = blockedReasonLine({ code: "ladder", detail }, lang)!;
        expect(line.length, `${detail} ${lang}`).toBeGreaterThan(20);
        expect(line.length, `${detail} ${lang}`).toBeLessThan(200);
        expect(line.includes("\n")).toBe(false);
      }
    }
  });

  it("stays silent about the ceiling and a ladder refusal with no detail: the director decides those", () => {
    for (const detail of ["max_rung", "cooldown", undefined]) expect(blockedReasonLine({ code: "ladder", part: "act", ...(detail ? { detail } : {}) }, "en")).toBeUndefined();
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
