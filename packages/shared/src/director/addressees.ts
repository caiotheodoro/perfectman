/**
 * Who a line is aimed at.
 *
 * New runs record it (`addresseeIds` on the event). Older replays do not, so
 * this falls back to the strongest evidence left in the replay and says so:
 * the person a reply answers, anyone named, then the last other voice in the
 * room. Callers can show an inferred addressee differently.
 */
import type { DirectorChannel, DirectorEvent } from "./types.js";

export type Addressees = { ids: string[]; inferred: boolean };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const fold = (t: string): string => t.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Last word of a display name is what people actually call someone: "Dona Neide" is "Neide". */
function callNames(name: string): string[] {
  const parts = fold(name).split(/\s+/).filter((p) => p.length >= 2);
  return [...new Set([fold(name).trim(), parts[parts.length - 1] ?? ""])].filter((n) => n.length >= 2);
}

export function addresseesOf(
  event: DirectorEvent,
  ctx: { agentNames: Record<string, string>; channel?: DirectorChannel; lastOtherSpeaker?: string },
): Addressees {
  const recorded = strings(event.payload["addresseeIds"]).filter((id) => id !== event.actorId);
  if (recorded.length > 0) return { ids: recorded, inferred: false };

  const inChannel = (id: string): boolean => id !== event.actorId && (!ctx.channel || ctx.channel.memberAgentIds.includes(id));
  const ids: string[] = [];
  const push = (id: string | undefined): void => {
    if (id && inChannel(id) && !ids.includes(id)) ids.push(id);
  };
  const replyTo = event.payload["replyToActorId"];
  if (typeof replyTo === "string") push(replyTo);
  for (const id of strings(event.payload["mentionedAgentIds"])) push(id);

  if (ids.length === 0) {
    const text = fold(String(event.payload["content"] ?? ""));
    for (const [id, name] of Object.entries(ctx.agentNames)) {
      if (!inChannel(id)) continue;
      const hit = callNames(name).some((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(text));
      if (hit) push(id);
    }
  }
  // An open remark addresses the room; only a reply is assumed to answer the last other voice.
  if (ids.length === 0 && event.type === "reply_sent" && ctx.lastOtherSpeaker) push(ctx.lastOtherSpeaker);
  return { ids, inferred: true };
}
