import { describe, expect, it } from 'vitest';
import { planScene } from './scene-plan.js';
import type { VideoBeat, VideoStoryboard } from './types.js';

const beat = (index: number, updates: Partial<VideoBeat> = {}): VideoBeat => ({ id: `${index}`,
  phase: 'Conversation', kind: 'message', text: 'Exact source text.', actorId: 'ada', channel: 'general',
  visibility: 'public', sourceRefs: [`/steps/${index}`], stepIndex: index, pageIndex: 0, pageCount: 1,
  start: 2 + index * 3, duration: 3, ...updates });
const story = (beats: VideoBeat[]): VideoStoryboard => ({
  version: 'perfectman-storyboard-v1', sourceFile: 'test.json', sourceSha256: 'abc', sourceKind: 'script',
  title: 'Conversation', agents: [{ id: 'ada', name: 'Ada' }, { id: 'nox', name: 'Nox' }, { id: 'mira', name: 'Mira' }],
  channels: [{ id: 'general', name: 'General', kind: 'public', memberIds: ['ada', 'nox', 'mira'] }],
  steps: beats.map(b => ({ ...b, raw: {} })), beats, duration: beats.length * 3 + 5, fps: 30, notices: [],
});

describe('scene plan', () => {
  it('observes participants forward without treating final directory members as attendance', () => {
    const scene = planScene(story([beat(0), beat(1, { actorId: 'nox' }),
      beat(2, { actorId: 'nox', stageAction: { kind: 'leave', agentIds: ['nox'] } }), beat(3)]));
    expect(scene.channels[0]!.memberIndexes).toEqual([0, 1, 2]);
    expect(scene.beats.map(b => b.participantIndexes)).toEqual([[0], [0, 1], [0, 1], [0]]);
    expect(scene.beats[0]!.stageAction).toBeUndefined();
    expect(scene.channels[0]!.beatIndexes).toEqual([0, 1, 2, 3]);
  });

  it('separates thoughts, private conversations and operator records without invented partners', () => {
    const scene = planScene(story([beat(0, { kind: 'private', visibility: 'private', recipientIds: ['nox'] }),
      beat(1, { channel: 'dm', visibility: 'private' }), beat(2, { kind: 'state', visibility: 'operator' })]));
    const channels = scene.beats.map(b => scene.channels[b.channelIndex]!.kind);
    expect(channels).toEqual(['thought', 'private', 'operator']);
    expect(scene.beats[0]!.recipientIndexes).toEqual([]);
    expect(scene.beats[1]!.participantIndexes).toEqual([0]);
    expect(scene.channels.find(c => c.kind === 'thought')!.name).toBe("Ada's thoughts");
  });

  it('uses explicit recipients and audience but does not turn an invitation into attendance', () => {
    const scene = planScene(story([beat(0, { stageAction: { kind: 'invite', agentIds: ['mira'] }, recipientIds: ['mira'] }),
      beat(1, { stageAction: { kind: 'arrive', agentIds: ['mira'] } }),
      beat(2, { audienceIds: ['nox'], recipientIds: ['mira'] })]));
    expect(scene.beats.map(b => b.participantIndexes)).toEqual([[0], [0, 2], [0, 2, 1]]);
    expect(scene.beats[2]!.recipientIndexes).toEqual([2]);
    expect(scene.beats[0]!.stageAction).toEqual({ kind: 'invite', actorIndexes: [2] });
  });

  it('keeps a leaving persona visible across source pages until the final page', () => {
    const leave = { actorId: 'nox', stageAction: { kind: 'leave' as const, agentIds: ['nox'] }, pageCount: 2 };
    const scene = planScene(story([beat(0, leave), beat(1, { ...leave, pageIndex: 1 }), beat(2)]));
    expect(scene.beats.map(b => b.participantIndexes)).toEqual([[1], [1], [0]]);
  });
});
