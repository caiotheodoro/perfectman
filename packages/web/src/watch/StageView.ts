/**
 * The stage: renders `sampleTimeline(T, t)` into the DOM, and nothing else.
 *
 * A fixed 1200 x 600 logical frame scaled to its host. The camera is one CSS
 * transform; the light crossfades between two plates instead of swapping;
 * every write is skipped when the value did not change.
 */
import {
  clockText, huddleSpot, placeMarkup, personaSignature, sampleTimeline,
  type DirectorReplay, type SceneSetting, type Timeline,
} from "@perfectman/shared";
import { BalloonLayer, MarkLayer } from "./BalloonLayer.js";
import { CharacterRig } from "./CharacterRig.js";

/** Story minutes between two drawn plates; the light blends between them. */
const LIGHT_STEP_MINUTES = 6;

/**
 * Two plates blended by the clock. Where the light is between two drawn hours,
 * the lower plate is fully shown and the upper fades in by how far it is. It
 * is a pure function of the minute, so seeking backward or rendering frames
 * out of order gives the same picture as playing forward.
 */
class LightPair {
  private minutes: [number, number] = [Number.NaN, Number.NaN];
  constructor(private readonly plates: [HTMLDivElement, HTMLDivElement], private readonly draw: (minute: number, uid: string) => string) {}

  /** Draws what is needed and returns the opacity of the lower and the upper plate. */
  show(minute: number): [number, number] {
    const m0 = Math.floor(minute / LIGHT_STEP_MINUTES) * LIGHT_STEP_MINUTES;
    const frac = (minute - m0) / LIGHT_STEP_MINUTES;
    for (const m of [m0, m0 + LIGHT_STEP_MINUTES]) {
      const i = ((((m / LIGHT_STEP_MINUTES) % 2) + 2) % 2) as 0 | 1;
      if (this.minutes[i] !== m) { this.plates[i].innerHTML = this.draw(m, `l${i}`); this.minutes[i] = m; }
    }
    return [1, this.minutes[1] === m0 ? 1 - frac : frac];
  }
}

export type StageViewOptions = {
  /** Where it happens; falls back to the rooftop. */
  setting?: SceneSetting | string;
  /** The second place for the through-the-door staging. */
  room2?: SceneSetting | string;
};

export class StageView {
  readonly el: HTMLDivElement;
  private readonly cam: HTMLDivElement;
  private readonly plates: [HTMLDivElement, HTMLDivElement];
  private readonly plates2: [HTMLDivElement, HTMLDivElement];
  private readonly pool: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly inset: HTMLDivElement;
  private readonly caps: HTMLDivElement;
  private readonly chip: HTMLDivElement;
  private readonly rigs = new Map<string, CharacterRig>();
  private readonly balloons: BalloonLayer;
  private readonly marks: MarkLayer;
  private readonly capEls = new Map<string, HTMLDivElement>();
  private readonly seen = new Map<string, string>();
  private readonly light: LightPair;
  private readonly light2: LightPair;
  private insetDrawn = false;
  private lastT = 0;
  private observer: ResizeObserver | null = null;

  constructor(readonly host: HTMLElement, readonly T: Timeline, replay: DirectorReplay, private readonly opts: StageViewOptions = {}) {
    host.classList.add("watch-host");
    this.el = document.createElement("div");
    this.el.className = "watch-stage";
    host.append(this.el);
    this.cam = this.div("watch-cam", this.el);
    const plate = (): HTMLDivElement => this.div("watch-plate", this.cam);
    this.plates = [plate(), plate()];
    this.plates2 = [plate(), plate()];
    this.light = new LightPair(this.plates, (m, uid) => placeMarkup(opts.setting, m, uid));
    this.light2 = new LightPair(this.plates2, (m, uid) => placeMarkup(opts.room2 ?? "stairwell", m, `r${uid}`));
    this.pool = this.div("watch-pool", this.cam);
    replay.agentIds.forEach((id, i) => {
      const archetype = replay.agentProfiles?.[id]?.archetype ?? replay.agentArchetypes[id] ?? "";
      const rig = new CharacterRig(i, personaSignature({ archetype }).prop, i);
      this.cam.append(rig.el);
      this.rigs.set(id, rig);
    });
    this.vignette = this.div("watch-vignette", this.el);
    this.inset = this.div("watch-inset", this.el);
    this.inset.innerHTML = '<div class="watch-inset__view"></div><span>through the door: still on the roof</span>';
    const ctx = {
      archetype: (id: string) => replay.agentProfiles?.[id]?.archetype ?? replay.agentArchetypes[id] ?? "",
      name: (id: string) => (replay.agentProfiles?.[id]?.displayName ?? replay.agentNames[id] ?? id).replace(/^(Dona|Mr\.|Ms\.|Mrs\.|Dr\.)\s+/, ""),
      index: (id: string) => replay.agentIds.indexOf(id),
    };
    this.balloons = new BalloonLayer(this.el, ctx);
    this.marks = new MarkLayer(this.el);
    this.caps = this.div("watch-captions", this.el);
    this.chip = this.div("watch-clock", this.el);
    this.fit();
    if (typeof ResizeObserver !== "undefined") { this.observer = new ResizeObserver(() => this.fit()); this.observer.observe(host); }
  }

  private div(cls: string, parent: HTMLElement): HTMLDivElement {
    const d = document.createElement("div");
    d.className = cls;
    parent.append(d);
    return d;
  }

  private fit(): void {
    const w = this.host.clientWidth || 1200;
    this.el.style.transform = `scale(${w / 1200})`;
    this.host.style.height = `${w / 2}px`;
  }

  private write(el: HTMLElement, key: string, prop: string, value: string): void {
    const k = `${key}.${prop}`;
    if (this.seen.get(k) !== value) { this.seen.set(k, value); (el.style as unknown as Record<string, string>)[prop] = value; }
  }

  /** Draw the stage at time `t`. `omniscient` false is the fiction-only lens. */
  render(t: number, o: { omniscient?: boolean; /** Breath phase per character, for renders that must not depend on the order of frames. */ phase?: (id: string) => number } = {}) {
    const S = sampleTimeline(this.T, t, { omniscient: o.omniscient });
    const c = S.cam;
    this.write(this.cam, "cam", "transform", `translate(${(600 - c.cx * c.z).toFixed(2)}px,${(300 - c.cy * c.z).toFixed(2)}px) scale(${c.z.toFixed(4)})`);

    // Light: two drawn hours blended by the clock, a pure function of the minute.
    const room = c.room || 0;
    const [lower, upper] = this.light.show(S.minute);
    this.write(this.plates[0], "pl0", "opacity", ((1 - 0.96 * room) * lower).toFixed(3));
    this.write(this.plates[1], "pl1", "opacity", ((1 - 0.96 * room) * upper).toFixed(3));
    if (room > 0.01) {
      const [l2, u2] = this.light2.show(S.minute);
      this.write(this.plates2[0], "pm0", "opacity", (room * l2).toFixed(3));
      this.write(this.plates2[1], "pm1", "opacity", (room * u2).toFixed(3));
    } else {
      this.write(this.plates2[0], "pm0", "opacity", "0");
      this.write(this.plates2[1], "pm1", "opacity", "0");
    }
    const bg = c.bg > 0.05 ? `blur(${(c.bg * 1.1).toFixed(1)}px) brightness(${(1 - c.pool * 0.12).toFixed(2)})` : "";
    this.plates.forEach((p, i) => this.write(p, `pf${i}`, "filter", bg));
    this.write(this.inset, "inset", "opacity", Math.max(0, room * 2 - 1).toFixed(2));
    if (room > 0.5 && !this.insetDrawn) { this.inset.querySelector(".watch-inset__view")!.innerHTML = placeMarkup(this.opts.setting, Math.round(S.minute), "ri"); this.insetDrawn = true; }

    const sc = S.scene;
    let px = 250, py = 470;
    if (sc && sc.type === "huddle") { const n = Math.max(1, sc.members.length); px = sc.members.reduce((s, _m, k) => s + huddleSpot(k).x, 0) / n; py = huddleSpot(0).y - 70; }
    this.write(this.pool, "pool", "left", `${px - 300}px`);
    this.write(this.pool, "pool", "top", `${py - 260}px`);
    this.write(this.pool, "pool", "opacity", (c.pool * 0.9).toFixed(2));
    this.write(this.vignette, "vig", "opacity", Math.min(1, Math.max(0, (c.z - 1) / 0.8)).toFixed(2));

    const dt = Math.min(0.1, Math.abs(t - this.lastT));
    this.lastT = t;
    this.T.agents.forEach((id, i) => {
      const ch = S.chars[id]!, v = ch.v, rig = this.rigs.get(id)!;
      rig.place(v.x, v.y, v.w, Math.round(v.y));
      const ph = (t * 0.9 + i * 1.7) % 4.3;
      rig.update(v, dt, t, { walking: ch.walking, speak: ch.speak, ...(o.phase ? { phase: o.phase(id) } : {}), blink: ph < 0.14 ? Math.max(0.08, Math.abs(ph - 0.07) / 0.07) : 1 });
    });
    this.balloons.sync(S, c);
    this.marks.sync(S, c);

    const live = new Set<string>();
    for (const { c: cap, op } of S.captions) {
      const id = `${cap.t0}${cap.text}`;
      live.add(id);
      let e = this.capEls.get(id);
      if (!e) { e = this.div(`watch-caption watch-caption--${cap.where}`, this.caps); e.setAttribute("data-layout-allow-overlap", ""); e.textContent = cap.text; this.capEls.set(id, e); }
      e.style.display = "block";
      e.style.opacity = op.toFixed(2);
    }
    for (const [id, e] of this.capEls) if (!live.has(id)) e.style.display = "none";
    const text = clockText(Math.round(S.minute));
    if (this.chip.textContent !== text) this.chip.textContent = text;
    return S;
  }

  destroy(): void {
    this.observer?.disconnect();
    this.balloons.destroy();
    this.marks.destroy();
    this.el.remove();
    this.host.classList.remove("watch-host");
  }
}
