import { describe, expect, it } from "vitest";
import { mockBody } from "../llm/mock-body.js";
import { hashString } from "../util/stats.js";

const ids = ["person-1", "person-2", "person-3"];
const sitter = ids.find((id) => hashString(id) % 2 === 0) as string;
const other = ids.find((id) => hashString(id) % 2 === 1) as string;

describe("mockBody", () => {
  it("asks a sitter to sit on every consult from the third to the eleventh, so a consult lost to a discarded call or an actor still at the door does not lose the sit", () => {
    for (let n = 3; n < 12; n++) expect(mockBody(sitter, n)?.posture).toEqual({ pose: "sit" });
  });

  it("does not ask before the third consult, and stands the sitter up on the twelfth", () => {
    expect(mockBody(sitter, 1)).toBeUndefined();
    expect(mockBody(sitter, 2)).toBeUndefined();
    expect(mockBody(sitter, 12)).toEqual({ posture: { pose: "stand" } });
  });

  it("never asks the other half of the cast to sit; it waves every ninth consult", () => {
    for (let n = 1; n < 40; n++) expect(mockBody(other, n)?.posture).toBeUndefined();
    expect(mockBody(other, 9)).toEqual({ gesture: { kind: "wave" } });
  });
});
