import type {
  CommittedEvent,
  Interpretation,
  AgentState,
} from "@perfectman/shared";

/**
 * Programmatic interpretation of observable social signals.
 * Does NOT produce ground truth — only plausible interpretations.
 * Ambiguity is preserved in natural language.
 *
 * 6 signal types:
 *   1. mention_ignored      — agent was mentioned, no reply followed
 *   2. reply_latency        — reply came much later than typical
 *   3. public_silence       — channel is quiet for an unusual length of time
 *   4. public_private_asymmetry — person replies in DM but silent in public
 *   5. reaction_instead_of_text — reaction where text was expected
 *   6. topic_shift          — sudden topic change after sensitive content (MVP: always false)
 */
export function interpretProgrammaticSignals(
  agentId: string,
  agentState: AgentState,
  visibleEvents: CommittedEvent[],
  timeSinceLastPublicMessage: number,
  pulseIntervalMs: number,
): Interpretation[] {
  const interpretations: Interpretation[] = [];

  // 1. Mention ignored — was agent mentioned in last N events with no reply after?
  const mentionIgnored = detectMentionIgnored(agentId, visibleEvents);
  if (mentionIgnored) interpretations.push(mentionIgnored);

  // 2. Reply latency — reply came but after a suspicious delay
  const replyLatency = detectReplyLatency(agentId, visibleEvents, pulseIntervalMs);
  if (replyLatency) interpretations.push(replyLatency);

  // 3. Public silence — channel quiet for > 2 minutes
  if (timeSinceLastPublicMessage > 120) {
    interpretations.push({
      signalType:       "public_silence",
      description:      timeSinceLastPublicMessage > 300
        ? "The conversation seems to have died down for a while — maybe everyone is busy, or the topic ran its course."
        : "There hasn't been a public message in a couple minutes. Could mean people are thinking, busy, or disengaged.",
      confidence:       timeSinceLastPublicMessage > 300 ? "likely" : "plausible",
      involvedAgentIds: [],
      sourceEventIds:   [],
    });
  }

  // 4. Public/private asymmetry — events show someone silent in public but active elsewhere
  const asymmetry = detectPublicPrivateAsymmetry(agentId, visibleEvents);
  if (asymmetry) interpretations.push(asymmetry);

  // 5. Reaction instead of text — someone used a reaction where text was typical
  const reactionSignal = detectReactionInsteadOfText(agentId, visibleEvents);
  if (reactionSignal) interpretations.push(reactionSignal);

  // 6. Topic shift — MVP: not detected
  // post-MVP: LLM-based topic change detection

  return interpretations;
}

function detectMentionIgnored(agentId: string, events: CommittedEvent[]): Interpretation | null {
  // Find most recent event where agent was mentioned by someone else
  // then check if a reply from the actor followed
  const WINDOW = 8;
  const recent = events.slice(-WINDOW);

  for (let i = recent.length - 1; i >= 0; i--) {
    const event = recent[i]!;
    if (event.actorId === agentId) continue;
    const mentions = event.payload["mentionedAgentIds"] as string[] | undefined;
    if (!mentions?.includes(agentId)) continue;

    // Look for a reply from event.actorId after this event
    const afterEvents = recent.slice(i + 1);
    const replied = afterEvents.some(
      e => e.actorId === event.actorId &&
           (e.type === "reply_sent" || e.type === "message_sent"),
    );

    // Also check if agent themselves replied to the mention
    const agentReplied = afterEvents.some(e => e.actorId === agentId);

    if (!replied && !agentReplied && afterEvents.length >= 2) {
      return {
        signalType:       "mention_ignored",
        description:      `${event.actorId === agentId ? "You" : "Someone"} brought you up, but the conversation seems to have moved on without a direct reply. Hard to know if that was intentional or just the flow of things.`,
        confidence:       afterEvents.length >= 4 ? "plausible" : "uncertain",
        involvedAgentIds: [event.actorId],
        sourceEventIds:   [event.id, ...afterEvents.map(e => e.id)],
      };
    }
    break; // only check most recent mention
  }
  return null;
}

function detectReplyLatency(
  agentId: string,
  events: CommittedEvent[],
  pulseIntervalMs: number,
): Interpretation | null {
  // Find replies TO this agent and check their timing
  const LATENCY_THRESHOLD_MS = pulseIntervalMs * 5; // 5+ pulses = late

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.type !== "reply_sent") continue;
    const replyTarget = event.payload["replyToActorId"] as string | undefined;
    if (replyTarget !== agentId) continue;

    // Find the original message this replied to
    const sourceId = event.payload["replyToEventId"] as string | undefined;
    if (!sourceId) continue;
    const source = events.find(e => e.id === sourceId);
    if (!source) continue;

    const latency = event.createdAt - source.createdAt;
    if (latency > LATENCY_THRESHOLD_MS) {
      return {
        signalType:       "reply_latency",
        description:      `That reply came later than you might have expected — could mean they were busy, thinking carefully, or just saw it late. Maybe nothing, maybe deliberate.`,
        confidence:       latency > LATENCY_THRESHOLD_MS * 3 ? "plausible" : "uncertain",
        involvedAgentIds: [event.actorId],
        sourceEventIds:   [source.id, event.id],
      };
    }
  }
  return null;
}

function detectPublicPrivateAsymmetry(
  agentId: string,
  events: CommittedEvent[],
): Interpretation | null {
  // Check if an agent was active in private events but silent in recent public ones
  const WINDOW = 10;
  const recent = events.slice(-WINDOW);

  const agentsByPrivate = new Map<string, number>();
  const agentsByPublic  = new Map<string, number>();

  for (const e of recent) {
    if (e.actorId === agentId) continue;
    const channel = e.channelId;
    // We can't know channel type from here — use visibility as proxy
    if (e.visibility.visibleToAgents.length > 0 &&
        !e.visibility.visibleToAgents.includes(agentId) &&
        e.visibility.visibleToSpectators === false) {
      // private-ish
      agentsByPrivate.set(e.actorId, (agentsByPrivate.get(e.actorId) ?? 0) + 1);
    } else {
      agentsByPublic.set(e.actorId, (agentsByPublic.get(e.actorId) ?? 0) + 1);
    }
  }

  for (const [actorId, privateCount] of agentsByPrivate.entries()) {
    const publicCount = agentsByPublic.get(actorId) ?? 0;
    if (privateCount >= 2 && publicCount === 0) {
      return {
        signalType:       "public_private_asymmetry",
        description:      `Someone seems to be talking elsewhere but staying quiet here. Might just be juggling conversations — or maybe there's something going on that isn't visible in this channel.`,
        confidence:       "uncertain",
        involvedAgentIds: [actorId],
        sourceEventIds:   recent.map(e => e.id),
      };
    }
  }
  return null;
}

function detectReactionInsteadOfText(
  agentId: string,
  events: CommittedEvent[],
): Interpretation | null {
  // If agent's last 3 public messages got reactions (not text replies)
  const WINDOW = 5;
  const recent = events.slice(-WINDOW);

  // Find agent's most recent message
  const ownMsg = [...recent].reverse().find(
    e => e.actorId === agentId && (e.type === "message_sent" || e.type === "reply_sent"),
  );
  if (!ownMsg) return null;

  // Any text replies to it vs reactions
  const after = recent.slice(recent.indexOf(ownMsg) + 1);
  const textReplies = after.filter(
    e => e.type === "reply_sent" &&
         (e.payload["replyToEventId"] as string | undefined) === ownMsg.id,
  );
  const reactions = after.filter(
    e => e.type === "reaction_sent" &&
         (e.payload["replyToEventId"] as string | undefined) === ownMsg.id,
  );

  if (reactions.length >= 1 && textReplies.length === 0 && after.length >= 2) {
    return {
      signalType:       "reaction_instead_of_text",
      description:      `People responded with reactions rather than words. Could mean they acknowledged it without knowing what to say, or just kept it light — hard to tell.`,
      confidence:       "uncertain",
      involvedAgentIds: reactions.map(e => e.actorId),
      sourceEventIds:   [ownMsg.id, ...reactions.map(e => e.id)],
    };
  }
  return null;
}
