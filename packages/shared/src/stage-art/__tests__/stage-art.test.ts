import { describe, expect, it } from "vitest";
import { SCENE_SETTINGS } from "../../stage/scene-look.js";
import { balloonShape, BALLOON_FILTER_DEFS, markMarkup, type MarkKind } from "../balloon-shapes.js";
import { FIGURE_PARTS, figureMarkup } from "../figure-markup.js";
import { clockText, light, mix, rng } from "../light.js";
import { placeMarkup } from "../places.js";

describe("light", () => {
  it("is darker at midnight than at midday and brightest at midday", () => {
    expect(light(0).L).toBeLessThan(light(12 * 60 + 40).L);
    expect(light(0).stars).toBe(1);
    expect(light(7 * 60).stars).toBe(0);
  });

  it("runs the night through midnight without a jump", () => {
    const before = light(23 * 60 + 59), after = light(0);
    expect(Math.abs(before.L - after.L)).toBeLessThan(0.02);
    expect(before.top).toBe(after.top);
  });

  it("mixes colours and tells the time the way a person says it", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(clockText(23 * 60 + 42)).toBe("11:42pm");
    expect(clockText(0)).toBe("12:00am");
    expect(clockText(12 * 60 + 5)).toBe("12:05pm");
  });

  it("draws the same random every time for a seed", () => {
    const a = rng(7), b = rng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("places", () => {
  it("draws all eight settings as a stage-sized svg, at any hour, without a NaN", () => {
    for (const setting of SCENE_SETTINGS) {
      for (const minute of [0, 5 * 60, 12 * 60, 19 * 60, 23 * 60 + 40]) {
        const svg = placeMarkup(setting, minute, "t");
        expect(svg, setting).toContain('viewBox="0 0 1200 600"');
        expect(svg).not.toContain("NaN");
        expect(svg).not.toContain("undefined");
      }
    }
  });

  it("falls back to the rooftop for a place it does not know", () => {
    expect(placeMarkup("moon-base", 0, "t")).toBe(placeMarkup("rooftop", 0, "t"));
  });

  it("gives gradients ids from the caller, so two plates on one page do not collide", () => {
    expect(placeMarkup("rooftop", 0, "aaa")).toContain("aaasky");
    expect(placeMarkup("rooftop", 0, "bbb")).not.toContain("aaasky");
  });

  it("relights with the clock: the same place looks different at noon and midnight", () => {
    expect(placeMarkup("kitchen", 0, "t")).not.toBe(placeMarkup("kitchen", 12 * 60, "t"));
  });
});

describe("figures", () => {
  it("names every part a rig poses, once", () => {
    const svg = figureMarkup({ index: 0 });
    for (const part of FIGURE_PARTS) expect(svg.match(new RegExp(`data-part="${part}"`, "g")), part).toHaveLength(1);
  });

  it("holds the persona's prop and draws the six silhouettes", () => {
    expect(figureMarkup({ index: 0, prop: "ledger" })).toContain("#8a3a2a");
    expect(figureMarkup({ index: 3, prop: "glasses" })).toContain('r="11"');
    const shapes = new Set([0, 1, 2, 3, 4, 5].map((i) => figureMarkup({ index: i }).match(/<path d="(M[^"]+)" fill="#/)?.[1]));
    expect(shapes.size).toBe(6);
    expect(figureMarkup({ index: 6 })).toBe(figureMarkup({ index: 0 }));
  });
});

describe("balloons", () => {
  it("draws every kind with a tail toward the tip and no NaN", () => {
    for (const kind of ["speech", "shout", "whisper", "thought"] as const) {
      const svg = balloonShape(kind, 240, 100, 120, 190);
      expect(svg, kind).toContain('viewBox="0 0 240 100"');
      expect(svg).not.toContain("NaN");
      expect(svg).toContain("balloon-wobble");
    }
  });

  it("sets a whisper apart with dashes and a thought with a cloud and a trail", () => {
    expect(balloonShape("whisper", 200, 80, 100, 150)).toContain("stroke-dasharray");
    expect((balloonShape("thought", 200, 80, 100, 150).match(/<circle/g) ?? []).length).toBeGreaterThan(14);
    expect(balloonShape("speech", 200, 80, 100, 150)).not.toContain("stroke-dasharray");
  });

  it("defines the wobble filter the balloons reference, and a mark for each reaction", () => {
    expect(BALLOON_FILTER_DEFS).toContain('id="balloon-wobble"');
    for (const k of ["steam", "sweat", "heart", "?", "*", "!"] as MarkKind[]) expect(markMarkup(k)).toContain("<svg");
  });
});
