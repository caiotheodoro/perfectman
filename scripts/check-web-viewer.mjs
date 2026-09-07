#!/usr/bin/env node
// Run: node scripts/check-web-viewer.mjs (Chrome, built shared package, pnpm install).
// Exercises the real React app with a local authored SSE fixture. No model or key is used.
import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const webRequire = createRequire(join(root, 'packages/web/package.json'));
const evalRequire = createRequire(join(root, 'packages/eval/package.json'));
const rendererRequire = createRequire(evalRequire.resolve('hyperframes/bin/hyperframes.mjs'));
const { default: puppeteer } = await import(pathToFileURL(rendererRequire.resolve('puppeteer-core')).href);
const { createServer: viteServer } = await import(pathToFileURL(resolve(webRequire.resolve('vite/package.json'), '../dist/node/index.js')).href);
const evidence = join(root, 'out/gauntlet/app-browser-checks');
await mkdir(evidence, { recursive: true });

const agents = [
  { id: 'iris', displayName: 'Iris' }, { id: 'bruno', displayName: 'Bruno' },
  { id: 'marcela', displayName: 'Marcela' },
  { id: 'very-long', displayName: 'Alexandria Evangeline de Albuquerque' },
  { id: 'tess', displayName: 'Tess' }, { id: 'nox', displayName: 'Nox' }, { id: 'moss', displayName: 'Moss' },
];
const ids = agents.map(a => a.id);
const channels = [
  { id: 'public', name: 'the studio', type: 'public_channel', memberAgentIds: ids },
  { id: 'private', name: 'private-thread', type: 'private_channel', memberAgentIds: ['iris', 'marcela'] },
];
const castFiles = await Promise.all(['iris', 'bruno', 'marcela'].map(async name => ({
  filename: `${name}.persona.md`,
  text: await readFile(join(root, `examples/presets/casts/studio-partners/${name}.persona.md`), 'utf8'),
})));
const sceneFile = { filename: 'the-slice.scenario.md', text: await readFile(join(root, 'examples/presets/scenes/the-slice/the-slice.scenario.md'), 'utf8') };
const library = {
  casts: [{ id: 'fixture-cast', title: 'Browser fixture cast', blurb: 'Authored UI verification.', files: castFiles }],
  scenes: [{ id: 'fixture-scene', cast: 'fixture-cast', title: 'Browser fixture scene', blurb: 'Public, private and silent moments.', files: [sceneFile] }],
};
const summary = {
  agents: agents.map(agent => ({ ...agent, archetype: 'fixture', personaFile: `${agent.id}.persona.md`, calibrationFrom: 'fixture' })),
  channels: channels.map(({ memberAgentIds, ...channel }) => ({ ...channel, members: memberAgentIds })),
  maxPulses: 8, seed: 0, languages: {},
};
let runNumber = 0, startBody, pendingResponse, holdStart = false;
const streams = new Map(), stopped = [], errors = [], requests = [];
const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const api = httpServer(async (req, res) => {
  requests.push(`${req.method} ${req.url}`);
  try {
    if (req.url === '/api/presets') return json(res, library);
    if (req.url === '/api/compile') return json(res, { ok: true, config: {}, diagnostics: [], summary });
    if (req.url === '/api/runs' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      startBody = JSON.parse(body); runNumber++;
      const reply = () => json(res, { runId: `fixture-${runNumber}` });
      if (holdStart) pendingResponse = reply; else reply();
      return;
    }
    const match = req.url.match(/^\/api\/runs\/(fixture-\d+)\/(stream|stop)$/);
    if (match?.[2] === 'stop') { stopped.push(match[1]); return json(res, { ok: true }); }
    if (match?.[2] === 'stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': authored browser fixture\n\n'); streams.set(match[1], res);
      res.on('close', () => { requests.push(`closed ${match[1]}`); streams.delete(match[1]); }); return;
    }
    res.writeHead(404); res.end();
  } catch (error) { errors.push(error.message); res.writeHead(500); res.end(); }
});
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
process.env.PERFECTMAN_WEB_API = `http://127.0.0.1:${api.address().port}`;
const vite = await viteServer({ root: join(root, 'packages/web'), configFile: join(root, 'packages/web/vite.config.ts'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await vite.listen();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
page.on('pageerror', error => errors.push(error.message));
await page.evaluateOnNewDocument(() => {
  // Track the app's real media elements; new Audio() does not attach to the DOM.
  const NativeAudio = window.Audio;
  window.__fixtureAudio = [];
  window.Audio = function (...args) {
    const audio = new NativeAudio(...args); window.__fixtureAudio.push(audio); return audio;
  };
  window.Audio.prototype = NativeAudio.prototype;
  localStorage.setItem('perfectman.sound.muted', '1');
});
const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
const wait = async (predicate, message) => {
  for (let n = 0; n < 100; n++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error(message);
};
const clickText = async text => {
  await page.waitForFunction(text => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === text && !b.disabled), {}, text);
  const button = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text), text);
  await button.asElement().click(); await button.dispose();
};
const emit = event => streams.get(`fixture-${runNumber}`).write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
const status = state => emit({ type: 'status', status: { runId: `fixture-${runNumber}`, state, pulseIndex: 0, pulsesRun: 0, maxPulses: 8, counters: { llmFailures: 0, gatewayTimeouts: 0, framesDropped: 0 } } });
const hello = () => emit({ type: 'hello', runId: `fixture-${runNumber}`, simulationId: 'fixture', simulationName: 'Authored browser fixture', agents: agents.map(agent => ({ ...agent, archetype: 'fixture' })), channels, maxPulses: 8, priorEvents: [] });
const message = (eventId, actorId, channelId, text, visibleToAgents = []) => ({ eventId, actorId, channelId, eventType: 'message_sent', text, visibleToAgents, pulseIndex: 0, createdAt: 0 });
const thinking = text => ({ privateMotiveSummary: text, emotionDrivers: [], motivationDrivers: [], intentType: 'no_op' });
const pulse = (pulseIndex, messages, thoughts = {}, emotions = {}) => emit({ type: 'pulse', frame: { pulseIndex, messages, thinking: Object.fromEntries(Object.entries(thoughts).map(([agentId, thought]) => [agentId, { agentId, ...thought }])), emotions, notices: [], eventsCommitted: messages.length, agentsCalled: 1 } });
const position = () => page.$eval('[aria-label="Position in the run"]', el => el.textContent.trim());
const shot = async name => page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true });
const visibleReading = async name => {
  if (page.viewport().width > 640) return;
  await page.waitForFunction(() => {
    const dialogue = document.querySelector('.pages__page:not([aria-hidden]) .stage__dialogue')?.getBoundingClientRect();
    const controls = document.querySelector('.transport__buttons')?.getBoundingClientRect();
    return dialogue && controls && dialogue.top >= 0 && dialogue.top < controls.top && controls.bottom <= innerHeight;
  }, { timeout: 2000 });
  await page.screenshot({ path: join(evidence, `${name}-viewport.png`) });
};
const geometry = async name => {
  const problems = await page.evaluate(() => {
    const stage = document.querySelector('.pages__page:not([aria-hidden]) .stage');
    const bubble = stage?.querySelector('.bubble')?.getBoundingClientRect();
    const faces = [...(stage?.querySelectorAll('.figure__body') ?? [])].map(el => el.getBoundingClientRect());
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      faceOverlap: Boolean(bubble && faces.some(r => r.left < bubble.right && r.right > bubble.left && r.top < bubble.bottom && r.bottom > bubble.top)),
      names: [...(stage?.querySelectorAll('.figure__name') ?? [])].map(el => el.textContent),
    };
  });
  await shot(name);
  assert.equal(problems.overflow, false, `${name}: horizontal overflow`);
  assert.equal(problems.faceOverlap, false, `${name}: dialogue covers agent artwork`);
  return problems;
};
try {
  await page.setViewport({ width: 1280, height: 960 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await geometry('intro-desktop');
  assert.equal(await page.$eval('.intro__play', el => el.textContent.trim()), 'Play', 'Reduced-motion preference must reach the preview controls');
  for (const width of [390, 320]) {
    await page.setViewport({ width, height: 960 });
    await geometry(`intro-${width}`);
  }
  await page.setViewport({ width: 1280, height: 960 });
  await clickText('Build a room');
  await page.click('.card'); await shot('cast-desktop');
  await clickText('Choose a scene'); await page.click('.card'); await shot('scene-desktop');
  await clickText('Ready');
  await page.type('input[type="password"]', 'authored-browser-fixture');
  await page.click('.advanced summary');
  await page.$eval('.advanced textarea', el => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(el, '{"fixtureOption":true}'); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await shot('provider-desktop');
  holdStart = true;
  await clickText('Start the run');
  await wait(() => Boolean(pendingResponse), 'Start request did not arrive');
  await clickText('Cancel preparation');
  pendingResponse(); holdStart = false;
  await wait(() => stopped.includes('fixture-1'), 'Pending start was not cancelled by its returned run id');
  assert.equal(startBody.llm.extraBody.fixtureOption, true, 'Latest extra request fields must reach the start request');
  await wait(() => streams.has('fixture-1'), 'Cancelled run stream did not connect');
  hello(); status('done'); emit({ type: 'stopped', stopReason: 'user_stopped' });
  await clickText('Start another run');
  await page.type('input[type="password"]', 'authored-browser-fixture');
  await clickText('Start the run');
  await wait(() => streams.has('fixture-2'), 'Second run stream did not connect');
  hello(); status('running');
  pulse(0, [message('first', 'iris', 'public', 'so are we talking about last night or not')], { iris: thinking('I want to know what happened, but I do not want to ask twice.') });
  await page.waitForSelector('.warmup');
  assert.equal(await page.$('.transport'), null, 'Warmup must not reveal a partial buffer');
  await geometry('preparing-desktop');
  pulse(1, [message('private', 'iris', 'private', 'tell me what happened', ['iris', 'marcela'])]);
  pulse(2, [], { marcela: thinking('if i say it now it sounds like i counted. i counted.') }, { marcela: { valence: -0.7, arousal: 0.8, top: [{ key: 'anger', value: 0.9 }] } });
  await page.waitForSelector('.transport');
  assert.equal(await position(), '1 / 4', 'First intended beat must be visible after warmup');
  assert.equal(await page.$$eval('.stage .figure', figures => figures.every(el => el.dataset.face === 'neutral')), true, 'Missing emotion must stay neutral');
  for (const width of [1280, 390, 320]) {
    await page.setViewport({ width, height: width === 320 ? 568 : width === 390 ? 844 : 960 });
    await page.click('.sheet__frame:first-child');
    await visibleReading(`public-${width}`);
    await geometry(`public-${width}`);
    await page.click('[aria-label="Next beat"]'); await visibleReading(`thought-${width}`); await geometry(`thought-${width}`);
    await page.click('[aria-label="Next beat"]'); await visibleReading(`private-${width}`); await geometry(`private-${width}`);
    assert.match(await page.$eval('.stage', el => el.textContent), /cannot (see|hear)/);
    await page.click('[aria-label="Next beat"]'); await visibleReading(`silence-${width}`); await geometry(`silence-${width}`);
    assert.match(await page.$eval('.stage__utterance', el => el.textContent), /says nothing/);
  }
  await page.setViewport({ width: 390, height: 844 });
  const at = await position();
  pulse(3, [message('long', 'very-long', 'public', 'I kept every detail to myself because I thought that leaving it unsaid might protect the rest of us. Now the whole conversation is about what nobody has been willing to name. ' .repeat(3))]);
  await wait(async () => (await position()) !== at, 'Incoming beats did not enter the queue');
  assert.match(await position(), /^4 \/ /, 'Incoming beats must not move a paused cursor');
  await page.click('[aria-label="Next beat"]'); await visibleReading('long-name-dialogue-mobile'); await geometry('long-name-dialogue-mobile');
  await page.focus('.sheet__frame[aria-current]'); await page.keyboard.press('Home');
  assert.match(await position(), /^1 \/ /, 'Keyboard Home must seek to the first beat');
  await clickText('Play');
  await page.waitForFunction(() => !document.querySelector('[aria-label="Position in the run"]').textContent.trim().startsWith('1 /'), { timeout: 10000 });
  await visibleReading('autoplay-mobile');
  await clickText('Pause');
  await clickText('Sound off');
  await page.waitForFunction(() => window.__fixtureAudio.some(el => !el.paused && el.volume > 0 && el.currentTime > 0));
  await clickText('Sound on');
  assert.equal(await page.evaluate(() => window.__fixtureAudio.every(el => el.paused || el.volume === 0)), true, 'Mute must silence actual media');
  status('done'); emit({ type: 'stopped', stopReason: 'max_pulses' });
  await clickText('Watch again'); assert.match(await position(), /^1 \/ /);
  await shot('finished-mobile');
  await clickText('Start another run');
  await page.type('input[type="password"]', 'authored-browser-fixture');
  await clickText('Start the run'); await wait(() => streams.has('fixture-3'), 'Failure run did not connect');
  hello(); emit({ type: 'status', status: { runId: 'fixture-3', state: 'failed', error: { message: 'Authored fixture failure', hint: 'Try again.' } } });
  await page.waitForSelector('input[type="password"]');
  assert.equal(await page.$eval('input[type="password"]', el => el.value), '', 'Early failure must clear the key');
  assert.match(await page.$eval('.run', el => el.textContent), /Authored fixture failure/);
  await shot('failure-mobile');
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'checks.json'), JSON.stringify({ passed: true, evidence: 'Authored local HTTP/SSE fixtures through the real React app; no provider execution', checks: ['intro reduced motion', 'cast/scene/provider journey', 'cancel pending start', 'current extraBody request', 'preparation buffer', 'first beat', 'neutral missing emotion', 'desktop/mobile public/private/thought/silence geometry', 'long names/dialogue', 'incoming beats preserve pause', 'keyboard seek', 'play/pause', 'actual audio and mute', 'completion/retry', 'early failure recovery'] }, null, 2));
  console.log(`PASS: real React app with authored SSE fixtures. Evidence: ${evidence}`);
} catch (error) {
  await shot('failure-diagnostic');
  await writeFile(join(evidence, 'failure-diagnostic.json'), JSON.stringify({ error: error.message, requests, errors, text: await page.$eval('body', el => el.textContent) }, null, 2));
  console.error(JSON.stringify({ requests, errors }));
  throw error;
} finally {
  await browser.close();
  for (const stream of streams.values()) stream.end();
  await vite.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve));
}
