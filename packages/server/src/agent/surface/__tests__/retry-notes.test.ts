/**
 * The retry corrections are appended to the system prompt as its newest,
 * most salient instruction. In English, they pulled pt-BR characters into
 * English on exactly the turns that retried.
 */
import { describe, expect, it } from "vitest";
import { retryCorrectionNote, targetRetryCorrectionNote } from "../action-intent-step.js";

describe("retry correction notes", () => {
  it("speak the profile's language", () => {
    expect(retryCorrectionNote("oi", "pt-BR")).toMatch(/^IMPORTANTE/);
    expect(retryCorrectionNote("hi", "en")).toMatch(/^IMPORTANT:/);
    expect(targetRetryCorrectionNote("replyToEventId", "e9", ["e1"], "pt-BR")).toMatch(/^IMPORTANTE/);
    expect(targetRetryCorrectionNote("replyToEventId", "e9", ["e1"], "pt-BR")).toContain("e1");
  });
});
