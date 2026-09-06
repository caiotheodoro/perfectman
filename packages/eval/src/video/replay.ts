import { z } from "zod";
import type { VideoStory, VideoStep } from "./types.js";
import { normalizeEventSteps } from "./events.js";
import { operatorStep, ReplayOperator, ReplayState, stateStep } from "./replay-state.js";
import { pointerKey } from "./source-utils.js";
import { eventChannels, mergeChannels, recordedAudience, recordedChannels, withChannelVisibility, type PriorEventActors } from "./social-metadata.js";

const Frame = z.object({
  pulseIndex: z.number().int(),
  committedEvents: z.array(z.record(z.unknown())),
  agentStates: z.record(ReplayState).optional(),
  agentThinking: z.record(z.record(z.unknown())).optional(),
  operatorEvents: z.array(ReplayOperator).optional(),
}).passthrough();
const Replay = z.object({
  simulationName: z.string().optional(),
  agentIds: z.array(z.string().min(1)),
  agentNames: z.record(z.string()).optional(),
  channels: z.array(z.object({ id: z.string(), type: z.string(), name: z.string().optional() }).passthrough()).optional(),
  pulses: z.array(Frame),
  goals: z.array(z.record(z.unknown())).optional(),
  endReason: z.string().optional(),
  endingOffer: z.record(z.unknown()).optional(),
}).passthrough();

export function isReplaySource(value: unknown): boolean {
  return !!value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).pulses);
}

export function normalizeReplaySource(value: unknown, fallbackTitle = "Perfectman replay"): VideoStory {
  const replay = Replay.parse(value);
  const steps: VideoStep[] = [];
  const notices = new Set<string>([
    "Replay pulse and event arrays retain their source order. Operator records follow committed events; their separate arrays do not establish a total cross-stream order.",
    "Emotional snapshots apply only when their recorded state step is reached. Intermediate attention, interpretation, pressure and inhibition phases were not saved.",
  ]);
  const agents = new Map(replay.agentIds.map(id => [id, { id, name: replay.agentNames?.[id] || id }]));
  const prior: PriorEventActors = new Map();
  const channels = mergeChannels(recordedChannels(replay.channels), eventChannels(replay.pulses.flatMap(frame => frame.committedEvents)));
  for (const [frameIndex, frame] of replay.pulses.entries()) {
    const ref = `/pulses/${frameIndex}`;
    steps.push({
      id: ref, phase: "Recorded pulse", kind: "event", pulse: frame.pulseIndex,
      text: `Pulse ${frame.pulseIndex}${frame.committedEvents.length === 0 ? ": no committed events." : "."}`,
      visibility: "operator", sourceRefs: [ref], raw: frame,
    });
    const eventSteps = withChannelVisibility(frame.committedEvents.length
      ? normalizeEventSteps(frame.committedEvents, `${ref}/committedEvents`, prior) : [], channels);
    for (const step of eventSteps) {
      step.id = `${ref}/${step.id}`;
      step.pulse ??= frame.pulseIndex;
    }
    steps.push(...eventSteps);
    const snapshots = new Map<string, VideoStep[]>();
    for (const [opIndex, op] of (frame.operatorEvents ?? []).entries()) {
      const opRef = `${ref}/operatorEvents/${opIndex}`;
      if (op.pulseIndex !== undefined && op.pulseIndex !== frame.pulseIndex) {
        throw new Error(`${opRef}: operator record belongs to a different pulse`);
      }
      if (op.type === "event_visibility") {
        const eventIndex = frame.committedEvents.findIndex(event => event.id === op.data?.eventId);
        const matching = eventIndex < 0 ? undefined : eventSteps.find(step =>
          step.sourceRefs[0] === `${ref}/committedEvents/${eventIndex}`);
        if (matching) {
          matching.sourceRefs.push(opRef);
          matching.raw = { event: matching.raw, visibilityRecord: op };
          matching.audienceIds ??= recordedAudience(op.data?.visibleToAgents);
          notices.add("Delivered event visibility may be reconstructed by the HTML receiver. Its default salience and public visibility are not original event measurements; channel privacy is retained separately.");
          continue;
        }
      }
      if (op.type === "agent_state_snapshot" && op.data?.state !== undefined) {
        const state = ReplayState.parse(op.data.state);
        const actorId = op.agentId ?? state.agentId;
        if (!actorId) throw new Error(`${opRef}: a state snapshot needs an agent ID`);
        if (state.agentId && state.agentId !== actorId) throw new Error(`${opRef}: snapshot agent ID mismatch`);
        const step = stateStep(state, actorId, op.pulseIndex ?? frame.pulseIndex, `${opRef}/data/state`);
        step.sourceRefs.push(opRef);
        step.raw = { state, operatorRecord: op };
        steps.push(step);
        snapshots.set(actorId, [...(snapshots.get(actorId) ?? []), step]);
      } else {
        steps.push(operatorStep(op, frame.pulseIndex, opRef));
      }
    }
    for (const [actorId, state] of Object.entries(frame.agentStates ?? {})) {
      if (state.agentId && state.agentId !== actorId) throw new Error(`${ref}: snapshot agent ID mismatch`);
      const stateRef = `${ref}/agentStates/${pointerKey(actorId)}`;
      const same = (snapshots.get(actorId) ?? []).find(step =>
        JSON.stringify((step.raw as { state: unknown }).state) === JSON.stringify(state));
      if (same) same.sourceRefs.push(stateRef);
      else steps.push(stateStep(state, actorId, frame.pulseIndex, stateRef));
    }
    if (Object.keys(frame.agentThinking ?? {}).length) {
      notices.add("agentThinking is retained in pulse source data as context only: some recorders repeat stale intents. Only same-pulse action_intent records animate fresh private thinking.");
    }
  }
  if (replay.goals?.length) steps.push({
    id: "/goals", phase: "Recorded final goal state", kind: "state", visibility: "operator",
    text: JSON.stringify(replay.goals, null, 2), sourceRefs: ["/goals"], raw: replay.goals,
  });
  if (replay.endReason || replay.endingOffer) steps.push({
    id: "/ending", phase: "Recorded ending", kind: "event", visibility: "operator",
    text: [replay.endReason, replay.endingOffer ? JSON.stringify(replay.endingOffer, null, 2) : ""].filter(Boolean).join("\n"),
    sourceRefs: [...(replay.endReason ? ["/endReason"] : []), ...(replay.endingOffer ? ["/endingOffer"] : [])],
    raw: { endReason: replay.endReason, endingOffer: replay.endingOffer },
  });
  const knownIds = [...steps.flatMap(step => step.actorId ? [step.actorId] : []), ...channels.flatMap(channel => channel.memberIds ?? [])];
  for (const id of knownIds) if (!agents.has(id) && !["system", "host"].includes(id)) {
    agents.set(id, { id, name: replay.agentNames?.[id] || id });
  }
  if (channels.some(channel => channel.memberIds)) notices.add("Channel members are recorded directory metadata, not historical attendance. Only explicit event audiences identify who could see an action.");
  return { title: replay.simulationName || fallbackTitle, sourceKind: "replay", agents: [...agents.values()], channels, steps, notices: [...notices] };
}
