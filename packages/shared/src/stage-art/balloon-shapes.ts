/**
 * The ink of a balloon: outline and fill for each kind, as SVG markup in the
 * balloon's own coordinates, with the tail ending at (tx, ty). Pure strings so
 * the player and the video renderer draw the same thing.
 */
import type { BalloonKind } from "../director/types.js";

export const INK = "#1d1f1a";
export const PAPER = "#fffdf6";

const f = (n: number): string => n.toFixed(1);
const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

const roundedRect = (W: number, H: number, r: number): string =>
  `M${r} 0H${W - r}Q${W} 0 ${W} ${r}V${H - r}Q${W} ${H} ${W - r} ${H}H${r}Q0 ${H} 0 ${H - r}V${r}Q0 0 ${r} 0Z`;

type Tail = { d: string; a: { x: number; y: number }; b: { x: number; y: number } };

function tailPath(W: number, H: number, tx: number, ty: number, kind: BalloonKind): Tail {
  const cx = W / 2, cy = H / 2, dx = tx - cx, dy = ty - cy;
  const fromTopBottom = Math.abs(dy) / (H / 2) >= Math.abs(dx) / (W / 2);
  let bx: number, by: number, nx: number, ny: number;
  if (fromTopBottom) { by = dy > 0 ? H : 0; bx = clamp(cx + dx * 0.35, W * 0.2, W * 0.8); nx = 1; ny = 0; }
  else { bx = dx > 0 ? W : 0; by = clamp(cy + dy * 0.35, H * 0.25, H * 0.75); nx = 0; ny = 1; }
  const len = Math.hypot(tx - bx, ty - by);
  const hw = clamp(len * 0.16, kind === "whisper" ? 7 : 9, kind === "whisper" ? 10 : 16);
  const a = { x: bx - nx * hw, y: by - ny * hw }, b = { x: bx + nx * hw, y: by + ny * hw };
  const mx = (bx + tx) / 2 + (ny ? (dx > 0 ? -6 : 6) : 0), my = (by + ty) / 2;
  return { d: `M${f(a.x)} ${f(a.y)}Q${f(mx - nx * 3)} ${f(my - ny * 3)} ${f(tx)} ${f(ty)}Q${f(mx + nx * 7)} ${f(my + ny * 7)} ${f(b.x)} ${f(b.y)}Z`, a, b };
}

function burst(W: number, H: number): string {
  const cx = W / 2, cy = H / 2, n = 16, pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const k = i % 2 ? 0.8 : 1.06, an = (i / (n * 2)) * Math.PI * 2;
    pts.push(`${f(cx + Math.cos(an) * (W / 2 + 8) * k)} ${f(cy + Math.sin(an) * (H / 2 + 8) * k)}`);
  }
  return `M${pts.join("L")}Z`;
}

export function balloonShape(kind: BalloonKind, W: number, H: number, tx: number, ty: number): string {
  const sw = 3.2;
  let inner = "";
  if (kind === "thought") {
    const r = Math.max(15, Math.min(28, H * 0.26)), n = 14, rx = W / 2 - 8, ry = H / 2 - 8;
    for (let i = 0; i < n; i++) {
      const an = (i / n) * Math.PI * 2;
      inner += `<circle cx="${f(W / 2 + Math.cos(an) * rx)}" cy="${f(H / 2 + Math.sin(an) * ry)}" r="${f(r)}" fill="${PAPER}" stroke="${INK}" stroke-width="${sw}"/>`;
    }
    inner += `<ellipse cx="${W / 2}" cy="${H / 2}" rx="${W / 2 - 10}" ry="${H / 2 - 10}" fill="${PAPER}"/>`;
    // A trail of little bubbles toward the thinker.
    const dx = tx - W / 2, dy = ty - H / 2, L = Math.hypot(dx, dy) || 1;
    const ex = W / 2 + (dx / L) * Math.min(W / 2, (H / 2) * Math.abs(dx / (dy || 1)) || W / 2), ey = H / 2 + (dy / L) * (H / 2);
    for (const [u, r] of [[0.14, 10], [0.5, 7], [0.84, 5]] as const) {
      inner += `<circle cx="${f(ex + (tx - ex) * u)}" cy="${f(ey + (ty - ey) * u)}" r="${r}" fill="${PAPER}" stroke="${INK}" stroke-width="${sw - 0.6}"/>`;
    }
  } else if (kind === "shout") {
    const tp = tailPath(W, H, tx, ty, "shout");
    inner += `<path d="${tp.d}" fill="${PAPER}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/><path d="${burst(W, H)}" fill="${PAPER}" stroke="${INK}" stroke-width="${sw + 0.4}" stroke-linejoin="round"/>`;
  } else if (kind === "whisper") {
    const tp = tailPath(W, H, tx, ty, "whisper");
    inner += `<path d="${tp.d}" fill="${PAPER}" fill-opacity=".94" stroke="${INK}" stroke-width="2.2" stroke-dasharray="5 5"/><path d="${roundedRect(W, H, Math.min(22, H / 2))}" fill="${PAPER}" fill-opacity=".94" stroke="${INK}" stroke-width="2.2" stroke-dasharray="6 5"/>`;
  } else {
    const tp = tailPath(W, H, tx, ty, "speech");
    inner += `<path d="${tp.d}" fill="${PAPER}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/><path d="${roundedRect(W, H, Math.min(26, H / 2))}" fill="${PAPER}" stroke="${INK}" stroke-width="${sw}"/>` +
      // Paint over the seam where the tail meets the body.
      `<path d="M${f(tp.a.x)} ${f(tp.a.y)}L${f(tp.b.x)} ${f(tp.b.y)}" stroke="${PAPER}" stroke-width="${sw + 1.5}" stroke-linecap="butt"/>`;
  }
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="overflow:visible"><g filter="url(#balloon-wobble)">${inner}</g></svg>`;
}

/** The hand-drawn wobble filter every balloon references; define it once per page. */
export const BALLOON_FILTER_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><filter id="balloon-wobble" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".022" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3.4"/></filter></defs></svg>`;

export type MarkKind = "steam" | "sweat" | "heart" | "?" | "*" | "!";
const MARKS: Record<MarkKind, string> = {
  "!": `<text x="0" y="0" font-family="Londrina Solid" font-size="38" fill="#e0453a" stroke="${INK}" stroke-width="2.4" paint-order="stroke" text-anchor="middle">!</text>`,
  "?": `<text x="0" y="0" font-family="Londrina Solid" font-size="38" fill="#f0b43a" stroke="${INK}" stroke-width="2.4" paint-order="stroke" text-anchor="middle">?</text>`,
  "*": `<path d="M0-14L4-4 15-4 6 3 9 14 0 8-9 14-6 3-15-4-4-4Z" fill="#f4cf5a" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`,
  heart: `<path d="M0 12C-18-2-12-16-4-14-1-13 0-10 0-8 0-10 1-13 4-14 12-16 18-2 0 12Z" fill="#ee5d7a" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`,
  sweat: `<path d="M0-14Q-10 2 0 10Q10 2 0-14Z" fill="#9fd6ff" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`,
  steam: `<g fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"><path d="M-12 12Q-18 2-10-2Q-4-6-10-14"/><path d="M0 14Q-6 4 2-2Q8-8 2-16"/><path d="M12 12Q6 2 14-2Q20-6 14-14"/></g>`,
};

/** A reaction mark around a head, in a 60 x 60 box centred on (0, 0). */
export function markMarkup(kind: MarkKind): string {
  return `<svg viewBox="-30 -30 60 60" width="60" height="60" style="overflow:visible">${MARKS[kind]}</svg>`;
}
