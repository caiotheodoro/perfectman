import { describe, expect, it } from "vitest";
import { LETTERING, SHOUT_FONT, THOUGHT_FONT, makePageWords, planBalloons } from "../balloon-layout.js";
import { BALLOON_METRICS, tableMeasurer } from "../balloon-metrics.js";
import { buildTimeline } from "../timeline.js";
import { catReplay } from "./fixtures/cat-replay.js";

describe("tableMeasurer", () => {
  it("has every lettering face, with a width for every printable ASCII glyph", () => {
    for (const font of [...Object.values(LETTERING), SHOUT_FONT, THOUGHT_FONT]) {
      const name = font.family.replace(" Variable", "");
      expect(BALLOON_METRICS[name], name).toBeDefined();
      expect(BALLOON_METRICS[name]!.glyphs).toHaveLength(95);
    }
  });

  it("agrees with a browser's measurement of a real line to within 3% (kerning is ignored)", () => {
    // 1583.28 px for this line at 100 px in Shantell Sans, measured with a canvas in Chromium.
    const width = tableMeasurer("Hello world, the quick brown fox", { family: "Shantell Sans", size: 100, weight: 400, lineHeight: 1.2 });

    expect(Math.abs(width - 1583.28) / 1583.28).toBeLessThan(0.03);
  });

  it("scales with the size and puts wide letters before narrow ones", () => {
    const f = { family: "Patrick Hand", size: 20, weight: 400, lineHeight: 1.1 };

    expect(tableMeasurer("hello", { ...f, size: 40 })).toBeCloseTo(tableMeasurer("hello", f) * 2, 5);
    expect(tableMeasurer("MMMM", f)).toBeGreaterThan(tableMeasurer("iiii", f));
  });

  it("measures letters outside ASCII and scripts without spaces instead of ignoring them", () => {
    const f = LETTERING.house;

    expect(tableMeasurer("é", f)).toBeGreaterThan(0);
    expect(tableMeasurer("明日", f)).toBeGreaterThan(tableMeasurer("ab", f));
  });

  it("lays out a whole film the same way every time, so node and a page agree on its length", () => {
    const replay = catReplay();
    const ctx = { archetype: (id: string) => replay.agentProfiles?.[id]?.archetype ?? "", measure: tableMeasurer };
    const once = buildTimeline(replay, { pageWords: makePageWords(ctx) });
    const twice = buildTimeline(replay, { pageWords: makePageWords(ctx) });
    planBalloons(once, ctx);
    planBalloons(twice, ctx);

    expect(once.duration).toBe(twice.duration);
    expect(JSON.stringify(once.balloons.map((b) => b.slot))).toBe(JSON.stringify(twice.balloons.map((b) => b.slot)));
  });
});
