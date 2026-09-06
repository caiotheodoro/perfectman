#!/usr/bin/env node
// Usage: node scripts/check-story-viewer.mjs out/story.hyperframes
// Requires the generated viewer and Chrome; set CHROME_PATH outside macOS.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { access, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const project = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Supply a generated .hyperframes project directory');
await access(join(project, 'viewer.html'));
const require = createRequire(new URL('../packages/eval/package.json', import.meta.url));
const rendererRequire = createRequire(require.resolve('hyperframes/bin/hyperframes.mjs'));
const { default: puppeteer } = await import(pathToFileURL(rendererRequire.resolve('puppeteer-core')).href);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage(), failures = [];
page.on('pageerror', error => failures.push(error.message));
const checks = join(project, 'viewer-checks');
await mkdir(checks, { recursive: true });
try {
  await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(join(project, 'viewer.html')).href, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => window.__timelines?.['run-video']?.time() > 0);
  const data = await page.evaluate(() => window.VIDEO);
  assert(data.beats.length && data.channels.length, 'Viewer has no story/channel data');
  assert.equal(await page.evaluate(() => window.__timelines['run-video'].paused()), false, 'Default playback must run');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('audio')].every(media => media.paused)), true, 'Sound must wait for a user gesture');
  const setTime = async time => {
    await page.$eval('#seek', (input, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); }, time);
  };
  const sample = data.beats[Math.min(2, data.beats.length - 1)].start + 1;
  await setTime(sample);
  const bookmark = await page.evaluate(() => window.__timelines['run-video'].time());
  const selected = data.channels.findIndex(channel => channel.kind === 'private' && channel.beatIndexes.length);
  const channel = selected < 0 ? data.channels.findIndex(item => item.beatIndexes.length) : selected;
  await page.click(`#channel-${channel}`);
  assert.equal(await page.evaluate(() => window.__timelines['run-video'].paused()), true, 'Channel browsing must pause playback');
  assert.equal(await page.$eval('#channel-history', element => element.hidden), false);
  assert.equal(await page.$$eval('#history-list button', buttons => buttons.length), data.channels[channel].beatIndexes.length);
  await page.click('#history-list button');
  const first = data.beats[data.channels[channel].beatIndexes[0]];
  assert(Math.abs(await page.evaluate(() => window.__timelines['run-video'].time()) - (first.start + Math.min(.7, first.duration / 2))) < .05);
  await page.screenshot({ path: join(checks, 'channel-browsing.png') });
  await page.click('#follow');
  const restored = await page.evaluate(() => window.__timelines['run-video'].time());
  assert(restored >= bookmark && restored < bookmark + 1, 'Follow story must restore the chronological cursor');
  assert.equal(await page.$eval('#channel-history', element => element.hidden), true);
  await page.click('#sound');
  await page.waitForFunction(() => [...document.querySelectorAll('audio')].some(media => !media.paused && media.volume > 0));
  await page.click('#sound');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('audio')].every(media => media.paused)), true);
  await setTime(sample);
  const stage = await page.$('#stage'), firstPixels = await stage.screenshot();
  await setTime(data.beats.at(-1).start + .8);
  await setTime(sample);
  assert(Buffer.from(await stage.screenshot()).equals(Buffer.from(firstPixels)), 'Seeking back must reproduce the same scene pixels');
  await page.screenshot({ path: join(checks, 'desktop.png') });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.waitForFunction(() => document.getElementById('viewer-viewport').clientWidth <= 390);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 390), true, 'Narrow layout must not overflow horizontally');
  assert(await page.$eval('#reading-pane', element => element.textContent.length > 0), 'Narrow layout needs readable source text');
  await page.select('#conversation-picker', String(channel));
  assert.equal(await page.$eval('#channel-history', element => element.hidden), false, 'Mobile channel picker must open conversation history');
  await page.click('#follow');
  await setTime(sample);
  await page.screenshot({ path: join(checks, 'mobile.png') });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await page.evaluate(() => window.__timelines['run-video'].paused()), true, 'Reduced-motion preference should pause automatic motion');
  assert.deepEqual(failures, [], 'Browser raised runtime errors');
  console.log('PASS: autoplay, channel browsing, exact resume, audio gesture/mute, deterministic seek, narrow layout, reduced motion.');
  console.log(`Screenshots: ${checks}`);
} finally { await browser.close(); }
