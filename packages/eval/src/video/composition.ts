import { readFile } from 'node:fs/promises';
import { avatar, emotionLabel, faceFor } from './avatar.js';
import type { RecordedEmotion, VideoStoryboard } from './types.js';

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]!);
const safeJson = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c')
  .replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');

/** Size text before render, including CJK, hard newlines, and unbroken identifiers. */
function fontSize(text: string, width: number, height: number, maximum: number, field = 'Text'): number {
  let size = maximum;
  const units = text.split('\n').map(line => [...line].reduce((sum, c) => {
    const width = c.codePointAt(0)! > 255 || /[MW@%]/.test(c) ? 1 : /[A-Z]/.test(c) ? .75 : .6;
    return sum + width;
  }, 0));
  const fits = (): boolean => units.reduce((sum, length) => sum + Math.max(1, Math.ceil(length * size / width)), 0) * size * 1.23 <= height;
  while (size > 22 && !fits()) size--;
  if (!fits()) throw new Error(`${field} cannot fit at a readable size. Shorten that metadata field or split it into multiple authored steps.`);
  return size;
}

/** The returned standalone document has no remote or input-provided executable code. */
export async function renderComposition(storyboard: VideoStoryboard): Promise<string> {
  const motion = await readFile(new URL('../../assets/video/motion.js', import.meta.url), 'utf8');
  const agents = storyboard.agents;
  const state = new Map<string, RecordedEmotion>();
  const actors = agents.map((agent, i) => {
    const railName = [...agent.name].length >= 24 ? `Agent ${i + 1}` : agent.name;
    return `<div id="actor-${i}" class="actor">${avatar(i)}
      <h2 class="identity" style="font-size:${fontSize(railName, 245, 64, 29, `Agent ${i + 1} name`)}px">${escapeHtml(railName)}</h2></div>`;
  }).join('');
  const data = storyboard.beats.map((beat, i) => {
    if (beat.actorId && beat.emotion) state.set(beat.actorId, beat.emotion);
    return { index: i, actor: agents.findIndex(agent => agent.id === beat.actorId), start: beat.start,
      duration: beat.duration, phase: beat.phase, kind: beat.kind, page: beat.pageIndex,
      face: beat.emotion ? faceFor(beat.emotion) : undefined,
      stateLabel: emotionLabel(beat.actorId ? state.get(beat.actorId) : beat.emotion) };
  });
  const cards = storyboard.beats.map((beat, i) => {
    const name = agents.find(agent => agent.id === beat.actorId)?.name;
    const visibility = beat.visibility === 'private' ? 'Private · viewer only' : beat.visibility === 'operator' ? 'Operator record' : 'Public';
    const who = [name, visibility, beat.action, beat.channel].filter(Boolean).join(' · ');
    const meta = [`Step ${beat.stepIndex + 1} / ${storyboard.steps.length}`,
      beat.pulse === undefined ? '' : `Pulse ${beat.pulse}`,
      beat.pageCount > 1 ? `Part ${beat.pageIndex + 1} / ${beat.pageCount}` : ''].filter(Boolean).join(' · ');
    const note = data[i]!.stateLabel;
    return `<div id="head-${i}" class="beat-head"><p class="phase" style="font-size:${fontSize(beat.phase, 1060, 86, 31, `Step ${beat.stepIndex + 1} phase`)}px">${escapeHtml(beat.phase)}</p><p class="meta">${escapeHtml(meta)}</p></div>
      <article id="card-${i}" class="paper ${beat.visibility}"><div class="words">
        <p class="who" style="font-size:${fontSize(who, 1016, 64, 24, `Step ${beat.stepIndex + 1} full name/channel`)}px">${escapeHtml(who)}</p>
        <p class="body" style="font-size:${fontSize(beat.text, 1016, note ? 300 : 355, beat.text.length < 75 ? 62 : 48)}px">${escapeHtml(beat.text)}</p>
        ${note ? `<p class="emotion-note" style="font-size:${fontSize(note, 1016, 54, 22, `Step ${beat.stepIndex + 1} emotion label`)}px">${escapeHtml(note)}</p>` : ''}
      </div><div class="skeleton" aria-hidden="true"><i></i><i></i><i></i></div></article>`;
  }).join('');
  const source = storyboard.sourceKind === 'script' ? 'Authored script' : 'Saved run';
  const first = storyboard.beats[0]?.start ?? 2;
  const cues = storyboard.beats.flatMap((beat, i) => beat.kind === 'message' && beat.pageIndex === 0
    ? [`<audio id="cue-${i}" src="assets/tap.wav" data-start="${beat.start + 0.2}" data-duration="0.12" data-volume="0.22" data-track-index="1"></audio>`] : []).join('');
  const title = escapeHtml(storyboard.title);
  const runtime = { beats: data, count: agents.length, first, duration: storyboard.duration };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Perfectman · ${title}</title><link rel="stylesheet" href="assets/styles.css"><script src="assets/gsap.min.js"></script></head><body>
    <main id="stage" data-composition-id="run-video" data-start="0" data-duration="${storyboard.duration}" data-width="1920" data-height="1080" data-fps="30">
      <section id="scene" class="clip" data-start="0" data-duration="${storyboard.duration}" data-track-index="0">
        <div id="grid"></div><div id="world" data-layout-allow-overflow><div id="board"></div><div id="cast">${actors}</div><div id="cards">${cards}</div></div>
        <img id="brand" src="assets/perfectman-logo.png" alt="Perfectman"><header id="top"><h1 style="font-size:${fontSize(storyboard.title, 1330, 76, 30, 'Title')}px">${title}</h1><p class="kind">${source} · ${agents.length} agents</p></header>
        <div id="intro"><h1 style="font-size:${fontSize(storyboard.title, 1550, 180, 60, 'Title')}px">${title}</h1><p>${source} · ${storyboard.steps.length} source steps</p></div>
        <div id="progress"><i></i></div><p id="disclosure">Perfectman · Source order preserved · Expressions illustrate recorded states</p>
        <div id="outro"><h1>Perfectman</h1><p>${source} complete. ${storyboard.steps.length} source steps. Personality under pressure.</p></div>
      </section>${cues}
    </main><script>const VIDEO = ${safeJson(runtime)};\n${motion}</script></body></html>`;
}
