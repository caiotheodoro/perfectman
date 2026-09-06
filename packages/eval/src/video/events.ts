import { z } from "zod";
import { isEngineAuthoredMotive } from "@perfectman/shared";
import type { VideoStep, VideoStory } from "./types.js";
import { agentsFromSteps, isRecord, MISSING_EMOTION_NOTICE, OPERATOR_EVENT_TYPES, readablePayload } from "./source-utils.js";
import { eventChannels, eventSocialMetadata, mergeChannels, recordedChannels, withChannelVisibility, type PriorEventActors } from "./social-metadata.js";

const jsonValue: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValue), z.record(jsonValue),
]));
const eventSchema = z.object({
  id: z.string().min(1).optional(),
  actorId: z.string().min(1),
  type: z.string().min(1),
  channelId: z.string().optional(),
  pulseIndex: z.number().int().optional(),
  sourceIntentId: z.string().optional(),
  phase: z.string().min(1).optional(),
  payload: z.record(jsonValue),
  emotionalSalience: z.enum(["low", "medium", "high", "critical"]).optional(),
  visibility: z.object({
    visibleToAgents: z.array(z.string()).optional(),
    visibleToSpectators: z.boolean().optional(),
    visibleToOperators: z.boolean().optional(),
    visibilityReason: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function motiveText(payload: Record<string, unknown>): string | undefined {
  const text = payload.summary ?? payload.privateMotiveSummary;
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

function content(type: string, payload: Record<string, unknown>): string {
  if (type === "message_sent" || type === "reply_sent") {
    if (typeof payload.content === "string") return payload.content;
  }
  if (type === "reaction_sent") {
    const emoji = payload.emoji ?? payload.reaction;
    if (typeof emoji === "string") return emoji;
  }
  return `${type.replace(/_/g, " ")}${Object.keys(payload).length ? `\n${readablePayload(payload)}` : ""}`;
}

/** Motives retain their original row position; their source references also join the act. */
export function normalizeEventSteps(value: unknown, basePointer = "/events", prior: PriorEventActors = new Map()): VideoStep[] {
  const events = z.array(eventSchema).min(1).parse(value);
  const original = value as unknown[];
  const motives = new Map<string, number[]>();
  const acts = new Map<string, number[]>();
  events.forEach((event, index) => {
    if (!event.sourceIntentId) return;
    const indexMap = event.type === "private_motive_summary" ? motives : acts;
    indexMap.set(event.sourceIntentId, [...(indexMap.get(event.sourceIntentId) ?? []), index]);
  });
  const ref = (index: number) => `${basePointer}/${index}`;
  return events.flatMap((event, index): VideoStep[] => {
    const payload = event.payload;
    const isMotive = event.type === "private_motive_summary";
    const joined = event.sourceIntentId ? (motives.get(event.sourceIntentId) ?? []) : [];
    const linked = isMotive && event.sourceIntentId ? (acts.get(event.sourceIntentId) ?? []) : joined;
    const summary = motiveText(payload);
    const fallback = payload.engineAuthored === true || isEngineAuthoredMotive(summary ?? "")
      || joined.some(position => {
        const candidate = events[position]!.payload;
        return candidate.engineAuthored === true || isEngineAuthoredMotive(motiveText(candidate) ?? "");
      });
    const drivers = (isMotive ? [index] : joined).flatMap(position => {
      const candidate = events[position]!.payload;
      return candidate.engineAuthored === true || isEngineAuthoredMotive(motiveText(candidate) ?? "")
        ? [] : strings(candidate.emotionDrivers);
    });
    const spokenAct = ["message_sent", "reply_sent", "reaction_sent"].includes(event.type);
    const operator = (fallback && !spokenAct) || OPERATOR_EVENT_TYPES.has(event.type)
      || (!isMotive && event.visibility?.visibilityReason === "operator_only");
    const privateEvent = isMotive || payload.channelType === "private_channel"
      || event.visibility?.visibilityReason?.includes("private")
      || event.visibility?.visibleToSpectators === false;
    const legacyMotive = !isMotive && typeof payload.privateMotiveSummary === "string"
      ? payload.privateMotiveSummary : undefined;
    // Private motive text must not appear in the public event's rendered payload.
    const publicPayload = { ...payload };
    delete publicPayload.privateMotiveSummary;
    const { relatedRefs, ...social } = eventSocialMetadata(event, ref(index), prior);
    const step: VideoStep = {
      ...social,
      id: `event-${index + 1}`,
      phase: event.phase ?? (typeof payload.phase === "string" ? payload.phase : "Simulation"),
      kind: isMotive && !fallback ? "private"
        : spokenAct ? "message" : "event",
      action: event.type.replace(/_/g, " "),
      text: isMotive && summary ? summary : content(event.type, publicPayload),
      actorId: event.actorId, channel: event.channelId, pulse: event.pulseIndex,
      visibility: operator ? "operator" : privateEvent ? "private" : "public",
      emotion: drivers.length && !operator ? { source: "driver", drivers: [...new Set(drivers)] } : undefined,
      sourceRefs: [...new Set([ref(index), ...linked.map(ref), ...relatedRefs])], raw: original[index],
    };
    if (!legacyMotive || joined.length) return [step];
    return [step, {
      ...step, id: `${step.id}-motive`, kind: fallback ? "event" : "private", action: "private motive",
      text: legacyMotive, visibility: fallback ? "operator" : "private", emotion: undefined,
      recipientIds: undefined, audienceIds: undefined, stageAction: undefined, presence: undefined,
    }];
  });
}

export function normalizeEvents(value: unknown, fallbackTitle = "Perfectman run"): VideoStory {
  const bare = Array.isArray(value);
  if (!bare && !isRecord(value)) throw new Error("Expected an event array or an object with events");
  const record = bare ? {} : value as Record<string, unknown>;
  const channels = mergeChannels(recordedChannels(record.channels), eventChannels(bare ? value : record.events));
  const steps = withChannelVisibility(normalizeEventSteps(bare ? value : record.events, bare ? "" : "/events"), channels);
  return {
    title: typeof record.title === "string" ? record.title
      : typeof record.name === "string" ? record.name : typeof record.id === "string" ? record.id : fallbackTitle,
    sourceKind: "events", agents: agentsFromSteps(steps, channels.flatMap(channel => channel.memberIds ?? [])), steps,
    channels,
    notices: [MISSING_EMOTION_NOTICE,
      "Expressions use recorded emotion drivers; emotional salience is not an emotion label.",
      "Simulation is a display phase when the source has no phase label; source array order is retained."],
  };
}
