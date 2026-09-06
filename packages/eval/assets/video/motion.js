// One timeline is shared by MP4 export and the interactive viewer.
const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });
const positions = new Map(), recordedFaces = new Map(), channelSlots = new Map();
function followRow(windowId, itemsId, rowId, at) {
  const viewport = document.getElementById(windowId), items = document.getElementById(itemsId), row = document.getElementById(rowId);
  if (!row) return;
  const offset = Math.max(0, Math.min(items.scrollHeight - viewport.clientHeight, row.offsetTop - viewport.clientHeight / 2 + row.offsetHeight / 2));
  tl.to(items, { y: -offset, duration: .32 }, at);
}
function stageLayout(beat, kind) {
  const actionTargets = beat.stageAction?.kind === 'invite' ? [] : beat.stageAction?.actorIndexes || [];
  const preferred = [...new Set([...actionTargets, beat.actor, ...beat.recipientIndexes, ...beat.participantIndexes])].filter(i => beat.participantIndexes.includes(i));
  const points = kind === 'thought' ? [[652, 613, 1.35]] : kind === 'private'
    ? [[517, 627, 1.05], [819, 627, 1.05], [665, 449, .72], [457, 789, .63], [898, 790, .63]]
    : [[503, 633, 1.05], [845, 633, 1.02], [584, 451, .7], [798, 445, .7], [399, 795, .65], [925, 795, .65]];
  const visible = preferred.slice(0, points.length), previous = channelSlots.get(beat.channelIndex) || new Map();
  const slots = new Map([...previous].filter(([index]) => visible.includes(index)));
  for (const index of visible) if (!slots.has(index)) {
    const available = points.findIndex((_, slot) => ![...slots.values()].includes(slot));
    slots.set(index, available);
  }
  channelSlots.set(beat.channelIndex, slots);
  return new Map([...slots].map(([index, slot]) => [index, { x: points[slot][0], y: points[slot][1], scale: points[slot][2] }]));
}
if (VIDEO.count) tl.set('.actor', { x: 890, y: 650, scale: .45, opacity: 0 }, 0);
const introCount = Math.min(VIDEO.count, 12), columns = Math.min(4, Math.max(1, introCount)), rows = Math.ceil(introCount / columns);
for (let i = 0; i < introCount; i++) {
  const x = columns === 1 ? 1100 : 490 + i % columns * 1120 / (columns - 1);
  const y = rows === 1 ? 620 : 500 + Math.floor(i / columns) * 340 / (rows - 1);
  tl.set('#actor-' + i, { x: x - 105, y: y - 150, scale: Math.min(.9, 1.8 / rows), opacity: 1 }, 0);
}
tl.set('#progress i', { scaleX: 0 }, 0);
tl.set('#brand', { x: 33, y: 29, scale: .32 }, 0);
tl.to('#brand,#sidebar', { opacity: 1, duration: .3 }, Math.max(0, VIDEO.first - .4));
tl.to('#intro', { opacity: 0, y: -25, duration: .3 }, Math.max(.1, VIDEO.first - .4));
tl.to('#top,#progress,#room-set', { opacity: 1, duration: .3 }, VIDEO.first - .25);
if (document.getElementById('place')) tl.to('#place', { opacity: 1, duration: .3 }, VIDEO.first);
for (const [i, beat] of VIDEO.beats.entries()) {
  const at = beat.start, stop = at + beat.duration, channel = VIDEO.channels[beat.channelIndex];
  const changed = i === 0 || beat.channelIndex !== VIDEO.beats[i - 1].channelIndex;
  const layout = stageLayout(beat, channel.kind);
  if (beat.face && beat.actor >= 0) { recordedFaces.set(beat.actor, beat.face); expression(beat.actor, beat.face, at + .12); }
  if (changed) {
    tl.to('.channel-row', { backgroundColor: 'transparent', borderLeftColor: 'transparent', color: '#39383f', duration: .16 }, at);
    tl.to('#channel-' + beat.channelIndex, { backgroundColor: '#e8e2f7', borderLeftColor: '#6b55f5', color: '#40326b', duration: .2 }, at);
    followRow('channel-window', 'channel-items', 'channel-' + beat.channelIndex, at);
  }
  if (beat.actor >= 0) {
    followRow('cast-window', 'cast-items', 'roster-' + beat.actor, at);
    tl.to('.cast-row', { color: '#39383f', duration: .15 }, at);
    tl.to('#roster-' + beat.actor, { color: '#5b46c5', duration: .15 }, at);
  }
  for (const kind of ['public', 'private', 'thought', 'operator']) tl.to('#' + kind + '-set', { opacity: channel.kind === kind ? 1 : 0, duration: .3 }, at);
  tl.to('#table', { opacity: channel.kind === 'public' || channel.kind === 'private' ? 1 : 0, duration: .25 }, at);
  tl.to('#room-camera', { x: channel.kind === 'thought' ? -5 : 0, scale: channel.kind === 'thought' ? 1.035 : 1, duration: .4 }, at);
  const arrivals = beat.stageAction?.kind === 'arrive' && beat.page === 0
    ? beat.stageAction.actorIndexes.filter(actor => layout.has(actor)) : [];
  for (let actor = 0; actor < VIDEO.count; actor++) {
    if (!layout.has(actor)) { tl.to('#actor-' + actor, { opacity: 0, duration: .18 }, at); positions.delete(actor); }
    else if (arrivals.includes(actor)) { tl.set('#actor-' + actor, { opacity: 0 }, at); positions.set(actor, layout.get(actor)); }
    else actorPose(actor, layout.get(actor), at, changed);
  }
  if (arrivals.length) {
    const stagger = Math.min(.24, Math.max(0, (beat.duration - 1.2) / arrivals.length));
    arrivals.forEach((actor, index) => walk(actor, layout.get(actor), at + .1 + index * stagger, true));
    tl.to('#door-leaf', { rotationY: -52, svgOrigin: '377 455', duration: .2 }, at);
    tl.to('#door-leaf', { rotationY: 0, duration: .25 }, at + .8 + (arrivals.length - 1) * stagger);
  }
  if (beat.stageAction?.kind === 'leave' && beat.page === beat.pageCount - 1) {
    for (const actor of beat.stageAction.actorIndexes) if (layout.has(actor)) walk(actor, { x: 425, y: 487, scale: .6 }, stop - 1, false);
  }
  microInteractions(beat, layout);
  tl.to('#head-' + i, { opacity: 1, duration: .18 }, at + .1);
  tl.to('#head-' + i, { opacity: 0, duration: .12 }, stop - .15);
  const card = '#card-' + i;
  tl.set(card, { x: beat.actor < 0 ? 1090 : 900, y: 343, scale: .88 }, at);
  tl.to(card, { x: 1050, y: 286, scale: 1, opacity: 1, duration: .35 }, at + .12);
  tl.to('#progress i', { scaleX: (i + 1) / VIDEO.beats.length, duration: .3, ease: 'none' }, at);
  tl.to(card + ' .words', { opacity: 0, duration: .12 }, stop - .3);
  tl.to(card + ' .skeleton', { opacity: 1, duration: .15 }, stop - .27);
  tl.to(card, { x: 1430 + i % 3 * 26, y: 848 + i % 3 * 10, scale: .23, rotation: (i % 3 - 1) * 2, duration: .32 }, stop - .25);
  tl.to(card, { opacity: 0, duration: .18 }, Math.min(stop + .55, VIDEO.duration - VIDEO.outroDuration));
}
const end = Math.max(VIDEO.first, VIDEO.duration - VIDEO.outroDuration);
tl.to('#world,#top,#progress,#sidebar', { opacity: 0, duration: .35 }, end);
tl.to('#outro', { opacity: 1, duration: .35 }, end + .1);
tl.to('#brand', { x: 850, y: 185, scale: 1, duration: .65, ease: 'power3.inOut' }, end);
tl.set('#outro', { opacity: 1 }, VIDEO.duration);
window.__timelines = window.__timelines || {};
window.__timelines['run-video'] = tl;
