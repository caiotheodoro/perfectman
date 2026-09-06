import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const controller = readFileSync(new URL('../../../assets/video/viewer-audio.js', import.meta.url), 'utf8');
type AudioController = { toggle(): boolean; sync(time: number, playing: boolean): void; pause(): void };
function player(failure?: string) {
  const media = {
    paused: true, currentTime: .08, volume: 0,
    pause() { this.paused = true; },
    play() { return failure ? Promise.reject(Object.assign(new Error(failure), { name: failure })) : Promise.resolve(); },
  };
  const window: { VIDEO: { audio: unknown[] }; storyAudio?: AudioController } = {
    VIDEO: { audio: [{ id: 'cue', start: 0, duration: .1, mediaStart: 0, volume: .1, fadeIn: 0, fadeOut: 0 }] },
  };
  const document = { getElementById: (id: string) => id === 'cue' ? media : { textContent: '', setAttribute() {} } };
  runInNewContext(controller, { window, document });
  if (!window.storyAudio) throw new Error('Audio controller did not initialize');
  return { media, audio: window.storyAudio };
}
it('aligns short effects exactly when playback resumes after a seek', async () => {
  const { media, audio } = player();
  audio.toggle(); audio.sync(.001, true);
  expect(media.currentTime).toBe(.001);
  await Promise.resolve();
});
it.each([['AbortError', false], ['NotAllowedError', true]])('handles %s without losing intentional sound state', async (failure, nextToggle) => {
  const { audio } = player(String(failure));
  audio.toggle(); audio.sync(.001, true); audio.pause();
  await Promise.resolve(); await Promise.resolve();
  expect(audio.toggle()).toBe(nextToggle);
});
