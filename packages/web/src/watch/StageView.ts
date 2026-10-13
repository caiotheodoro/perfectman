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

const LIGHT_STEP_MINUTES = 6;

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
  private front: 0 | 1 = 0;
  private front2: 0 | 1 = 0;
  private lit = Number.NaN;
  private lit2 = Number.NaN;
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
  render(t: number, o: { omniscient?: boolean } = {}) {
    const S = sampleTimeline(this.T, t, { omniscient: o.omniscient });
    const c = S.cam;
    this.write(this.cam, "cam", "transform", `translate(${(600 - c.cx * c.z).toFixed(2)}px,${(300 - c.cy * c.z).toFixed(2)}px) scale(${c.z.toFixed(4)})`);

    // Light: render the new hour into the hidden plate and let the opacity transition fade to it.
    const lit = Math.round(S.minute / LIGHT_STEP_MINUTES) * LIGHT_STEP_MINUTES;
    const place = this.opts.setting, place2 = this.opts.room2 ?? "stairwell";
    if (Number.isNaN(this.lit)) {
      this.plates[0].innerHTML = placeMarkup(place, lit, "pa");
      this.plates2[0].innerHTML = placeMarkup(place2, lit, "ra");
      this.lit = this.lit2 = lit;
    } else if (lit !== this.lit) {
      const back: 0 | 1 = this.front === 0 ? 1 : 0;
      this.plates[back].innerHTML = placeMarkup(place, lit, `p${back}${lit}`);
      this.front = back;
      this.lit = lit;
    }
    const room = c.room || 0;
    if (room > 0.01 && lit !== this.lit2) {
      const back: 0 | 1 = this.front2 === 0 ? 1 : 0;
      this.plates2[back].innerHTML = placeMarkup(place2, lit, `r${back}${lit}`);
      this.front2 = back;
      this.lit2 = lit;
    }
    this.plates.forEach((p, i) => this.write(p, `pl${i}`, "opacity", ((i === this.front ? 1 : 0) * (1 - 0.96 * room)).toFixed(3)));
    this.plates2.forEach((p, i) => this.write(p, `pm${i}`, "opacity", ((i === this.front2 ? 1 : 0) * room).toFixed(3)));
    const bg = c.bg > 0.05 ? `blur(${(c.bg * 1.1).toFixed(1)}px) brightness(${(1 - c.pool * 0.12).toFixed(2)})` : "";
    this.plates.forEach((p, i) => this.write(p, `pf${i}`, "filter", bg));
    this.write(this.inset, "inset", "opacity", Math.max(0, room * 2 - 1).toFixed(2));
    if (room > 0.5 && !this.insetDrawn) { this.inset.querySelector(".watch-inset__view")!.innerHTML = placeMarkup(place, lit, "ri"); this.insetDrawn = true; }

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
      rig.update(v, dt, t, { walking: ch.walking, speak: ch.speak, blink: ph < 0.14 ? Math.max(0.08, Math.abs(ph - 0.07) / 0.07) : 1 });
    });
    this.balloons.sync(S, c);
    this.marks.sync(S, c);

    const live = new Set<string>();
    for (const { c: cap, op } of S.captions) {
      const id = `${cap.t0}${cap.text}`;
      live.add(id);
      let e = this.capEls.get(id);
      if (!e) { e = this.div(`watch-caption watch-caption--${cap.where}`, this.caps); e.textContent = cap.text; this.capEls.set(id, e); }
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
