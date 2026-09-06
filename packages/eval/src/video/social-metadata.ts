import { z } from "zod";
import type { VideoChannel, VideoStep } from "./types.js";
import { isRecord, OPERATOR_EVENT_TYPES } from "./source-utils.js";

const ids = z.array(z.string().min(1));
const payloadSchema = z.object({
  personTargets: ids.optional(), invitedAgentIds: ids.optional(), invitedAgentId: z.string().optional(),
  replyToActorId: z.string().optional(), replyToEventId: z.string().optional(), targetEventId: z.string().optional(),
  presence: z.string().optional(),
}).passthrough();
type EventSource = {
  id?: string; actorId: string; type: string; channelId?: string; payload: Record<string, unknown>;
  visibility?: { visibleToAgents?: string[] };
};
export type PriorEventActors = Map<string, { actorId: string; ref: string }>;
type SocialFields = Pick<VideoStep, "recipientIds" | "audienceIds" | "stageAction" | "presence">;

export function recordedAudience(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const found = [...new Set(ids.parse(value))];
  return found.length ? found : undefined;
}

/** Resolve references only against events already visited in the source array. */
export function eventSocialMetadata(event: EventSource, ref: string, prior: PriorEventActors): SocialFields & { relatedRefs: string[] } {
  const fields: SocialFields & { relatedRefs: string[] } = { relatedRefs: [] };
  const payload = payloadSchema.parse(event.payload);
  if (event.type !== "private_motive_summary") {
    const recipients = new Set(payload.personTargets ?? []);
    if (event.type === "reply_sent" && payload.replyToActorId) recipients.add(payload.replyToActorId);
    const targetId = event.type === "reply_sent" ? payload.replyToEventId
      : event.type === "reaction_sent" ? payload.targetEventId : undefined;
    const target = targetId ? prior.get(targetId) : undefined;
    if (target) { recipients.add(target.actorId); fields.relatedRefs.push(target.ref); }
    if (recipients.size) fields.recipientIds = [...recipients];
    const audience = recordedAudience(event.visibility?.visibleToAgents);
    if (audience) fields.audienceIds = audience;
    if (event.type === "presence_changed" && payload.presence) fields.presence = payload.presence;
    if (event.channelId) {
      const invited = event.type === "agent_invited" && payload.invitedAgentId ? [payload.invitedAgentId]
        : event.type === "channel_created" ? payload.invitedAgentIds ?? [] : [];
      if (invited.length) fields.stageAction = { kind: "invite", agentIds: [...new Set(invited)] };
      if (event.type === "agent_left") fields.stageAction = { kind: "leave", agentIds: [event.actorId] };
    }
  }
  if (event.id && !prior.has(event.id)) prior.set(event.id, { actorId: event.actorId, ref });
  return fields;
}

const channelSchema = z.object({
  id: z.string().min(1), name: z.string().optional(),
  kind: z.enum(["public", "private", "operator"]).optional(), type: z.string().optional(),
  memberIds: ids.optional(), memberAgentIds: ids.optional(),
}).passthrough();

export function recordedChannels(value: unknown): VideoChannel[] {
  if (value === undefined) return [];
  return z.array(channelSchema).parse(value).map(channel => ({
    id: channel.id, name: channel.name || channel.id,
    kind: channel.kind ?? (channel.type === "private_channel" ? "private"
      : channel.type === "operator_channel" || channel.type === "spectator_channel" ? "operator" : "public"),
    ...((channel.memberIds ?? channel.memberAgentIds) !== undefined
      ? { memberIds: [...new Set(channel.memberIds ?? channel.memberAgentIds)] } : {}),
  }));
}

/** Earlier declared metadata wins; inferred rows never turn a thought into a channel. */
export function mergeChannels(...groups: VideoChannel[][]): VideoChannel[] {
  const channels = new Map<string, VideoChannel>();
  for (const group of groups) {
    const declared = new Set(channels.keys());
    for (const channel of group) {
      if (declared.has(channel.id)) continue;
      const previous = channels.get(channel.id);
      channels.set(channel.id, previous ? {
        ...previous, name: previous.name === previous.id ? channel.name : previous.name,
        kind: previous.kind === "private" || channel.kind === "private" ? "private" : previous.kind,
        ...(!previous.memberIds && channel.memberIds ? { memberIds: channel.memberIds } : {}),
      } : channel);
    }
  }
  return [...channels.values()];
}

/** Channel identity can restrict public steps; it never supplies historical attendance. */
export function withChannelVisibility(steps: VideoStep[], channels: VideoChannel[]): VideoStep[] {
  const kinds = new Map(channels.map(channel => [channel.id, channel.kind]));
  return steps.map(step => {
    const kind = step.channel ? kinds.get(step.channel) : undefined;
    return step.visibility === "public" && kind && kind !== "public" ? { ...step, visibility: kind } : step;
  });
}

export function eventChannels(value: unknown): VideoChannel[] {
  if (!Array.isArray(value)) return [];
  const explicit: VideoChannel[] = [], inferred: VideoChannel[] = [];
  for (const event of value) {
    if (!isRecord(event) || typeof event.channelId !== "string" || !event.channelId) continue;
    const payload = isRecord(event.payload) ? event.payload : {};
    const visibility = isRecord(event.visibility) ? event.visibility : {};
    // Internal event visibility says nothing about its surrounding channel.
    if (event.type === "private_motive_summary" || OPERATOR_EVENT_TYPES.has(String(event.type))) continue;
    // Invite-party visibility does not make the surrounding channel private.
    if (event.type === "agent_invited" && !payload.channelType && !String(visibility.visibilityReason ?? "").includes("private_channel")) continue;
    const explicitKind = payload.channelType === "public_channel" ? "public"
      : payload.channelType === "private_channel" ? "private"
      : payload.channelType === "operator_channel" || payload.channelType === "spectator_channel" ? "operator" : undefined;
    const kind = explicitKind ?? (visibility.visibleToSpectators === false
      || String(visibility.visibilityReason ?? "").includes("private") ? "private" : "public");
    const members = event.type === "channel_created" && typeof event.actorId === "string"
      ? [event.actorId, ...(recordedAudience(payload.invitedAgentIds) ?? [])] : undefined;
    (explicitKind ? explicit : inferred).push({ id: event.channelId, name: typeof payload.channelName === "string" ? payload.channelName : event.channelId, kind,
      ...(members ? { memberIds: [...new Set(members)] } : {}) });
  }
  return mergeChannels(explicit, inferred);
}
