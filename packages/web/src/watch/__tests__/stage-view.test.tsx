import { describe, expect, it } from "vitest";
import { buildTimeline, makePageWords, planBalloons, surpriseParty, type TextMeasurer, type Timeline } from "@perfectman/shared";
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
    const early = words().filter((w) => w.style.visibility === "visible").length;
    view.render(b.s1 + 0.1);
    const done = words().filter((w) => w.style.visibility === "visible").length;

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

  it("blends the light by the clock, so the picture depends only on the moment", () => {
    const { T, view, host } = setup();
    const plates = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".watch-plate")].slice(0, 2);
    const state = (): string => plates().map((p) => `${Number(p.style.opacity).toFixed(3)}|${p.innerHTML.length}`).join(" ");

    view.render(T.duration * 0.1);
    const early = state();
    const [lower, upper] = plates().map((p) => Number(p.style.opacity));
    expect(lower).toBe(1);
    expect(upper).toBeGreaterThan(0);
    expect(upper).toBeLessThan(1);

    view.render(T.duration);
    expect(state()).not.toBe(early);
    view.render(T.duration * 0.1);
    expect(state(), "going back gives the same picture as getting there the first time").toBe(early);
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

  it("marks time-lapse captions as intentional layering, so two cross-fading ones do not read as overlapping text", () => {
    const r = surpriseParty();
    const quiet = r.pulses.slice(2, 5).map((p, i) => ({ ...p, pulseIndex: 100 + i, committedEvents: [], agentThinking: {} }));
    const replay = { ...r, pulses: [...r.pulses.slice(0, 3), ...quiet, ...r.pulses.slice(3).map((p, i) => ({ ...p, pulseIndex: 103 + i }))] };
    const ctx = { archetype: (id: string) => replay.agentArchetypes[id] ?? "", measure };
    const T = buildTimeline(replay, { pageWords: makePageWords(ctx) });
    planBalloons(T, ctx);
    const host = document.createElement("div");
    document.body.append(host);
    const view = new StageView(host, T, replay, { setting: "living" });
    let seen = 0;
    for (let at = 0; at < T.duration; at += 0.25) {
      view.render(at);
      for (const el of host.querySelectorAll(".watch-caption")) {
        seen += 1;
        expect(el.hasAttribute("data-layout-allow-overlap")).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(0);
    view.destroy();
  });
});
