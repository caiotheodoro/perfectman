import { z } from "zod";
import type { VideoChannel, VideoStory } from "./types.js";
import { MISSING_EMOTION_NOTICE } from "./source-utils.js";
import { mergeChannels } from "./social-metadata.js";

const text = z.string().refine(value => value.trim().length > 0, "Must not be blank");
const ids = z.array(text);
const emotion = z.object({
  source: z.literal("authored").optional(),
  label: text.optional(),
  drivers: z.array(text).optional(),
  values: z.record(z.number().finite()).optional(),
}).strict().refine(value => value.label || value.drivers?.length || Object.keys(value.values ?? {}).length, {
  message: "An authored emotion needs a label, drivers, or numeric values",
});
const scriptSchema = z.object({
  version: z.literal("perfectman-video-v1"),
  title: text,
  place: text.optional(),
  agents: z.array(z.object({ id: text, name: text }).strict()).min(1),
  channels: z.array(z.object({
    id: text, name: text, kind: z.enum(["public", "private", "operator"]), memberIds: ids.optional(),
  }).strict()).optional(),
  steps: z.array(z.object({
    phase: text,
    kind: z.enum(["message", "private", "event", "state", "narration"]),
    text: z.string().min(1),
    actorId: text.optional(),
    channel: text.optional(),
    recipientIds: ids.optional(), audienceIds: ids.optional(), presence: text.optional(),
    stageAction: z.object({ kind: z.enum(["arrive", "leave", "invite"]), agentIds: ids.min(1) }).strict().optional(),
    visibility: z.enum(["public", "private", "operator"]).optional(),
    emotion: emotion.optional(),
    duration: z.number().finite().positive().optional(),
  }).strict()).min(1),
}).strict();

export function normalizeScript(value: unknown): VideoStory {
  const source = scriptSchema.parse(value);
  const ids = new Set(source.agents.map(agent => agent.id));
  if (ids.size !== source.agents.length) throw new Error("Script agent IDs must be unique");
  const channelIds = new Set(source.channels?.map(channel => channel.id));
  if (channelIds.size !== (source.channels?.length ?? 0)) throw new Error("Script channel IDs must be unique");
  const requireAgentIds = (references: string[], field: string) => {
    for (const id of references) if (!ids.has(id)) throw new Error(`Unknown script ${field}: ${id}`);
  };
  for (const channel of source.channels ?? []) requireAgentIds(channel.memberIds ?? [], "channel memberId");
  for (const [index, step] of source.steps.entries()) {
    if (step.actorId && !ids.has(step.actorId)) throw new Error(`Unknown script actorId: ${step.actorId}`);
    if (source.channels && step.channel && !channelIds.has(step.channel)) throw new Error(`Unknown script channel: ${step.channel}`);
    if (step.visibility === "public" && source.channels?.find(channel => channel.id === step.channel)?.kind === "private") {
      throw new Error(`Script step ${index + 1} sets public visibility in private channel ${step.channel}; omit visibility or use private/operator`);
    }
    requireAgentIds(step.recipientIds ?? [], "recipientId");
    requireAgentIds(step.audienceIds ?? [], "audienceId");
    requireAgentIds(step.stageAction?.agentIds ?? [], "stageAction agentId");
    if (step.stageAction && step.stageAction.kind !== "arrive" && !step.channel) {
      throw new Error("Script leave/invite stage actions need a channel; they do not leave the simulation");
    }
  }
  const inferred: VideoChannel[] = source.steps.flatMap(step => step.channel && step.kind !== "private"
    ? [{ id: step.channel, name: step.channel, kind: step.visibility ?? "public" }] : []);
  const channels = source.channels ?? mergeChannels(inferred);
  const original = value as { steps: unknown[] };
  return {
    title: source.title,
    sourceKind: "script",
    agents: source.agents,
    channels, ...(source.place ? { place: source.place } : {}),
    steps: source.steps.map((step, index) => ({
      ...step,
      id: `step-${index + 1}`,
      action: step.kind,
      visibility: step.visibility ?? (step.kind === "private" ? "private" : channels.find(channel => channel.id === step.channel)?.kind ?? "public"),
      emotion: step.emotion ? { ...step.emotion, source: "authored" } : undefined,
      sourceRefs: [`/steps/${index}`],
      raw: original.steps[index],
    })),
    notices: ["Script dialogue, phases, and emotion cues are authored.", MISSING_EMOTION_NOTICE],
  };
}
