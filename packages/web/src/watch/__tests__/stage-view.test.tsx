import { describe, expect, it } from "vitest";
import { buildTimeline, makePageWords, planBalloons, type TextMeasurer, type Timeline } from "@perfectman/shared";
import { StageView } from "../StageView.js";

const measure: TextMeasurer = (text, font) => text.length * font.size * 0.5;
import { tinyReplay } from "./replay-fixture.js";

function setup(): { T: Timeline; view: StageView; host: HTMLElement } {
  const r = tinyReplay();
  const ctx = { archetype: (id: string) => r.agentArchetypes[id] ?? "", measure };
  const T = buildTimeline(r, { pageWords: makePageWords(ctx) });
  planBalloons(T, ctx);
  const host = document.createElement("div");
  document.body.append(host);
  return { T, view: new StageView(host, T, r, { setting: "rooftop" }), host };
}

describe("StageView", () => {
  it("puts every character on the stage and shows the story clock", () => {
    const { view, host } = setup();
    view.render(0.2);

    expect(host.querySelectorAll(".watch-actor")).toHaveLength(3);
    for (const el of host.querySelectorAll<HTMLElement>(".watch-actor")) {
      expect(el.style.left).toMatch(/px$/);
      expect(el.style.top).toMatch(/px$/);
    }
    expect(host.querySelector(".watch-clock")!.textContent).toMatch(/11:\d\dpm/);
    view.destroy();
  });

  it("reveals a balloon word by word as the words land, then holds it until it is read", () => {
    const { T, view, host } = setup();
    const b = T.balloons.find((x) => x.kind === "speech")!;
    const words = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".watch-balloon--speech .w")];

    view.render(b.s0 + (b.s1 - b.s0) * 0.4);
    const early = words().filter((w) => w.style.opacity === "1").length;
    view.render(b.s1 + 0.1);
    const done = words().filter((w) => w.style.opacity === "1").length;

    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(words().length);
    expect(done).toBe(words().length);
    view.destroy();
  });

  it("shows a private thought only to the omniscient viewer", () => {
    const { T, view, host } = setup();
    const th = T.balloons.find((x) => x.kind === "thought")!;
    const t = (th.t0 + th.t1) / 2;
    const shown = (): boolean => [...host.querySelectorAll<HTMLElement>(".watch-balloon--thought")].some((e) => e.style.display === "block");

    view.render(t, { omniscient: false });
    expect(shown()).toBe(false);
    view.render(t, { omniscient: true });
    expect(shown()).toBe(true);
    view.destroy();
  });

  it("pushes the camera in on a private pair and blurs the one left out", () => {
    const { T, view, host } = setup();
    const huddle = T.scenes.find((s) => s.type === "huddle")!;
    view.render(0.2);
    const wide = host.querySelector<HTMLElement>(".watch-cam")!.style.transform;
    view.render(huddle.t0 + 2);
    const inside = host.querySelector<HTMLElement>(".watch-cam")!.style.transform;
    const carla = host.querySelectorAll<HTMLElement>(".watch-actor")[2]!;

    expect(wide).toContain("scale(1.0000)");
    expect(inside).not.toBe(wide);
    expect(Number(/scale\(([\d.]+)\)/.exec(inside)![1])).toBeGreaterThan(1.5);
    expect(carla.style.filter).toContain("blur(");
    view.destroy();
  });

  it("crossfades the light instead of swapping it", () => {
    const { T, view, host } = setup();
    view.render(0.1);
    const opacities = (): number[] => [...host.querySelectorAll<HTMLElement>(".watch-plate")].slice(0, 2).map((p) => Number(p.style.opacity));
    const first = opacities();
    view.render(T.duration);
    const later = opacities();

    expect(first).toEqual([1, 0]);
    expect(later).toEqual([0, 1]);
    view.destroy();
  });

  it("writes nothing when asked for the same moment twice", () => {
    const { T, view, host } = setup();
    const t = T.balloons[0]!.s0 + 0.3;
    view.render(t);
    let mutations = 0;
    const observer = new MutationObserver((list) => { mutations += list.length; });
    observer.observe(host, { attributes: true, childList: true, subtree: true, characterData: true });
    view.render(t);
    observer.takeRecords();
    observer.disconnect();

    expect(mutations).toBe(0);
    view.destroy();
  });

  it("removes itself cleanly", () => {
    const { view, host } = setup();
    view.render(0.2);
    view.destroy();

    expect(host.querySelector(".watch-stage")).toBeNull();
    expect(host.classList.contains("watch-host")).toBe(false);
  });
});
