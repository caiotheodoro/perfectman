import { describe, expect, it } from 'vitest';
import { renderComposition } from './composition.js';
import { emotionLabel, faceFor } from './avatar.js';
import { normalizeReplaySource } from './replay.js';
import type { VideoStoryboard } from './types.js';

function fixture(): VideoStoryboard {
  const step = { id: 'unsafe-id', phase: '</script><script>alert(1)</script>', kind: 'message' as const,
    text: '<img src=x onerror=alert(1)>', actorId: 'actor</script>', visibility: 'public' as const,
    sourceRefs: ['/steps/0'], raw: {} };
  return { version: 'perfectman-storyboard-v1', sourceFile: 'test.json', sourceSha256: 'abc', sourceKind: 'script',
    title: 'A < B', agents: [{ id: 'actor</script>', name: 'Ada "the <agent>"' }], steps: [step], notices: [],
    beats: [{ ...step, stepIndex: 0, pageIndex: 0, pageCount: 1, start: 2, duration: 4 }], duration: 9, fps: 30 };
}

describe('video composition', () => {
  it('maps realistic replay snapshots despite raw social-dimension labels', () => {
    const dimensions = ['resentment', 'suspicion', 'fearOfExclusion'];
    const story = normalizeReplaySource({
      simulationName: 'Recorded pressure', agentIds: ['ada'], agentNames: { ada: 'Ada' },
      pulses: dimensions.map((dimension, pulseIndex) => ({ pulseIndex, committedEvents: [], agentStates: {
        ada: {
          agentId: 'ada', presence: 'active',
          coreMood: { valence: .15, arousal: .5, energy: .7, stability: .6 },
          socialEmotions: { affection: .1, pride: .1, resentment: .1, suspicion: .1, fearOfExclusion: .1, [dimension]: .9 },
          relationalStates: { nox: { targetAgentId: 'nox', affection: 1 } },
        },
      } })),
    });
    const states = story.steps.filter(step => step.kind === 'state');
    expect(states.map(step => step.emotion?.label)).toEqual(dimensions);
    expect(states.map(step => faceFor(step.emotion))).toEqual(['angry', 'worried', 'worried']);
    expect(faceFor({ source: 'authored', label: 'unknown label', drivers: ['anger'] })).toBe('angry');
  });
  it('uses stable short aliases while keeping exact names in the active card', async () => {
    const story = fixture();
    story.agents[0]!.name = 'Alexandria with a long agent name';
    const html = await renderComposition(story);
    expect(html).toContain('>Agent 1</h2>');
    expect(html).toContain('Alexandria with a long agent name · Public');
    expect(html).not.toContain('face is an illustration');
  });

  it('fails with an actionable field name instead of clipping excessive metadata', async () => {
    const story = fixture();
    story.title = 'Very long title '.repeat(100);
    await expect(renderComposition(story)).rejects.toThrow('Title cannot fit at a readable size');
    story.title = 'Title';
    story.beats[0]!.phase = 'Very long phase '.repeat(100);
    await expect(renderComposition(story)).rejects.toThrow('Step 1 phase cannot fit at a readable size');
  });
  it('keeps source markup inert and uses independent numeric selectors', async () => {
    const story = fixture();
    story.beats[0]!.action = 'reply';
    const html = await renderComposition(story);
    expect(html.match(/src="assets\/perfectman-logo.png"/g)).toHaveLength(1);
    expect(html).toContain('Public · reply');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Ada &quot;the &lt;agent&gt;&quot;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('\\u003c/script>');
    expect(html).toContain('id="actor-0"');
    expect(html).toContain('data-duration="9"');
  });

  it('uses only recorded state, with no backward propagation or dialogue inference', async () => {
    expect(faceFor()).toBe('neutral');
    expect(emotionLabel({ source: 'authored', drivers: ['anger'] })).toBe('Authored drivers: anger');
    expect(emotionLabel({ source: 'authored', values: { valence: -.3 } })).toBe('Authored valence -0.3');
    expect(faceFor({ source: 'authored', label: 'unknown feeling' })).toBe('neutral');
    expect(faceFor({ source: 'authored', label: 'angry' })).toBe('angry');
    expect(faceFor({ source: 'snapshot', values: { 'relational.bob.valence': -.9, 'relational.bob.resentment': 1 } })).toBe('neutral');
    expect(faceFor({ source: 'snapshot', values: { valence: .5, resentment: .9 } })).toBe('angry');
    expect(faceFor({ source: 'snapshot', values: { contempt: .8, affection: .95 } })).toBe('smile');
    expect(faceFor({ source: 'snapshot', values: { socialAnxiety: .8 } })).toBe('worried');
    const story = fixture();
    story.beats.push({ ...story.beats[0]!, start: 6, emotion: { source: 'authored', label: 'angry' } });
    const html = await renderComposition(story);
    const runtime = JSON.parse(html.match(/const VIDEO = (.*);\n/)![1]!);
    expect(runtime.beats[0].face).toBeUndefined();
    expect(runtime.beats[0].stateLabel).toBe('');
    expect(runtime.beats[1].face).toBe('angry');
  });
});
