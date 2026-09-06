/**
 * The MP4 renderer's figure. Its palette is its own — the film is dark and
 * purple, the web stage is paper and highlighter — but the face logic is not:
 * `faceFor` and `emotionLabel` live in `@perfectman/shared` so both renderers
 * read a recorded emotion the same way.
 */
export { emotionLabel, faceFor } from "@perfectman/shared";

const colors = ['#d8d9dd', '#202022', '#6b55f5', '#746b8b', '#424653', '#827786'];
export const avatarColor = (index: number): string => colors[index % colors.length]!;
export function avatar(index: number): string {
  const light = index % colors.length === 0;
  const shape = index % 3 === 0
    ? '<circle cx="50" cy="48" r="43"/>'
    : '<path d="M50 6a42 42 0 1 0 30 72l16-2-11-14A42 42 0 0 0 50 6Z"/>';
  return `<svg class="avatar" viewBox="0 0 100 160" aria-hidden="true">
    <g class="torso" fill="${avatarColor(index)}">
      <rect x="28" y="87" width="44" height="46" rx="18"/>
      <path class="leg leg-left" d="M39 126L34 150" stroke="${avatarColor(index)}" stroke-width="11" stroke-linecap="round"/>
      <path class="leg leg-right" d="M61 126L66 150" stroke="${avatarColor(index)}" stroke-width="11" stroke-linecap="round"/>
    </g>
    <g class="arm arm-left" fill="${avatarColor(index)}" stroke="${avatarColor(index)}" stroke-width="9" stroke-linecap="round">
      <path d="M31 101Q15 103 13 121" fill="none"/><circle cx="13" cy="124" r="6" stroke="none"/>
    </g>
    <g class="arm arm-right" fill="${avatarColor(index)}" stroke="${avatarColor(index)}" stroke-width="9" stroke-linecap="round">
      <path d="M69 101Q85 103 87 121" fill="none"/><circle cx="87" cy="124" r="6" stroke="none"/>
    </g>
    <g class="head"><g fill="${avatarColor(index)}">${shape}</g>
    <g class="look" style="--ink:${light ? '#202022' : '#fff'}">
      <ellipse class="eye" cx="40" cy="47" rx="5.5" ry="6"/>
      <ellipse class="eye" cx="60" cy="47" rx="5.5" ry="6"/>
      <path class="brow bl" d="M30 33L44 33"/><path class="brow br" d="M56 33L70 33"/>
      <path class="mouth" d="M43 64Q50 64 57 64"/>
      <ellipse class="gasp" cx="50" cy="65" rx="5" ry="7"/>
    </g></g><g class="accent" fill="none" stroke="#6b55f5" stroke-width="2.5" stroke-linecap="round">
      <path d="M7 20L2 14M17 11L15 4M83 11L86 4M93 21L98 15"/>
    </g></svg>`;
}

