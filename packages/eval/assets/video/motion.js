// One seekable timeline owns camera, cast, cards, and recorded expressions.
const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });
const positions = new Map();
function pose(index, x, y, scale, opacity, at, duration = .4) {
  const key = [x, y, scale, opacity].join(',');
  if (positions.get(index) === key) return;
  positions.set(index, key);
  tl.to('#actor-' + index, { x: x - 70, y: y - 70, scale, opacity, duration }, at);
}
function expression(index, state, at) {
  const faces = {
    neutral: [6, 'M30 33L44 33', 'M56 33L70 33', 'M43 64Q50 64 57 64', 0],
    angry: [4.3, 'M29 28L44 36', 'M56 36L71 28', 'M40 67Q50 58 60 67', 1],
    worried: [7, 'M30 35L44 28', 'M56 28L70 35', 'M43 67Q50 60 57 67', 1],
    tired: [3.5, 'M30 33L44 34', 'M56 34L70 33', 'M43 66Q50 64 57 66', .7],
    smile: [5.5, 'M30 30L44 31', 'M56 31L70 30', 'M40 61Q50 76 60 61', 0],
    shock: [8, 'M30 26L44 25', 'M56 25L70 26', 'M43 64Q50 64 57 64', 1],
  };
  const face = faces[state] || faces.neutral, target = '#actor-' + index;
  tl.to(target + ' .eye', { attr: { ry: face[0] }, duration: .17 }, at);
  tl.to(target + ' .bl', { attr: { d: face[1] }, opacity: face[4], duration: .17 }, at);
  tl.to(target + ' .br', { attr: { d: face[2] }, opacity: face[4], duration: .17 }, at);
  tl.to(target + ' .mouth', { attr: { d: face[3] }, opacity: state === 'shock' ? 0 : 1, duration: .17 }, at);
  tl.to(target + ' .gasp', { opacity: state === 'shock' ? 1 : 0, duration: .17 }, at);
}
if (VIDEO.count) tl.set('.actor', { x: 890, y: 823, scale: .4, opacity: 0 }, 0);
const introCount = Math.min(VIDEO.count, 24);
const columns = Math.min(5, Math.max(1, introCount)), rows = Math.ceil(introCount / columns);
for (let i = 0; i < introCount; i++) {
  const col = i % columns, row = Math.floor(i / columns);
  const x = columns === 1 ? 960 : 270 + col * 1380 / (columns - 1);
  const y = rows === 1 ? 615 : 430 + row * 460 / (rows - 1);
  tl.set('#actor-' + i, { x: x - 70, y: y - 70, scale: Math.min(.95, 3.2 / rows), opacity: 1 }, 0);
}
tl.set('#progress i', { scaleX: 0 }, 0);
tl.set('#brand', { x: 80, y: 40, scale: .3 }, 0);
tl.to('#brand', { opacity: 1, duration: .3 }, VIDEO.first - .25);
tl.to('#intro', { opacity: 0, y: -25, duration: .3 }, Math.max(.1, VIDEO.first - .4));
tl.to('#top,#board,#progress', { opacity: 1, duration: .3 }, VIDEO.first - .25);
for (const [i, beat] of VIDEO.beats.entries()) {
  const at = beat.start, stop = at + beat.duration, active = beat.actor;
  const remaining = Array.from({ length: VIDEO.count }, (_, n) => n).filter(n => n !== active);
  // A moving cast window keeps arbitrarily large runs readable; every active agent appears.
  const offset = active < 0 ? Math.floor(i / 8) * 8 % Math.max(1, remaining.length) : Math.max(0, Math.floor(active / 7) * 7 - 1);
  const rail = remaining.slice(offset, offset + 8);
  for (let n = 0; n < VIDEO.count; n++) {
    const slot = rail.indexOf(n);
    if (n === active) pose(n, 315, 473, 1.7, 1, at, .45);
    else if (slot >= 0) pose(n, rail.length === 1 ? 960 : 210 + slot * 1500 / (rail.length - 1), 893, .58, 1, at);
    else pose(n, 960, 900, .4, 0, at, .2);
  }
  if (active >= 0 && beat.face) expression(active, beat.face, at + .12);
  if (active >= 0) {
    tl.to('#actor-' + active + ' .look', { x: 2.5, y: 0, duration: .2 }, at + .12);
    tl.to('#actor-' + active + ' .look', { x: 0, duration: .2 }, stop - .5);
  }
  const phaseChange = i === 0 || beat.phase !== VIDEO.beats[i - 1].phase;
  const scale = beat.kind === 'state' || active < 0 ? 1 : 1.018;
  tl.to('#world', { x: active % 2 ? -8 : 8, y: phaseChange ? 0 : -5, scale, duration: .42, ease: 'power2.inOut' }, at);
  tl.to('#head-' + i, { opacity: 1, duration: .18 }, at + .1);
  tl.to('#head-' + i, { opacity: 0, duration: .12 }, stop - .15);
  const card = '#card-' + i, x = active < 0 ? 410 : 630;
  tl.set(card, { x: active < 0 ? x : 455, y: 345, scale: .82 }, at);
  tl.to(card, { x, y: 285, scale: 1, opacity: 1, duration: .4 }, at + .12);
  tl.to('#progress i', { scaleX: (i + 1) / VIDEO.beats.length, duration: .35, ease: 'none' }, at);
  // The same source card retires to a bounded history stack, then clears.
  tl.to(card + ' .words', { opacity: 0, duration: .12 }, stop - .35);
  tl.to(card + ' .skeleton', { opacity: 1, duration: .16 }, stop - .3);
  tl.to(card, { x: 1270 + i % 3 * 35, y: 755 + i % 3 * 10, scale: .2, rotation: (i % 3 - 1) * 3, duration: .35 }, stop - .3);
  tl.to(card, { opacity: 0, duration: .2 }, Math.min(stop + 1, VIDEO.duration - 3));
}
const end = Math.max(VIDEO.first, VIDEO.duration - 3);
tl.to('#world,#top,#progress', { opacity: 0, duration: .35 }, end);
tl.to('#outro', { opacity: 1, duration: .35 }, end + .1);
tl.to('#brand', { x: 850, y: 230, scale: 1, duration: .65, ease: 'power3.inOut' }, end);
window.__timelines = window.__timelines || {};
window.__timelines['run-video'] = tl;
