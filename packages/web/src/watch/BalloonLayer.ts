/**
 * Draws the balloons and reaction marks `sampleTimeline` says are live.
 *
 * Elements are made once per balloon page and then only moved, faded and
 * revealed: nothing is rebuilt per frame. A balloon's slot is stored in world
 * coordinates, so it rides the camera, and its words appear as they land.
 */
import {
  BALLOON_FILTER_DEFS, INK, balloonShape, fontFor, markMarkup, colorFor,
  type Balloon, type CameraState, type Sample,
} from "@perfectman/shared";

const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));
const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const CJK = /[぀-ヿ一-鿿]/;

type Made = { el: HTMLDivElement; words: HTMLElement[]; count: number; shown: boolean; last: number; transform: string; opacity: string; page: number };

export type BalloonLayerContext = {
  archetype: (id: string) => string;
  name: (id: string) => string;
  /** Roster position, which fixes a character's colour. */
  index: (id: string) => number;
};

export class BalloonLayer {
  private readonly root: HTMLDivElement;
  private readonly made = new Map<string, Made>();

  constructor(host: HTMLElement, private readonly ctx: BalloonLayerContext) {
    this.root = document.createElement("div");
    this.root.className = "watch-balloons";
    this.root.innerHTML = BALLOON_FILTER_DEFS;
    host.append(this.root);
  }

  private make(b: Balloon, pageIndex: number): Made {
    const pg = b.pages![pageIndex]!, slot = b.slot!;
    const dy = slot.tip.y > slot.cy ? (b.pages![0]!.H - pg.H) / 2 : 0; // a shorter page stays glued to the head
    const tx = pg.W / 2 + (slot.tip.x - slot.cx), ty = pg.H / 2 + (slot.tip.y - (slot.cy + dy));
    const font = fontFor(b.kind, this.ctx.archetype(b.actor), b.arousal);
    const el = document.createElement("div");
    el.className = `watch-balloon watch-balloon--${b.kind}`;
    el.style.cssText = `width:${pg.W}px;height:${pg.H}px;display:none`;
    el.innerHTML = balloonShape(b.kind, pg.W, pg.H, tx, ty);
    const pad = b.kind === "shout" ? "34px 46px" : b.kind === "thought" ? "22px 34px 30px" : "12px 20px";
    const text = document.createElement("div");
    text.className = "watch-balloon__text";
    text.style.cssText = `font:${font.weight} ${font.size}px/${font.lineHeight} "${font.family}",system-ui,sans-serif;padding:${pad};color:${INK};${b.kind === "shout" ? "text-transform:uppercase;letter-spacing:.01em;" : ""}`;
    let k = 0;
    const lines = pg.lines.map((l) => {
      const cjk = CJK.test(l);
      return `<div class="watch-balloon__line">${(cjk ? [...l] : l.split(" ").filter(Boolean)).map((w) => `<span class="w" data-i="${k++}">${esc(w)}</span>`).join(cjk ? "" : " ")}</div>`;
    });
    text.innerHTML = lines.join("");
    el.append(text);
    if (b.kind !== "thought") {
      const tag = document.createElement("span");
      tag.className = "watch-balloon__tag";
      tag.textContent = this.ctx.name(b.actor);
      tag.style.background = colorFor(this.ctx.index(b.actor));
      el.append(tag);
    } else {
      const chips = document.createElement("div");
      chips.className = "watch-balloon__chips";
      chips.innerHTML = (b.drivers ?? []).slice(0, 2).map((d) => `<span>${esc(d)}</span>`).join("");
      el.append(chips);
    }
    if (b.pages!.length > 1 && pageIndex < b.pages!.length - 1) {
      const more = document.createElement("span");
      more.className = "watch-balloon__more";
      more.textContent = "▸";
      el.append(more);
    }
    el.style.transformOrigin = `${tx}px ${ty}px`;
    el.style.zIndex = String(Math.round(1000 + b.t0 * 10));
    this.root.append(el);
    return { el, words: [...el.querySelectorAll<HTMLElement>(".w")], count: k, shown: false, last: -1, transform: "", opacity: "", page: pageIndex };
  }

  sync(S: Sample, cam: CameraState): void {
    const live = new Set<string>();
    for (const b of S.balloons) {
      if (!b.pages || !b.slot || !b.world) continue;
      b.pages.forEach((pg, i) => {
        if (S.t < pg.t0 || S.t > pg.t1) return;
        const id = `${b.id}:${i}`;
        let m = this.made.get(id);
        if (!m) { m = this.make(b, i); this.made.set(id, m); }
        live.add(id);
        const dy = b.slot!.tip.y > b.slot!.cy ? (b.pages![0]!.H - pg.H) / 2 : 0;
        const sx = (b.world!.c.x - cam.cx) * cam.z + 600, sy = (b.world!.c.y - cam.cy) * cam.z + 300 + dy;
        const appear = clamp((S.t - pg.t0) / 0.22, 0, 1), leave = clamp((pg.t1 - S.t) / 0.35, 0, 1);
        const pop = appear < 1 ? 0.7 + 0.3 * (1 - Math.pow(1 - appear, 3)) + Math.sin(appear * Math.PI) * 0.08 : 1; // ease out, small overshoot
        const scale = pop * (leave < 1 ? 0.92 + 0.08 * leave : 1) * (b.kind === "whisper" ? 0.96 : 1);
        const opacity = (Math.min(appear * 1.6, leave, 1) * (b.kind === "whisper" ? 0.93 : 1)).toFixed(3);
        const transform = `translate(${(sx - pg.W / 2).toFixed(1)}px,${(sy - pg.H / 2).toFixed(1)}px) scale(${scale.toFixed(3)})`;
        if (m.transform !== transform) { m.transform = transform; m.el.style.transform = transform; }
        if (m.opacity !== opacity) { m.opacity = opacity; m.el.style.opacity = opacity; }
        if (!m.shown) { m.shown = true; m.el.style.display = "block"; }
        let count = m.count;
        if (b.kind !== "thought" && b.words.length > 0) {
          count = 0;
          for (let k = 0; k < pg.n; k++) { const w = b.words[pg.w0 + k]; if (w && w.t <= S.t) count++; else break; }
        }
        if (count !== m.last) { m.words.forEach((w, k) => { w.style.opacity = k < count ? "1" : "0"; }); m.last = count; }
      });
    }
    for (const [id, m] of this.made) if (!live.has(id) && m.shown) { m.shown = false; m.el.style.display = "none"; }
  }

  destroy(): void {
    this.root.remove();
    this.made.clear();
  }
}

/** Reaction marks around a head: a pop, a float and a fade. */
export class MarkLayer {
  private readonly root: HTMLDivElement;
  private readonly made = new Map<string, HTMLDivElement>();

  constructor(host: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "watch-marks";
    host.append(this.root);
  }

  sync(S: Sample, cam: CameraState): void {
    const live = new Set<string>();
    for (const { m, k } of S.marks) {
      const id = `${m.t}:${m.actor}`;
      live.add(id);
      let el = this.made.get(id);
      if (!el) { el = document.createElement("div"); el.className = "watch-mark"; el.innerHTML = markMarkup(m.kind); this.root.append(el); this.made.set(id, el); }
      const v = S.chars[m.actor]!.v, h = v.w * 0.99;
      const sx = (v.x + v.w * 0.34 - cam.cx) * cam.z + 600, sy = (v.y - 0.92 * h - cam.cy) * cam.z + 300;
      const pop = k < 0.12 ? (k / 0.12) * 1.25 : k < 0.2 ? 1.25 - ((k - 0.12) / 0.08) * 0.25 : 1;
      const wob = m.kind === "steam" ? Math.sin(k * 30) * 3 : 0;
      el.style.cssText = `display:block;transform:translate(${(sx - 30 + wob).toFixed(1)}px,${(sy - 30 - k * 14).toFixed(1)}px) scale(${pop.toFixed(2)});opacity:${(k > 0.75 ? (1 - k) / 0.25 : 1).toFixed(2)}`;
    }
    for (const [id, el] of this.made) if (!live.has(id)) el.style.display = "none";
  }

  destroy(): void {
    this.root.remove();
    this.made.clear();
  }
}
