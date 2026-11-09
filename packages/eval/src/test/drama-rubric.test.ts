import { describe, it, expect } from "vitest";
import { DRAMA_AXES, DRAMA_FAILURE_CODES, DRAMA_RUBRIC, axesForFailureCode, renderRubricPrompt } from "../drama/index.js";

describe("DRAMA_RUBRIC", () => {
  it("has one spec per drama axis, in axis order", () => {
    expect(DRAMA_RUBRIC.map((a) => a.id)).toEqual([...DRAMA_AXES]);
  });

  it.each(DRAMA_RUBRIC.map((a) => [a.id, a] as const))("%s has a question, three anchors and a not-applicable rule", (_id, spec) => {
    expect(spec.question.endsWith("?")).toBe(true);
    for (const level of [1, 3, 5] as const) expect(spec.anchors[level].length).toBeGreaterThan(40);
    expect(spec.notApplicableWhen.length).toBeGreaterThan(20);
  });

  it("anchors are checkable: each one carries a number or a named log event", () => {
    const checkable = /\d|act_started|act_reaction|actor_death/;
    for (const spec of DRAMA_RUBRIC) {
      for (const level of [1, 3, 5] as const) {
        expect(spec.anchors[level], `${spec.id} anchor ${level}`).toMatch(checkable);
      }
    }
  });

  it("maps only D-codes that exist, and every D-code is read by at least one axis", () => {
    const ids: string[] = DRAMA_FAILURE_CODES.map((c) => c.id);
    for (const spec of DRAMA_RUBRIC) for (const code of spec.failureCodes) expect(ids).toContain(code);
    for (const id of ids) expect(axesForFailureCode(id).length, id).toBeGreaterThan(0);
  });

  it("axesForFailureCode answers with the axes that list the code, and nothing for an unknown code", () => {
    expect(axesForFailureCode("D3")).toEqual(["escalation_arc"]);
    expect(axesForFailureCode("D9")).toEqual([]);
  });
});

describe("renderRubricPrompt", () => {
  const text = renderRubricPrompt();

  it("is deterministic", () => {
    expect(renderRubricPrompt()).toBe(text);
  });

  it("carries every axis id, question, anchor and not-applicable rule verbatim", () => {
    for (const spec of DRAMA_RUBRIC) {
      expect(text).toContain(spec.id);
      expect(text).toContain(spec.question);
      expect(text).toContain(spec.anchors[1]);
      expect(text).toContain(spec.anchors[3]);
      expect(text).toContain(spec.anchors[5]);
      expect(text).toContain(spec.notApplicableWhen);
    }
  });

  it("lists every failure code with its definition and the axes that read it", () => {
    for (const code of DRAMA_FAILURE_CODES) {
      expect(text).toContain(`${code.id} ${code.slug}: ${code.definition}`);
    }
    expect(text).toContain("D3 skipped_ladder_rung");
    expect(text).toMatch(/D3 skipped_ladder_rung: .*\(read by escalation_arc\)/);
  });
});
