import { describe, expect, it } from "vitest";
import { paginateText, planVideo } from "../storyboard.js";
import type { VideoStory } from "../types.js";

const story: VideoStory = {
  title: "One room", sourceKind: "script", agents: [{ id: "ada", name: "Ada" }], notices: [],
  steps: [
    { id: "first", phase: "Seed", kind: "message", text: "Anyone here?", actorId: "ada", visibility: "public", pulse: 2, sourceRefs: ["/steps/0"], raw: { pulse: 2 } },
    { id: "second", phase: "Run", kind: "private", text: "I need them to stay. ".repeat(40), actorId: "ada", visibility: "operator", pulse: 0, sourceRefs: ["/steps/1"], raw: { pulse: 0 } },
  ],
};

describe("video planning", () => {
  it.each(["hello ".repeat(90), "🧠".repeat(450), "W".repeat(500), "line\n".repeat(80), "", "  leading and trailing  "])("paginates all text without losing content: %s", (text) => {
    const pages = paginateText(text);
    expect(pages.join("")).toBe(text);
    expect(pages.every(page => Array.from(page).length <= 220)).toBe(true);
    expect(pages.every(page => (page.match(/\n/g) ?? []).length <= 5)).toBe(true);
  });
  it("keeps source order and references, gives every page time, and does not cap the run", () => {
    const result = planVideo(story, "input.json", "hash");
    expect(result.beats.map(beat => beat.id)).toEqual(["first", ...Array(paginateText(story.steps[1]!.text).length).fill("second")]);
    expect(result.beats.map(beat => beat.pulse)).toEqual([2, ...Array(result.beats.length - 1).fill(0)]);
    expect(result.beats.at(-1)?.sourceRefs).toEqual(["/steps/1"]);
    expect(result.beats.every((beat, i) => i === 0 || Math.abs(beat.start - (result.beats[i - 1]!.start + result.beats[i - 1]!.duration)) < 0.001)).toBe(true);
    expect(result.duration).toBeGreaterThan(30);
    expect(result.steps).toEqual(story.steps);
    expect(result.beats.some(beat => "raw" in beat)).toBe(false);
  });
  it("rejects empty stories and invalid page limits", () => {
    expect(() => planVideo({ ...story, steps: [] }, "input.json", "hash")).toThrow("no video steps");
    expect(() => paginateText("test", 0)).toThrow("positive integer");
  });
});
