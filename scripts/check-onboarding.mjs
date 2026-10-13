#!/usr/bin/env node
// Built UI + real preset loader/compiler, in Chrome. No provider request or API key.
// Run after pnpm build: node scripts/check-onboarding.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWebServer } from '../packages/server/dist/http/server.js';

const root = resolve(import.meta.dirname, '..');
const requireEval = createRequire(join(root, 'packages/eval/package.json'));
const requireRenderer = createRequire(requireEval.resolve('hyperframes/bin/hyperframes.mjs'));
const { default: puppeteer } = await import(pathToFileURL(requireRenderer.resolve('puppeteer-core')).href);
const evidence = join(root, 'out/onboarding-checks');
await mkdir(evidence, { recursive: true });
const api = createWebServer({ runsRoot: join(evidence, 'runs'), presetsRoot: join(root, 'examples/presets'), staticDir: join(root, 'packages/web/dist') });
const port = await api.listen(0);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
const errors = [], starts = [], compiled = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/api/runs')) starts.push(req.url()); });
page.on('response', async res => { if (res.url().endsWith('/api/compile')) compiled.push(await res.json()); });
const click = async text => {
  await page.waitForFunction(text => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === text && !b.disabled && b.getClientRects().length), {}, text);
  const button = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text && b.getClientRects().length), text);
  await button.asElement().click(); await button.dispose();
};
const fill = async (selector, value) => {
  await page.$eval(selector, (el, value) => {
    const type = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(type.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
};
const shot = async name => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: horizontal overflow`);
  await page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true });
};
try {
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  for (const width of [1440, 390, 320]) {
    await page.setViewport({ width, height: width > 640 ? 1000 : 844 });
    await page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    await shot(`landing-${width}`);
    await click('Start a room');
    await page.waitForSelector('.story--on');
    await shot(`setup-${width}`);
    assert.equal(await page.$eval('.setup__go', el => el.disabled), true, 'No run can start before a key is pasted');
    await page.click('.story--write');
    await page.waitForSelector('.writer');
    await shot(`writer-${width}`);
    await fill('.writer__people fieldset:nth-child(2) input', 'Alex');
    await page.waitForFunction(() => /different name/.test(document.querySelector('.setup__status')?.textContent ?? ''));
    await fill('.writer__people fieldset:nth-child(2) input', 'Sam "S"');
    await click('Add a person');
    await page.waitForSelector('[aria-label="Remove person 4"]'); await page.click('[aria-label="Remove person 4"]');
    await fill('.writer > label:nth-of-type(2) input', 'The "last" evening');
    await fill('.writer > label:first-child textarea', 'Friends have one last evening together. They disagree on what to do.');
    await page.waitForFunction(() => /3 people/.test(document.querySelector('.setup__status')?.textContent ?? ''));
    assert.match(await page.$eval('.setup__status', el => el.textContent), /Your story/);
    assert.deepEqual(compiled.at(-1).diagnostics.filter(d => d.level === 'error'), []);
    assert.deepEqual(compiled.at(-1).summary.agents.map(a => a.displayName), ['Alex', 'Sam "S"', 'Robin']);
    assert.ok(Object.values(compiled.at(-1).summary.languages).every(value => value.language === 'en'));
    assert.match(JSON.stringify(compiled.at(-1).config), /Get a straight answer/);
    await shot(`review-${width}`);
    await page.waitForSelector('input[type="password"]');
    assert.equal(await page.$eval('.setup__go', el => el.disabled), true, 'No model request before an explicit key and Start');
    await page.type('input[type="password"]', 'fixture-key');
    assert.equal(await page.$eval('.setup__go', el => el.disabled), false, 'A compiled story and a key are enough to start');
    await shot(`connect-${width}`);
  }
  const library = await (await fetch(`http://localhost:${port}/api/presets`)).json();
  for (const scene of library.scenes) {
    const personas = library.casts.find(cast => cast.id === scene.cast).files;
    const response = await fetch(`http://localhost:${port}/api/compile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inputs: { kind: 'markdown', personas, scenario: scene.files[0] } }) });
    const result = await response.json();
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const language = scene.id === 'gato-no-telhado' ? 'pt-BR' : 'en';
    assert.ok(Object.values(result.summary.languages).every(value => value.language === language), scene.id);
  }
  assert.deepEqual(starts, []);
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'checks.json'), JSON.stringify({ passed: true, widths: [1440, 390, 320], presetScenes: library.scenes.length, checks: ['landing film', 'one-page setup with a story already chosen', 'duplicate-name validation', 'quoted names and titles', 'real custom-scene compilation', 'model key gate', 'preset compilation per scene language', 'no horizontal overflow', 'no provider requests'], evidence: 'Built React app and real HTTP compiler in Chrome. Scripted landing film; no live-model execution.' }, null, 2));
  console.log(`PASS: onboarding and ${library.scenes.length} preset scenes. Evidence: ${evidence}`);
} catch (error) {
  await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true });
  console.error(await page.$eval('body', el => el.textContent));
  throw error;
} finally {
  await browser.close(); await api.close();
}
