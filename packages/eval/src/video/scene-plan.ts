import { emotionLabel, faceFor } from './avatar.js';
import type { RecordedEmotion, VideoStoryboard } from './types.js';

export type SceneChannel = {
  id: string; name: string; kind: 'public' | 'private' | 'thought' | 'operator';
  /** Directory metadata only; never an attendance seed. */
  memberIndexes: number[]; beatIndexes: number[];
};

/** Observe conversation participants forward in source order, without backfilling attendance. */
export function planScene(storyboard: VideoStoryboard) {
  const agents = storyboard.agents;
  const indexOf = new Map(agents.map((agent, i) => [agent.id, i]));
  const indexes = (ids: string[] = []) => [...new Set(ids.flatMap(id => indexOf.has(id) ? [indexOf.get(id)!] : []))];
  const directory = new Map((storyboard.channels ?? []).map(channel => [channel.id, channel]));
  const catalog = new Map<string, SceneChannel>();
  const add = (id: string, name: string, kind: SceneChannel['kind'], members: string[] = []) => {
    if (!catalog.has(id)) catalog.set(id, { id, name, kind, memberIndexes: indexes(members), beatIndexes: [] });
    return id;
  };
  for (const channel of directory.values()) add(`room:${channel.id}`, channel.name, channel.kind, channel.memberIds);
  const states = new Map<string, RecordedEmotion>();
  const attendance = new Map<string, Set<number>>();
  const beats = storyboard.beats.map((beat, index) => {
    const actor = beat.actorId === undefined ? -1 : indexOf.get(beat.actorId) ?? -1;
    const sourceChannel = beat.channel ? directory.get(beat.channel) : undefined;
    let channelId: string;
    if (beat.kind === 'private') {
      channelId = add(`thought:${beat.actorId ?? 'unknown'}`, actor < 0 ? 'Private thoughts' : `${agents[actor]!.name}'s thoughts`, 'thought');
    } else if (beat.visibility === 'operator') {
      channelId = add('operator:records', 'Operator records', 'operator');
    } else {
      const kind = beat.visibility === 'private' ? 'private' : sourceChannel?.kind ?? 'public';
      const id = `room:${beat.channel ?? `${kind}:unassigned`}`;
      channelId = add(sourceChannel && sourceChannel.kind !== kind ? `${kind}:${id}` : id,
        sourceChannel?.name ?? beat.channel ?? (kind === 'private' ? 'Private conversation' : 'Public space'), kind,
        sourceChannel?.memberIds);
    }
    const channel = catalog.get(channelId)!;
    channel.beatIndexes.push(index);
    const recipientIndexes = beat.kind === 'private' ? [] : indexes(beat.recipientIds);
    const action = beat.stageAction ? { kind: beat.stageAction.kind, actorIndexes: indexes(beat.stageAction.agentIds) } : undefined;
    const present = attendance.get(channelId) ?? new Set<number>();
    const observed = indexes(beat.audienceIds);
    if (actor >= 0) observed.push(actor);
    if (action?.kind !== 'invite') observed.push(...recipientIndexes);
    if (action?.kind === 'arrive' || action?.kind === 'leave') observed.push(...action.actorIndexes);
    observed.forEach(agent => present.add(agent));
    const participantIndexes = channel.kind === 'thought' ? (actor >= 0 ? [actor] : [])
      : channel.kind === 'operator' ? [...new Set(observed)] : [...present];
    if (action?.kind === 'leave' && beat.pageIndex === beat.pageCount - 1) action.actorIndexes.forEach(agent => present.delete(agent));
    if (channel.kind === 'public' || channel.kind === 'private') attendance.set(channelId, present);
    if (beat.actorId && beat.emotion) states.set(beat.actorId, beat.emotion);
    const emotion = beat.actorId ? states.get(beat.actorId) : beat.emotion;
    return { index, actor, channelId, recipientIndexes, participantIndexes, stageAction: action,
      start: beat.start, duration: beat.duration, phase: beat.phase, kind: beat.kind, action: beat.action,
      page: beat.pageIndex, pageCount: beat.pageCount, stepIndex: beat.stepIndex, presence: beat.presence, emotion, face: emotion ? faceFor(emotion) : undefined,
      stateLabel: emotionLabel(emotion) };
  });
  const order = { public: 0, private: 1, thought: 2, operator: 3 };
  const channels = [...catalog.values()].sort((a, b) => order[a.kind] - order[b.kind]);
  return { agents, channels, beats: beats.map(beat => ({ ...beat, channelIndex: channels.findIndex(c => c.id === beat.channelId) })),
    count: agents.length, first: storyboard.beats[0]?.start ?? 2, duration: storyboard.duration,
    outroDuration: storyboard.outroDuration ?? 3, sourceKind: storyboard.sourceKind, title: storyboard.title, place: storyboard.place };
}
