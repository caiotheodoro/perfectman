/**
 * A character as SVG markup with named parts, so a renderer can pose it by
 * setting attributes on those parts (see the web `CharacterRig`). Pure string.
 */
import { mix } from "./light.js";
import { silhouetteFor, colorFor } from "./silhouettes.js";
import type { SignatureProp } from "../director/persona-signature.js";

/** The part names a rig looks up with `[data-part="..."]`. */
export const FIGURE_PARTS = [
  "rig", "breath", "shake", "armL", "armR", "eyeL", "eyeR", "socketL", "socketR", "browL", "browR",
  "mouth", "gasp", "clench", "look", "blushL", "blushR", "sweat", "tear", "face", "nape",
] as const;
export type FigurePart = (typeof FIGURE_PARTS)[number];

const PROPS: Record<Exclude<SignatureProp, null>, { front: boolean; markup: string }> = {
  ledger: { front: true, markup: `<g transform="translate(66 138) rotate(-8)"><rect width="46" height="34" rx="3" fill="#8a3a2a"/><rect x="4" y="4" width="38" height="26" rx="2" fill="#f1e3c3"/><path d="M9 11h26M9 17h20M9 23h24" stroke="#8a3a2a" stroke-width="2"/></g>` },
  phone: { front: true, markup: `<g transform="translate(96 146) rotate(8)"><rect width="22" height="36" rx="4" fill="#1d2232"/><rect x="2.5" y="3" width="17" height="30" rx="2.5" fill="#8fd0ff" opacity=".9"/></g>` },
  clipboard: { front: true, markup: `<g transform="translate(76 134) rotate(-4)"><rect width="44" height="52" rx="3" fill="#7a5a35"/><rect x="5" y="9" width="34" height="38" fill="#f7f3e6"/><rect x="15" y="3" width="14" height="9" rx="2" fill="#aaa"/><path d="M10 20h24M10 27h24M10 34h16" stroke="#2d432c" stroke-width="2"/></g>` },
  glasses: { front: false, markup: `<g transform="translate(31 25) scale(1.6)" fill="none" stroke="#262920" stroke-width="1.8"><circle cx="39" cy="49" r="11"/><circle cx="61" cy="49" r="11"/><path d="M50 49h0M28 47l-5-3M72 47l5-3"/></g>` },
};

export type FigureMarkupOptions = { index: number; prop?: SignatureProp };

export function figureMarkup({ index, prop = null }: FigureMarkupOptions): string {
  const color = colorFor(index);
  const arm = mix(color, "#262920", 0.38);
  const p = prop ? PROPS[prop] : null;
  return `<svg viewBox="0 0 220 218" aria-hidden="true" focusable="false"><ellipse cx="110" cy="206" rx="64" ry="7" fill="#000" opacity=".28"/>
<g data-part="shake"><g data-part="rig"><g data-part="breath">
<ellipse cx="80" cy="204" rx="16" ry="7" fill="${arm}"/><ellipse cx="140" cy="204" rx="16" ry="7" fill="${arm}"/>
<path d="${silhouetteFor(index)}" fill="${color}"/>
<path data-part="armL" fill="none" stroke="${arm}" stroke-width="12" stroke-linecap="round" d="M46 130Q30 152 36 178"/>

<g data-part="face" transform="translate(31 25) scale(1.6)"><g data-part="look">
<ellipse data-part="socketL" cx="39" cy="49" rx="8.5" ry="12.5" fill="#fffbed"/><ellipse data-part="socketR" cx="61" cy="49" rx="8.5" ry="12.5" fill="#fffbed"/>
<ellipse data-part="eyeL" cx="39" cy="49" rx="3.4" ry="6" fill="#262920"/><ellipse data-part="eyeR" cx="61" cy="49" rx="3.4" ry="6" fill="#262920"/>
<path data-part="browL" fill="none" stroke="#262920" stroke-width="2.6" stroke-linecap="round" d="M30 33L44 33"/><path data-part="browR" fill="none" stroke="#262920" stroke-width="2.6" stroke-linecap="round" d="M56 33L70 33"/>
<path data-part="mouth" fill="none" stroke="#262920" stroke-width="2.6" stroke-linecap="round" d="M43 64Q50 64 57 64"/>
<ellipse data-part="gasp" cx="50" cy="68" rx="4.5" ry="3.5" fill="#262920" opacity="0"/>
<path data-part="clench" d="M42 70l3 3M50 71l0 4M58 70l-3 3" stroke="#262920" stroke-width="1.6" stroke-linecap="round" fill="none" opacity="0"/>
<ellipse data-part="blushL" cx="29" cy="62" rx="6" ry="3.4" fill="#e0505a" opacity="0"/><ellipse data-part="blushR" cx="71" cy="62" rx="6" ry="3.4" fill="#e0505a" opacity="0"/>
<path data-part="sweat" d="M76 30q-4 6 0 9q4-3 0-9z" fill="#bfe3ff" opacity="0"/>
<path data-part="tear" d="M33 66q-4 6 0 9q4-3 0-9z" fill="#9fd0ff" opacity="0"/>
</g></g>
${p && !p.front ? p.markup : ""}
<path data-part="nape" d="M92 36q18-10 36 0M98 46q12-6 24 0" fill="none" stroke="${arm}" stroke-width="5" stroke-linecap="round" opacity="0"/>
<path data-part="armR" fill="none" stroke="${arm}" stroke-width="12" stroke-linecap="round" d="M174 130Q190 152 184 178"/>
${p && p.front ? p.markup : ""}
</g></g></g></svg>`;
}
