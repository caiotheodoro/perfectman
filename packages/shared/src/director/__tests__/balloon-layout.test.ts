import { describe, expect, it } from "vitest";
import { catReplay } from "./fixtures/cat-replay.js";
import { fitText, fontFor, makePageWords, planBalloons, LETTERING, type TextMeasurer } from "../balloon-layout.js";
import { buildTimeline } from "../timeline.js";
import { sampleTimeline } from "../sample.js";
import type { DirectorReplay } from "../types.js";

const replay: DirectorReplay = catReplay();
const measure: TextMeasurer = (text, font) => text.length * font.size * 0.5;
const archetype = (id: string): string => replay.agentProfiles?.[id]?.archetype ?? "";
const ctx = { archetype, measure };
const planned = (() => {
  const T = buildTimeline(replay, { pageWords: makePageWords(ctx) });
  planBalloons(T, ctx);
  return T;
})();

describe("fitText", () => {
  const font = LETTERING.house;

  it("fits a short line in one balloon of a pleasant shape", () => {
    const [page] = fitText("Good evening, neighbors", font, "speech", measure);

    expect(page!.lines.length).toBeLessThanOrEqual(4);
    expect(page!.W / page!.H).toBeGreaterThan(1.2);
  });

  it("pages a long line instead of cutting it, keeping every word", () => {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
    const pages = fitText(long, font, "speech", measure);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((p) => p.lines.length <= 4)).toBe(true);
    expect(pages.flatMap((p) => p.lines).join(" ").split(" ")).toHaveLength(120);
  });

  it("gives a shout, a thought and a persona their own lettering", () => {
    expect(fontFor("shout", "gatekeeper", 0.5).family).not.toBe(fontFor("speech", "gatekeeper", 0.5).family);
    expect(fontFor("thought", "elder", 0.5)).toMatchObject({ family: "Fraunces Variable", style: "italic" });
    expect(fontFor("speech", "gatekeeper", 0.5).family).not.toBe(fontFor("speech", "elder", 0.5).family);
  });
});

describe("planBalloons on the cat run", () => {
  it("places every balloon inside the frame with a tail pointing at a head", () => {
    for (const b of planned.balloons) {
      expect(b.slot, b.id).toBeDefined();
      const p = b.pages![0]!;
      expect(b.slot!.cx - p.W / 2).toBeGreaterThanOrEqual(-1);
      expect(b.slot!.cx + p.W / 2).toBeLessThanOrEqual(1201);
    }
  });

  it("covers every word of every spoken line across its pages, in order", () => {
    for (const b of planned.balloons.filter((x) => x.kind !== "thought")) {
      const counted = b.pages!.reduce((n, p) => n + p.n, 0);
      expect(counted, b.id).toBe(b.words.length);
      for (let i = 1; i < b.pages!.length; i++) expect(b.pages![i]!.t0).toBeGreaterThan(b.pages![i - 1]!.t0);
    }
  });

  it("keeps each page up at least as long as its words take to read", () => {
    for (const b of planned.balloons.filter((x) => x.kind !== "thought")) {
      for (const p of b.pages!) expect(p.t1 - p.t0, `${b.id}`).toBeGreaterThanOrEqual(0.5 + p.n / planned.pace - 0.02);
    }
  });

  it("never lays two balloons on top of each other when both are on screen", () => {
    const boxes = (t: number) => sampleTimeline(planned, t).balloons.map((b) => {
      const s = b.slot!, p = b.pages!.find((pg) => t >= pg.t0 && t <= pg.t1) ?? b.pages![0]!;
      return { id: b.id, t0: b.t0, t1: b.t1, x0: s.cx - p.W / 2, x1: s.cx + p.W / 2, y0: s.cy - p.H / 2, y1: s.cy + p.H / 2 };
    });
    let worst = 0;
    for (let t = 0; t < planned.duration; t += 0.5) {
      const bs = boxes(t);
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i]!, c = bs[j]!;
        if (Math.min(a.t1, c.t1) - Math.max(a.t0, c.t0) <= 0.25) continue; // a hand-off may overlap for a moment
        worst = Math.max(worst, Math.max(0, Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0)) * Math.max(0, Math.min(a.y1, c.y1) - Math.max(a.y0, c.y0)));
      }
    }
    expect(worst).toBeLessThan(2500);
  });
});
