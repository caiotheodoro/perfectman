/**
 * A pulse, as the stage sees it.
 *
 * The live protocol delivers a pulse as three parallel maps — messages,
 * thinking, emotion — and the stage needs a sequence. The interesting decision
 * is what to do with an agent who thought something and said nothing: that is
 * the engine's whole claim, so it becomes its own beat rather than being
 * dropped for having no message attached.
 *
 * A speaker's own thinking rides along on their message instead, so the line
 * and what was behind it appear together.
 */
import type { LiveChannel, LiveEmotion, LiveMessage, LivePulseFrame, LiveThinking } from "../live/live-frame.types.js";
import { isEngineAuthoredMotive } from "../agent/engine-motive.js";
import type { RecordedEmotion } from "./emotion-face.js";
import { paginate, readingSeconds, type StageBeat, type StageThought } from "./beat.js";

/**
 * `event_visibility` fires for every committed event, including the engine's
 * own bookkeeping, so the stage has to say which of them a person in the room
 * would actually have witnessed.
 *
 * This is an allowlist on purpose. When it was a passthrough, a sixteen-turn
 * run with three spoken lines staged seventy-four of them: every recorded
 * motive, every no-op and every blocked repetition arrived as dialogue.
 */
type Staging = "speech" | "reaction" | "action" | "hidden";

const EVENT_STAGING: Record<string, Staging> = {
  message_sent: "speech",
  reply_sent: "speech",
  reaction_sent: "reaction",
  channel_created: "action",
  agent_joined: "action",
  agent_arrived: "action",
  agent_left: "action",
  agent_invited: "action",
  // The motive is the thought, and it reaches the stage through `thinking`.
  // Staging it again here would put a private sentence in a speech balloon.
  private_motive_summary: "hidden",
  // Silence is shown by the agent standing there saying nothing, not by an
  // event announcing it.
  no_op_recorded: "hidden",
  intent_delayed: "hidden",
  // Engine bookkeeping. Nobody in the room perceives it.
  repetition_blocked: "hidden",
  intent_blocked: "hidden",
  agent_state_snapshot: "hidden",
};

/** Unknown types are hidden rather than spoken — a new event type must opt in. */
export function stagingFor(eventType: string): Staging {
  return EVENT_STAGING[eventType] ?? "hidden";
}

const STAGE_ACTIONS: Record<string, "arrive" | "leave" | "invite"> = {
  agent_joined: "arrive",
  agent_arrived: "arrive",
  agent_left: "leave",
  agent_invited: "invite",
  channel_created: "invite",
};

/**
 * `LiveEmotion` is already curated down to valence, arousal and the top few
 * social emotions, which is exactly what `faceFor` reads. `energy` does not
 * survive the trip, so the `tired` face is unreachable from a live run.
 */
export function toRecordedEmotion(emotion: LiveEmotion | undefined): RecordedEmotion | undefined {
  if (!emotion) return undefined;
  const values: Record<string, number> = { valence: emotion.valence, arousal: emotion.arousal };
  for (const entry of emotion.top) values[entry.key] = entry.value;
  return {
    source: "snapshot",
    ...(emotion.top[0] ? { label: emotion.top[0].key } : {}),
    values,
  };
}

function toThought(thinking: LiveThinking | undefined): StageThought | undefined {
  if (!thinking) return undefined;
  const motive = thinking.privateMotiveSummary;
  // A parse failure or a budget gate is not a feeling. The engine writes those
  // in the same field, so they are filtered out rather than staged as thought.
  if (!motive || isEngineAuthoredMotive(motive)) return undefined;
  return {
    text: motive,
    ...(thinking.intentType ? { intentType: thinking.intentType } : {}),
    drivers: [...thinking.emotionDrivers, ...thinking.motivationDrivers],
  };
}

function membersOf(channels: readonly LiveChannel[], channelId: string): string[] {
  return channels.find((c) => c.id === channelId)?.memberAgentIds ?? [];
}

export type BeatContext = {
  channels: readonly LiveChannel[];
  /** Falls back to this when a beat's channel is unknown, e.g. a run-wide notice. */
  defaultChannelId: string;
};

export function pulseToBeats(frame: LivePulseFrame, context: BeatContext): StageBeat[] {
  const beats: StageBeat[] = [];
  const spoke = new Set<string>();

  for (const message of frame.messages) {
    const staging = stagingFor(message.eventType);
    if (staging === "hidden") continue;

    const emotion = toRecordedEmotion(frame.emotions[message.actorId]);
    const thought = toThought(frame.thinking[message.actorId]);
    const participantIds = membersOf(context.channels, message.channelId);

    if (staging === "action") {
      beats.push({
        id: message.eventId,
        kind: "event",
        pulseIndex: frame.pulseIndex,
        channelId: message.channelId,
        actorId: message.actorId,
        text: message.text,
        audienceIds: message.visibleToAgents,
        participantIds,
        ...(emotion ? { emotion } : {}),
        stageAction: { kind: STAGE_ACTIONS[message.eventType] ?? "invite", agentIds: [message.actorId] },
        duration: readingSeconds(message.text || " "),
      });
      continue;
    }

    spoke.add(message.actorId);

    // A long line becomes several beats rather than one balloon that has to
    // cover the room. The thought rides on the first page only, so it does not
    // repeat behind every page of the same sentence.
    const pages = staging === "reaction" ? [message.text] : paginate(message.text);
    pages.forEach((text, page) => {
      beats.push({
        id: pages.length > 1 ? `${message.eventId}:${page}` : message.eventId,
        kind: "message",
        pulseIndex: frame.pulseIndex,
        channelId: message.channelId,
        actorId: message.actorId,
        text,
        audienceIds: message.visibleToAgents,
        participantIds,
        ...(emotion ? { emotion } : {}),
        ...(thought && page === 0 ? { thought } : {}),
        duration: readingSeconds(text),
      });
    });
  }

  // Whoever thought something and stayed quiet. This is the beat the frame log
  // could never show, and the reason the stage exists.
  for (const [agentId, thinking] of Object.entries(frame.thinking)) {
    if (spoke.has(agentId)) continue;
    const thought = toThought(thinking);
    if (!thought) continue;
    const emotion = toRecordedEmotion(frame.emotions[agentId]);
    beats.push({
      id: `${frame.pulseIndex}:silence:${agentId}`,
      kind: "silence",
      pulseIndex: frame.pulseIndex,
      channelId: context.defaultChannelId,
      actorId: agentId,
      text: "",
      audienceIds: [],
      participantIds: membersOf(context.channels, context.defaultChannelId),
      ...(emotion ? { emotion } : {}),
      thought,
      duration: readingSeconds(thought.text),
    });
  }

  return beats;
}

/** Seeded history, so the stage does not open on an empty room. */
export function priorEventsToBeats(priorEvents: readonly LiveMessage[], context: BeatContext): StageBeat[] {
  return priorEvents
    .filter((message) => stagingFor(message.eventType) !== "hidden")
    .map((message) => ({
    id: message.eventId,
    kind: "message" as const,
    pulseIndex: -1,
    channelId: message.channelId,
    actorId: message.actorId,
    text: message.text,
    audienceIds: message.visibleToAgents,
    participantIds: membersOf(context.channels, message.channelId),
    duration: readingSeconds(message.text),
  }));
}
