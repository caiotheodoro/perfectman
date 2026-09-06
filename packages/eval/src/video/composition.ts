import { readFile } from 'node:fs/promises';
import { avatar, avatarColor } from './avatar.js';
import { planScene } from './scene-plan.js';
import { roomMarkup } from './room.js';
import { planSoundtrack, renderSoundtrack } from './soundtrack.js';
import type { VideoStoryboard } from './types.js';

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
  const [gestures, motion] = await Promise.all(['actor-motion.js', 'motion.js'].map(file =>
    readFile(new URL(`../../assets/video/${file}`, import.meta.url), 'utf8')));
  const scene = planScene(storyboard), agents = storyboard.agents;
  const audio = planSoundtrack(storyboard), runtime = { ...scene, audio };
  const shortName = (name: string, index: number) => [...name].length >= 24 ? `Agent ${index + 1}` : name;
  const actors = agents.map((agent, i) => `<div id="actor-${i}" class="actor">${avatar(i)}
    <h2 class="identity" style="font-size:${fontSize(shortName(agent.name, i), 210, 56, 26, `Agent ${i + 1} name`)}px">${escapeHtml(shortName(agent.name, i))}</h2></div>`).join('');
  const groupNames = { public: 'Public rooms', private: 'Private conversations', thought: 'Private thoughts', operator: 'Operator records' };
  let previousGroup = '';
  const channels = scene.channels.map((channel, i) => {
    const heading = channel.kind === previousGroup ? '' : `<p class="channel-group">${groupNames[channel.kind]}</p>`;
    previousGroup = channel.kind;
    const label = [...channel.name].length > 30 ? `Channel ${i + 1}` : channel.name;
    return `${heading}<button id="channel-${i}" class="channel-row" type="button" data-channel-index="${i}" aria-label="${escapeHtml(channel.name)}"><span class="channel-sign">${channel.kind === 'public' ? '#' : channel.kind === 'private' ? '↔' : channel.kind === 'thought' ? '·' : '='}</span><span>${escapeHtml(label)}</span></button>`;
  }).join('');
  const roster = agents.map((agent, i) => `<div id="roster-${i}" class="cast-row" data-agent-index="${i}" title="${escapeHtml(agent.name)} (${escapeHtml(agent.id)})"><i style="background:${avatarColor(i)}"></i><span>${escapeHtml(shortName(agent.name, i))}${agent.id !== agent.name ? `<small>${escapeHtml(agent.id)}</small>` : ''}</span></div>`).join('');
  const cards = storyboard.beats.map((beat, i) => {
    const name = agents.find(agent => agent.id === beat.actorId)?.name ?? beat.actorId;
    const visibility = beat.kind === 'private' ? 'Private thought · viewer only' : beat.visibility === 'private' ? 'Private conversation' : beat.visibility === 'operator' ? 'Operator record' : 'Public';
    const targets = (beat.kind === 'private' ? [] : beat.recipientIds ?? []).map(id => agents.find(agent => agent.id === id)?.name ?? id);
    const context = (beat.kind === 'private' || beat.visibility === 'operator') && beat.channel
      ? storyboard.channels?.find(channel => channel.id === beat.channel)?.name ?? beat.channel : undefined;
    const who = [name, targets.length ? `to ${targets.join(', ')}` : '', visibility, beat.action, context].filter(Boolean).join(' · ');
    const meta = [`Step ${beat.stepIndex + 1} / ${storyboard.steps.length}`,
      beat.pulse === undefined ? '' : `Pulse ${beat.pulse}`,
      beat.pageCount > 1 ? `Part ${beat.pageIndex + 1} / ${beat.pageCount}` : ''].filter(Boolean).join(' · ');
    const note = scene.beats[i]!.stateLabel;
    const channel = scene.channels[scene.beats[i]!.channelIndex]!;
    return `<div id="head-${i}" class="beat-head"><p class="channel-title" style="font-size:${fontSize(channel.name, 1540, 70, 32, `Step ${beat.stepIndex + 1} channel`)}px">${escapeHtml(channel.name)}</p><p class="phase" style="font-size:${fontSize(beat.phase, 860, 65, 26, `Step ${beat.stepIndex + 1} phase`)}px">${escapeHtml(beat.phase)}</p><p class="meta">${escapeHtml(meta)}</p></div>
      <article id="card-${i}" class="paper ${beat.visibility} ${channel.kind}" data-channel-index="${scene.beats[i]!.channelIndex}"><div class="words">
        <p class="who" style="font-size:${fontSize(who, 742, 87, 24, `Step ${beat.stepIndex + 1} full name/channel`)}px">${escapeHtml(who)}</p>
        <p class="body" style="font-size:${fontSize(beat.text, 742, note ? 400 : 455, beat.text.length < 75 ? 56 : 42)}px">${escapeHtml(beat.text)}</p>
        ${note ? `<p class="emotion-note" style="font-size:${fontSize(note, 742, 58, 22, `Step ${beat.stepIndex + 1} emotion label`)}px">${escapeHtml(note)}</p>` : ''}
      </div><div class="skeleton" aria-hidden="true"><i></i><i></i><i></i></div></article>`;
  }).join('');
  const source = storyboard.sourceKind === 'script' ? 'Authored script' : 'Saved run';
  const title = escapeHtml(storyboard.title);
  const room = roomMarkup.replace('<div id="cast"></div>', `<div id="cast">${actors}</div>`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Perfectman · ${title}</title><link rel="stylesheet" href="assets/styles.css"><script src="assets/gsap.min.js"></script></head><body>
    <main id="stage" data-composition-id="run-video" data-start="0" data-duration="${storyboard.duration}" data-width="1920" data-height="1080" data-fps="30">
      <section id="scene" class="clip" data-start="0" data-duration="${storyboard.duration}" data-track-index="0">
        <div id="grid"></div><aside id="sidebar"><h2>Conversations</h2><div id="channel-window"><div id="channel-items" data-layout-allow-overflow>${channels}</div></div><h2 class="cast-heading">Cast</h2><div id="cast-window"><div id="cast-items" data-layout-allow-overflow>${roster}</div></div></aside>
        <div id="world" data-layout-allow-overflow>${room}<div id="cards">${cards}</div>${storyboard.place ? `<p id="place">${escapeHtml(storyboard.place)}</p>` : ''}</div>
        <img id="brand" src="assets/perfectman-logo.png" alt="Perfectman"><header id="top"><h1 style="font-size:${fontSize(storyboard.title, 1250, 76, 30, 'Title')}px">${title}</h1><p class="kind">${source}</p></header>
        <div id="intro"><h1 style="font-size:${fontSize(storyboard.title, 1350, 160, 60, 'Title')}px">${title}</h1><p>${source} · ${storyboard.steps.length} source steps</p></div>
        <div id="progress"><i></i></div><p id="disclosure">Perfectman · Source order · Illustrated movement · Recorded or authored emotional cues</p>
        <div id="outro"><h1>Perfectman</h1><p>${source} complete. ${storyboard.steps.length} source steps.</p><div id="credits"><p>“Wallpaper”, “Long Note Three”, “Dream Culture” — Kevin MacLeod (incompetech.com)</p><p>CC BY 4.0 · creativecommons.org/licenses/by/4.0/ · Edited for timing and fades.</p><p>Interface sounds: Kenney (kenney.nl/assets/interface-sounds), CC0.</p></div></div>
      </section>${renderSoundtrack(audio)}
    </main><script>const VIDEO = ${safeJson(runtime)};\nwindow.VIDEO = VIDEO;\n${gestures}\n${motion}</script></body></html>`;
}
