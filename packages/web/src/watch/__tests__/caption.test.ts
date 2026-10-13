import { describe, expect, it } from "vitest";
import { buildTimeline, makePageWords, planBalloons, sampleTimeline, type TextMeasurer } from "@perfectman/shared";
import { captionAt } from "../caption.js";
import { tinyReplay } from "./replay-fixture.js";

const measure: TextMeasurer = (text, font) => text.length * font.size * 0.5;
const r = tinyReplay();
const ctx = { archetype: (id: string) => r.agentArchetypes[id] ?? "", measure };
const T = buildTimeline(r, { pageWords: makePageWords(ctx) });
planBalloons(T, ctx);
const name = (id: string): string => ({ ana: "Ana", bruno: "Bruno", carla: "Carla" })[id] ?? id;

describe("captionAt", () => {
  it("says nothing when nothing is being said", () => {
    expect(captionAt(sampleTimeline(T, 0.01), name)).toBeNull();
  });

  it("shows only the words that have landed, and the whole line once they all have", () => {
    const b = T.balloons.find((x) => x.kind === "speech")!;
    const early = captionAt(sampleTimeline(T, b.s0 + (b.s1 - b.s0) * 0.3), name)!;
    const done = captionAt(sampleTimeline(T, b.s1 + 0.2), name)!;

    expect(early.name).toBe("Ana");
    expect(early.text.length).toBeGreaterThan(0);
    expect(early.text.length).toBeLessThan(done.text.length);
    expect(done.text).toContain("Good evening everyone");
    expect(done.text.startsWith(early.text)).toBe(true);
  });

  it("shows a thought whole, marked as one", () => {
    const th = T.balloons.find((x) => x.kind === "thought")!;
    const c = captionAt(sampleTimeline(T, th.t0 + 0.5), name)!;

    expect(c.kind).toBe("thought");
    expect(c.text).toContain("without anyone else hearing");
  });

  it("follows the newest balloon when two are up", () => {
    const [first, second] = T.balloons.filter((x) => x.kind !== "thought").sort((a, b) => a.t0 - b.t0);
    const t = (second!.t0 + first!.t1) / 2;
    if (first!.t1 > second!.t0) expect(captionAt(sampleTimeline(T, t), name)!.name).toBe(name(second!.actor));
    else expect(captionAt(sampleTimeline(T, second!.s1), name)!.name).toBe(name(second!.actor));
  });
});
