/**
 * A drawn character you can pose with numbers.
 *
 * `update` takes a `PoseVector` and writes only what changed, so a frame that
 * moves nothing costs nothing. Breath and tremor are driven from the clock here
 * rather than by CSS animation, so a scrubbed or paused stage stays exactly
 * where the timeline says it is.
 */
import { figureMarkup, type FigurePart, type PoseVector, type SignatureProp } from "@perfectman/shared";

export type RigFrame = { walking?: boolean; speak?: number; blink?: number; /** Breath phase in radians; when given, the rig does not keep its own. */ phase?: number };

const fixed = (n: number, d = 1): string => n.toFixed(d);
const curve = (a: number[]): string => `M${fixed(a[0]!)} ${fixed(a[1]!)}Q${fixed(a[2]!)} ${fixed(a[3]!)} ${fixed(a[4]!)} ${fixed(a[5]!)}`;
const line = (a: number[]): string => `M${fixed(a[0]!)} ${fixed(a[1]!)}L${fixed(a[2]!)} ${fixed(a[3]!)}`;

export class CharacterRig {
  readonly el: HTMLDivElement;
  private readonly part = new Map<FigurePart, Element>();
  private readonly seen = new Map<string, string>();
  private phase: number;

  constructor(readonly index: number, prop: SignatureProp, seed = index) {
    this.el = document.createElement("div");
    this.el.className = "watch-actor";
    this.el.innerHTML = figureMarkup({ index, prop });
    this.el.querySelectorAll("[data-part]").forEach((n) => this.part.set(n.getAttribute("data-part") as FigurePart, n));
    this.phase = (seed * 2.399) % 6.283;
  }

  private p(name: FigurePart): Element {
    return this.part.get(name)!;
  }

  private attr(name: FigurePart, key: string, value: string): void {
    const k = `${name}.${key}`;
    if (this.seen.get(k) !== value) { this.seen.set(k, value); this.p(name).setAttribute(key, value); }
  }

  private style(el: HTMLElement | SVGElement, k: string, key: string, value: string): void {
    if (this.seen.get(k) !== value) { this.seen.set(k, value); (el.style as unknown as Record<string, string>)[key] = value; }
  }

  private sty(name: FigurePart, key: string, value: string): void {
    this.style(this.p(name) as SVGElement, `${name}:${key}`, key, value);
  }

  /** Where the figure stands: foot position and width in stage pixels. */
  place(x: number, y: number, w: number, z: number): void {
    this.style(this.el, "el.left", "left", `${fixed(x)}px`);
    this.style(this.el, "el.top", "top", `${fixed(y)}px`);
    this.style(this.el, "el.width", "width", `${fixed(w)}px`);
    this.style(this.el, "el.z", "zIndex", String(z));
  }

  update(V: PoseVector, dt: number, t: number, o: RigFrame = {}): void {
    if (o.phase !== undefined) this.phase = o.phase;
    else this.phase += (dt * 6.283) / Math.max(1.2, V.breath);
    const by = 1 + 0.016 * Math.sin(this.phase), bx = 1 + 0.008 * Math.sin(this.phase + 0.6);
    const tw = V.tremor * 1.1;
    const jx = tw * Math.sin(t * 61 + this.index), jy = tw * 0.4 * Math.sin(t * 47 + this.index * 2);
    const bob = o.walking ? Math.abs(Math.sin(t * 9 + this.index)) * -7 : 0;
    this.sty("breath", "transform", `scale(${bx.toFixed(4)},${by.toFixed(4)})`);
    this.sty("shake", "transform", `translate(${fixed(jx, 2)}px,${fixed(jy + bob, 2)}px)`);
    this.sty("rig", "transform", `rotate(${fixed(V.lean, 2)}deg) scale(${V.puff.toFixed(3)},${V.squash.toFixed(3)})`);
    this.attr("armL", "d", curve(V.aL));
    this.attr("armR", "d", curve(V.aR));
    const blink = o.blink ?? 1;
    this.attr("eyeL", "ry", fixed(V.ry * blink, 2));
    this.attr("eyeR", "ry", fixed(V.ry * blink, 2));
    this.attr("socketL", "ry", String(V.sry));
    this.attr("socketR", "ry", String(V.sry));
    this.attr("eyeL", "cx", fixed(39 + V.gx * 3, 2));
    this.attr("eyeR", "cx", fixed(61 + V.gx * 3, 2));
    this.attr("eyeL", "cy", fixed(49 + V.gy * 2, 2));
    this.attr("eyeR", "cy", fixed(49 + V.gy * 2, 2));
    this.sty("look", "transform", `translate(${fixed(V.gx * 3, 2)}px,${fixed(V.gy * 2.4, 2)}px)`);
    this.attr("browL", "d", line(V.bl));
    this.attr("browR", "d", line(V.br));
    this.sty("browL", "opacity", fixed(V.bo, 2));
    this.sty("browR", "opacity", fixed(V.bo, 2));
    const speak = o.speak ?? 0, open = speak > 0.12;
    this.attr("mouth", "d", curve(V.m));
    this.sty("mouth", "opacity", open ? "0" : "1");
    this.sty("gasp", "opacity", open ? "1" : "0");
    this.attr("gasp", "ry", fixed(1.6 + 4.2 * speak, 2));
    this.attr("gasp", "rx", fixed(3.4 + 1.8 * speak, 2));
    this.sty("clench", "opacity", V.clench && !open ? "0.7" : "0");
    this.sty("blushL", "opacity", fixed(V.blush * 0.5, 2));
    this.sty("blushR", "opacity", fixed(V.blush * 0.5, 2));
    this.sty("sweat", "opacity", fixed(V.sweat, 2));
    this.sty("tear", "opacity", fixed(V.tear, 2));
    this.sty("face", "opacity", fixed(1 - V.back, 2));
    this.sty("nape", "opacity", fixed(V.back * 0.8, 2));
    this.style(this.el, "el.opacity", "opacity", fixed(1 - V.hide, 2));
    this.style(this.el, "el.filter", "filter", V.blur > 0.05 || V.dim > 0.02 ? `blur(${fixed(V.blur)}px) brightness(${fixed(1 - V.dim, 2)})` : "");
  }
}
