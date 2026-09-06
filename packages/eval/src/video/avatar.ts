import type { RecordedEmotion } from './types.js';

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

// Only top-level dimensions are eligible. Per-target relational values remain private context.
const socialFaces: Record<string, string> = {
  resentment: 'angry', contempt: 'angry', jealousy: 'angry', envy: 'angry',
  humiliation: 'worried', shame: 'worried', suspicion: 'worried', neediness: 'worried',
  socialAnxiety: 'worried', fearOfExclusion: 'worried',
  affection: 'smile', admiration: 'smile', pride: 'smile', joy: 'smile', relief: 'smile',
};
function dominantSocial(values: Record<string, number>): [string, number] | undefined {
  return Object.entries(values).filter(([key, value]) => socialFaces[key] && value >= .6)
    .sort((a, b) => b[1] - a[1])[0];
}

/** A visual approximation of recorded state, never a dialogue classifier. */
export function faceFor(emotion?: RecordedEmotion): string {
  if (!emotion) return 'neutral';
  const label = emotion.label?.toLowerCase().trim();
  const labels: Record<string, string> = {
    angry: 'angry', anger: 'angry', rage: 'angry', furious: 'angry', irritated: 'angry',
    worried: 'worried', afraid: 'worried', anxious: 'worried', sad: 'worried',
    tired: 'tired', bored: 'tired', sleepy: 'tired',
    smile: 'smile', happy: 'smile', joy: 'smile', relieved: 'smile', satisfied: 'smile',
    shock: 'shock', shocked: 'shock', surprised: 'shock', neutral: 'neutral', calm: 'neutral',
  };
  // Replay labels can be raw dimension names; unrecognized names must still use recorded values.
  if (label && labels[label]) return labels[label]!;
  const value = emotion.values ?? {};
  const drivers = (emotion.drivers ?? []).map(d => d.toLowerCase().replaceAll('_', ''));
  if (drivers.some(d => ['anger', 'resentment', 'hostility', 'irritation'].includes(d))) return 'angry';
  if (drivers.some(d => ['fear', 'anxiety', 'socialanxiety', 'shame', 'guilt'].includes(d))) return 'worried';
  if (drivers.some(d => ['joy', 'relief', 'gratitude', 'warmth', 'affection'].includes(d))) return 'smile';
  const social = dominantSocial(value);
  if (social) return socialFaces[social[0]]!;
  if (typeof value.valence === 'number') {
    if (value.valence < -0.25) return (value.arousal ?? 0) > 0.65 ? 'angry' : 'worried';
    if (value.valence > 0.25) return 'smile';
  }
  if (typeof value.energy === 'number' && value.energy < 0.25) return 'tired';
  return 'neutral';
}

export function emotionLabel(emotion?: RecordedEmotion): string {
  if (!emotion) return '';
  const prefix = emotion.source === 'authored' ? 'Authored' : 'Recorded';
  if (emotion.label) return `${prefix}: ${emotion.label}`;
  if (emotion.drivers?.length) return `${prefix} drivers: ${emotion.drivers.join(', ')}`;
  const values = Object.entries(emotion.values ?? {}).filter(([key]) => ['valence', 'arousal', 'energy'].includes(key));
  const social = dominantSocial(emotion.values ?? {});
  if (social) values.unshift(social);
  return values.length ? `${prefix} ${values.map(([key, value]) => `${key} ${value}`).join(' · ')}` : `${prefix} state`;
}
