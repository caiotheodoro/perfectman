import type {
  CommittedEvent,
  AgentState,
  StagnationMetrics,
} from "@perfectman/shared";
import {
  STAGNATION_THRESHOLDS,
  STAGNATION_WEIGHTS,
  ATTRACTOR_DETECTION_WINDOW_PULSES,
  ATTRACTOR_THRESHOLDS,
} from "@perfectman/shared";
import { clamp, meanOf } from "@perfectman/shared";

/**
 * Compute stagnation metrics for a simulation from recent committed events
 * and current agent states.
 *
 * 7 metrics:
 *   BDI — Behavioral Diversity Index (range of action types used)
 *   RDV — Relational Drift Variance (how much relational states are changing)
 *   IGE — Initiative Gap Entropy (spread of initiative sources)
 *   CUE — Channel Utilization Entropy (message distribution across channels)
 *   ERI — Emotional Range Index (valence/arousal variance across agents)
 *   ISD — Intent Success Diversity (variety of intent types succeeding)
 *   CNS — Conversation Novelty Score (unique content vs repetition, MVP: heuristic)
 *
 * stagnation = 1 - diversity score (so high composite = bad)
 */
export function computeStagnationMetrics(
  simulationId: string,
  pulseIndex: number,
  recentEvents: CommittedEvent[],  // window of recent events
  agentStates: Map<string, AgentState>,
): StagnationMetrics {
  const bdi = computeBDI(recentEvents);
  const rdv = computeRDV(agentStates);
  const ige = computeIGE(agentStates);
  const cue = computeCUE(recentEvents);
  const eri = computeERI(agentStates);
  const isd = computeISD(recentEvents);
  const cns = computeCNS(recentEvents);

  // Composite: stagnation = weighted sum of (1 - metric) for diversity metrics
  // Each metric already represents "stagnation level" [0, 1]
  const compositeScore = clamp(
    STAGNATION_WEIGHTS.bdi * bdi +
    STAGNATION_WEIGHTS.rdv * rdv +
    STAGNATION_WEIGHTS.ige * ige +
    STAGNATION_WEIGHTS.cue * cue +
    STAGNATION_WEIGHTS.eri * eri +
    STAGNATION_WEIGHTS.isd * isd +
    STAGNATION_WEIGHTS.cns * cns,
    0,
    1,
  );

  const level = compositeScore >= STAGNATION_THRESHOLDS.critical ? "critical"
    : compositeScore >= STAGNATION_THRESHOLDS.red     ? "red"
    : compositeScore >= STAGNATION_THRESHOLDS.yellow  ? "yellow"
    : "normal";

  return {
    simulationId,
    pulseIndex,
    bdi,
    rdv,
    ige,
    cue,
    eri,
    isd,
    cns,
    compositeScore,
    level,
  };
}

/**
 * BDI — Behavioral Diversity Index.
 * Low = agents doing same action types repeatedly = high stagnation.
 * Score [0, 1] where 1 = completely repetitive.
 */
function computeBDI(events: CommittedEvent[]): number {
  if (events.length === 0) return 0.5; // neutral — no data

  const typeCounts = new Map<string, number>();
  for (const e of events) {
    typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1);
  }

  const totalTypes = 23; // canonical event types
  const usedTypes = typeCounts.size;
  const dominanceRatio = Math.max(...typeCounts.values()) / events.length;

  // High dominance = one type dominates = stagnation
  return clamp(dominanceRatio * (1 - usedTypes / totalTypes), 0, 1);
}

/**
 * RDV — Relational Drift Variance.
 * Low variance = relationships stuck = stagnation.
 * Heuristic: if all agents have similar trust values, stagnation is high.
 */
function computeRDV(agentStates: Map<string, AgentState>): number {
  const trustValues: number[] = [];
  for (const state of agentStates.values()) {
    for (const rel of state.relationalStates.values()) {
      trustValues.push(rel.trust);
    }
  }

  if (trustValues.length < 2) return 0.5;

  const mean = meanOf(trustValues);
  const variance = meanOf(trustValues.map(v => (v - mean) ** 2));
  // Low variance → relationships not changing → stagnation
  return clamp(1 - Math.sqrt(variance) * 4, 0, 1);
}

/**
 * IGE — Initiative Gap Entropy.
 * All initiative from same source = high stagnation.
 */
function computeIGE(agentStates: Map<string, AgentState>): number {
  const sourceCounts = new Map<string, number>();
  for (const state of agentStates.values()) {
    for (const acc of state.initiativeAccumulators) {
      if (acc.value > acc.threshold) {
        sourceCounts.set(acc.source, (sourceCounts.get(acc.source) ?? 0) + 1);
      }
    }
  }

  if (sourceCounts.size === 0) return 0.7; // no initiative = likely stagnation

  const total = [...sourceCounts.values()].reduce((a, b) => a + b, 0);
  const maxShare = Math.max(...sourceCounts.values()) / total;
  // High max share = one source dominates = stagnation
  return clamp(maxShare, 0, 1);
}

/**
 * CUE — Channel Utilization Entropy.
 * All messages in one channel = stagnation.
 */
function computeCUE(events: CommittedEvent[]): number {
  const messageEvents = events.filter(e =>
    e.type === "message_sent" || e.type === "reply_sent",
  );
  if (messageEvents.length === 0) return 0.7;

  const channelCounts = new Map<string, number>();
  for (const e of messageEvents) {
    channelCounts.set(e.channelId, (channelCounts.get(e.channelId) ?? 0) + 1);
  }

  const total = messageEvents.length;
  const dominance = Math.max(...channelCounts.values()) / total;
  return clamp(dominance, 0, 1);
}

/**
 * ERI — Emotional Range Index.
 * All agents at similar valence/arousal = emotional flatness = stagnation.
 */
function computeERI(agentStates: Map<string, AgentState>): number {
  const states = [...agentStates.values()];
  if (states.length < 2) return 0.5;

  const valences = states.map(s => s.coreMood.valence);
  const arousals = states.map(s => s.coreMood.arousal);

  const vMean = meanOf(valences);
  const aMean = meanOf(arousals);
  const vVar = meanOf(valences.map(v => (v - vMean) ** 2));
  const aVar = meanOf(arousals.map(a => (a - aMean) ** 2));

  // Low variance = flat emotional landscape = stagnation
  const emoSpread = Math.sqrt(vVar + aVar);
  return clamp(1 - emoSpread * 3, 0, 1);
}

/**
 * ISD — Intent Success Diversity.
 * Few intent types succeeding = stagnation.
 */
function computeISD(events: CommittedEvent[]): number {
  const successTypes = new Set(
    events
      .filter(e => e.type === "message_sent" || e.type === "reply_sent" || e.type === "reaction_sent" || e.type === "channel_created")
      .map(e => e.type),
  );

  const maxTypes = 4; // we track 4 action types
  const diversity = successTypes.size / maxTypes;
  // Low diversity = stagnation
  return clamp(1 - diversity, 0, 1);
}

/**
 * CNS — Conversation Novelty Score.
 * MVP heuristic: ratio of actors who haven't spoken in last N events.
 * High = same few agents repeating = stagnation.
 */
function computeCNS(events: CommittedEvent[]): number {
  const WINDOW = 10;
  const recent = events.slice(-WINDOW);
  if (recent.length === 0) return 0.5;

  const actorCounts = new Map<string, number>();
  for (const e of recent) {
    actorCounts.set(e.actorId, (actorCounts.get(e.actorId) ?? 0) + 1);
  }

  const uniqueActors = actorCounts.size;
  const maxShare = uniqueActors > 0
    ? Math.max(...actorCounts.values()) / recent.length
    : 0;

  // High max share = same actor repeating = stagnation
  return clamp(maxShare, 0, 1);
}

/**
 * Detect attractor states from recent events.
 * Returns array of detected attractor state labels.
 */
export function detectAttractorStates(
  recentEvents: CommittedEvent[],
  agentStates: Map<string, AgentState>,
): string[] {
  const detected: string[] = [];
  const WINDOW = ATTRACTOR_DETECTION_WINDOW_PULSES;

  const windowEvents = recentEvents.slice(-WINDOW * 3); // rough pulse window

  // message_loop: >70% messages from only 2 agents
  const msgActors = windowEvents
    .filter(e => e.type === "message_sent" || e.type === "reply_sent")
    .map(e => e.actorId);
  if (msgActors.length > 0) {
    const actorCount = new Map<string, number>();
    for (const a of msgActors) actorCount.set(a, (actorCount.get(a) ?? 0) + 1);
    const top2 = [...actorCount.values()].sort((a, b) => b - a).slice(0, 2);
    const top2Share = top2.reduce((a, b) => a + b, 0) / msgActors.length;
    if (top2Share >= (ATTRACTOR_THRESHOLDS["message_loop"] as number)) {
      detected.push("message_loop");
    }
  }

  // silence_cascade: >60% decisions are no_op
  const noOps = windowEvents.filter(e => e.type === "no_op_recorded").length;
  const totalDecisions = noOps + msgActors.length;
  if (totalDecisions > 0 && noOps / totalDecisions >= (ATTRACTOR_THRESHOLDS["silence_cascade"] as number)) {
    detected.push("silence_cascade");
  }

  // dormant_agents: >50% agents idle
  const dormantCount = [...agentStates.values()].filter(
    s => s.presence === "offline" || s.presence === "busy_elsewhere",
  ).length;
  if (agentStates.size > 0 && dormantCount / agentStates.size >= (ATTRACTOR_THRESHOLDS["dormant_agents"] as number)) {
    detected.push("dormant_agents");
  }

  // private_channel_flood: >3 private channels active (from events)
  const privateCreations = windowEvents.filter(
    e => e.type === "channel_created" &&
         (e.payload["channelType"] as string | undefined) === "private_channel",
  ).length;
  if (privateCreations >= (ATTRACTOR_THRESHOLDS["private_channel_flood"] as number)) {
    detected.push("private_channel_flood");
  }

  // reaction_only: >65% responses are reactions
  const reactions = windowEvents.filter(e => e.type === "reaction_sent").length;
  const textMessages = msgActors.length;
  const totalResponses = reactions + textMessages;
  if (totalResponses > 0 && reactions / totalResponses >= (ATTRACTOR_THRESHOLDS["reaction_only"] as number)) {
    detected.push("reaction_only");
  }

  return detected;
}
