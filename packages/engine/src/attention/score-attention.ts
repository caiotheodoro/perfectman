import type {
  CommittedEvent,
  AgentState,
  PersonaConfig,
  RelationalState,
  WorldSignals,
  AttentionResult,
  AttentionReason,
  TriggeringReason,
} from "@perfectman/shared";

/**
 * Compute attention for an agent given new events this pulse.
 *
 * Due score formula:
 *   cadencePulse        — base initiative accumulator contribution
 *   + mentionUrgency    — was agent directly mentioned / replied to
 *   + channelActivityPull — activity level in visible channels
 *   + personFocusPull   — relational weight toward actor
 *   + arousalBoost      — agent's own arousal amplifying sensitivity
 *   + objectiveUrgency  — high-salience events
 *   + socialPressurePull — high arousal nearby
 *   - sleepPressurePenalty — low energy suppresses attention
 *   - offlinePenalty    — presence mode suppresses
 *   - recentActionCooldown — just acted, cool down
 *
 * needsLLM = true when dueScore >= ATTENTION_LLM_THRESHOLD or triggering event
 * is high/critical salience and agent is mentioned.
 */

const ATTENTION_LLM_THRESHOLD = 0.55;
const PRESENCE_PENALTY: Record<string, number> = {
  active:          0.00,
  semi_active:     0.05,
  lurking:         0.20,
  busy_elsewhere:  0.35,
  avoidant:        0.45,
  offline:         1.00,
};

export function scoreAttention(
  agent: AgentState,
  persona: PersonaConfig,
  newEvents: CommittedEvent[],
  worldSignals: WorldSignals,
  relationalStates: Map<string, RelationalState>,
  lastActionAt: number | null,
  pulseIntervalMs: number,
  now: number,
): AttentionResult {
  if (agent.presence === "offline") {
    return {
      noticed: false,
      dueScore: 0,
      reasons: [],
      needsLLM: false,
      triggeringReason: "attention_event",
    };
  }

  const reasons: AttentionReason[] = [];
  let dueScore = 0;

  // Base cadence contribution from initiative accumulators
  const cadencePulse = agent.initiativeAccumulators.length > 0
    ? Math.max(0, ...agent.initiativeAccumulators.map(a => a.value))
    : 0;
  dueScore += cadencePulse * 0.25;
  if (cadencePulse > 0.5) reasons.push("initiative_cadence");

  // Scan new events for mentions and salience
  let triggeringEvent: CommittedEvent | undefined;
  let mentionUrgency = 0;
  let objectiveUrgency = 0;

  for (const event of newEvents) {
    // Your own messages don't demand your own attention.
    if (event.actorId === agent.agentId) continue;
    const isMentioned =
      (event.payload["mentionedAgentIds"] as string[] | undefined)?.includes(agent.agentId) === true;

    const isDirectReply =
      event.type === "reply_sent" &&
      (event.payload["replyToActorId"] as string | undefined) === agent.agentId;

    if (isMentioned || isDirectReply) {
      const mention = isMentioned ? 0.30 : 0.25;
      if (mention > mentionUrgency) {
        mentionUrgency = mention;
        triggeringEvent = event;
      }
      if (isMentioned) reasons.push("direct_mention");
      if (isDirectReply) reasons.push("reply_to_self");
    }

    // Salience → objective urgency
    const salience = event.emotionalSalience;
    const salienceScore =
      salience === "critical" ? 0.40 :
      salience === "high"     ? 0.25 :
      salience === "medium"   ? 0.10 : 0.02;

    if (salienceScore > objectiveUrgency) {
      objectiveUrgency = salienceScore;
      if (!triggeringEvent) triggeringEvent = event;
    }
    if (salienceScore >= 0.25) reasons.push("high_salience_event");

    // Relational involvement — actor is someone we have a relational state for
    if (event.actorId !== agent.agentId) {
      const rel = relationalStates.get(event.actorId);
      if (rel) {
        const relWeight = (rel.affection + rel.trust + rel.curiosity) / 3;
        if (relWeight > 0.4) {
          dueScore += relWeight * 0.12;
          reasons.push("relational_involvement");
          if (!triggeringEvent) triggeringEvent = event;
        }
      }
    }
  }

  dueScore += mentionUrgency;
  dueScore += objectiveUrgency;

  // Channel activity pull — higher message rate → more pull
  const channelActivityPull = Math.min(0.20, worldSignals.channelMessageRatePerMinute / 60);
  dueScore += channelActivityPull;

  // Arousal boost — own arousal amplifies attention sensitivity
  const arousalBoost = agent.coreMood.arousal * persona.emotionalReactivity * 0.10;
  dueScore += arousalBoost;
  if (agent.coreMood.arousal > 0.6) reasons.push("arousal_contagion");

  // Social pressure pull — high arousal nearby
  if (worldSignals.highArousalNearby) {
    dueScore += 0.10;
  }

  // Boredom threshold — low arousal for too long → push toward acting
  if (agent.coreMood.arousal < 0.25 && agent.coreMood.energy > 0.3) {
    dueScore += 0.12;
    reasons.push("boredom_threshold");
  }

  // Suppress: sleep pressure — low energy
  const energyPenalty = (1 - agent.coreMood.energy) * 0.15;
  dueScore -= energyPenalty;

  // Suppress: presence mode
  const presencePenalty = PRESENCE_PENALTY[agent.presence] ?? 0;
  dueScore -= presencePenalty;

  // Suppress: recent action cooldown. The 0.20 magnitude and the
  // pulseIntervalMs * 3 horizon are provisional — both are tuned in #129.
  if (lastActionAt !== null) {
    const msSinceAction = now - lastActionAt;
    const cooldownRatio = Math.max(0, 1 - msSinceAction / (pulseIntervalMs * 3));
    dueScore -= cooldownRatio * 0.20;
  }

  dueScore = Math.max(0, Math.min(1, dueScore));

  const noticed = dueScore > 0.15 || newEvents.length > 0;
  // A direct mention or reply-to-self ALWAYS deserves the LLM's attention —
  // "an agent notices a mention and replies" is a V1 target behavior.
  // Own events never count: a high-arousal persona stamps `high` salience on
  // her own messages, and before this she forced an LLM call on herself
  // every pulse after speaking. (The decision owns the final needsLLM —
  // ADR-0015 — this value is attention's own read, reported for operators.)
  const needsLLM =
    dueScore >= ATTENTION_LLM_THRESHOLD ||
    mentionUrgency > 0 ||
    (newEvents.some(
      e =>
        e.actorId !== agent.agentId &&
        (e.emotionalSalience === "high" || e.emotionalSalience === "critical"),
    ));

  // Determine triggering reason
  let triggeringReason: TriggeringReason = "attention_event";
  if (mentionUrgency === 0 && cadencePulse > 0.5 && newEvents.length === 0) {
    triggeringReason = "initiative_cadence";
  }

  return {
    noticed,
    dueScore,
    reasons: [...new Set(reasons)],
    needsLLM,
    triggeringReason,
    triggeringEventId: triggeringEvent?.id,
  };
}
