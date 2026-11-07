import type { ActionIntent, CommittedEvent } from "@perfectman/shared";

/** Who whispered to an actor, as the whisper's own payload says it (hotel, D44). */
export type Whisperer = { ref: string; name?: string };

/**
 * The person an actor's spoken line should be whispered back to: the trigger of this decision is a whisper that
 * only this actor heard clearly, and the line is not a reply to someone else's line. Whispered replies are the default
 * (D44): the person chose a private channel, so the answer goes there and never to the room.
 */
export function whisperer(trigger: CommittedEvent | undefined, intent: ActionIntent): Whisperer | undefined {
  if (!trigger || trigger.actorId === intent.actorId) return undefined;
  if (intent.intentType !== "send_message" && intent.intentType !== "reply_to_message") return undefined;
  const p = trigger.payload as Record<string, unknown>;
  if (p["mode"] !== "whisper" || p["untrusted"] !== true) return undefined;
  const hearing = p["hearing"];
  const level = typeof hearing === "object" && hearing !== null ? (hearing as Record<string, unknown>)[intent.actorId] : undefined;
  if (level !== "clear") return undefined;
  // A reply to somebody else's own line is theirs, not the whisperer's.
  if (intent.replyToActorId !== undefined && intent.replyToActorId !== trigger.actorId) return undefined;
  return { ref: trigger.actorId, ...(typeof p["senderName"] === "string" ? { name: p["senderName"] } : {}) };
}

/**
 * The intent with a whisper's answer kept between the two of them: naming a third person in it would only walk the
 * speaker over to them and make the planner and the frame log treat the line as theirs.
 */
export function answerWhisper(intent: ActionIntent, trigger: CommittedEvent | undefined): ActionIntent {
  return intent.personTargets.length > 0 && whisperer(trigger, intent) ? { ...intent, personTargets: [] } : intent;
}
