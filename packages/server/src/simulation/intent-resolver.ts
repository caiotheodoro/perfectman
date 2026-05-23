import type {
  ActionIntent,
  CommittedEvent,
  SimulationEvent,
  AgentState,
  Channel,
  ChannelMembership,
  SimulationSettings,
  AvailableAction,
  OperatorEvent,
  ResolvedIntentOutcome,
  EmotionalSalience,
  ActionEmotions,
  IntentViolation,
} from "@perfectman/shared";
import { createId } from "@perfectman/shared";
import { validateIntentPure } from "@perfectman/engine";
import type { RateLimitGate } from "./rate-limit-gate.js";
import type { ChannelRegistry } from "./channel-registry.js";

export type ResolvedIntent = {
  outcome: ResolvedIntentOutcome;
  committedEvents: SimulationEvent[];
  operatorEvents: OperatorEvent[];
  delayUntilPulse?: number;
};

type ResolveContext = {
  simulationId: string;
  channelId: string;
  pulseIndex: number;
  agentState: AgentState;
  availableActions: AvailableAction[];
  channels: Channel[];
  membership: ChannelMembership[];
  settings: SimulationSettings;
  actionEmotions: ActionEmotions;
};

function deriveSalience(intent: ActionIntent, actionEmotions: ActionEmotions): EmotionalSalience {
  if (intent.intentType === "create_channel") return "medium";
  if (intent.intentType === "no_op") return "low";

  const top = Math.max(
    actionEmotions.impulsiveProvocation,
    actionEmotions.dominanceAssertion,
    actionEmotions.defensiveness,
    actionEmotions.resentfulColdness,
    actionEmotions.anxiousOverreach,
  );
  if (top >= 0.8) return "critical";
  if (top >= 0.6) return "high";
  if (top >= 0.35) return "medium";
  return "low";
}

function buildBlockEvent(
  intent: ActionIntent,
  violations: IntentViolation[],
  ctx: ResolveContext,
): SimulationEvent {
  return {
    simulationId: ctx.simulationId,
    channelId: ctx.channelId,
    actorId: intent.actorId,
    type: "intent_blocked",
    payload: {
      intentType: intent.intentType,
      violations,
      intentId: intent.id,
    },
    sourceEventIds: [],
    emotionalSalience: "low",
    pulseIndex: ctx.pulseIndex,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: false,
      visibleToOperators: true,
      visibilityReason: "operator_only",
    },
  };
}

function buildDelayEvent(
  intent: ActionIntent,
  delayUntilPulse: number,
  ctx: ResolveContext,
): SimulationEvent {
  return {
    simulationId: ctx.simulationId,
    channelId: ctx.channelId,
    actorId: intent.actorId,
    type: "intent_delayed",
    payload: {
      intentType: intent.intentType,
      intentId: intent.id,
      delayUntilPulse,
      preferredDelay: intent.preferredDelay,
    },
    sourceEventIds: [],
    emotionalSalience: "low",
    pulseIndex: ctx.pulseIndex,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "spectator_hint",
    },
  };
}

function buildMessageEvent(
  intent: ActionIntent,
  salience: EmotionalSalience,
  ctx: ResolveContext,
): SimulationEvent {
  const channelId = intent.channelTarget ?? ctx.channelId;
  return {
    simulationId: ctx.simulationId,
    channelId,
    actorId: intent.actorId,
    type: "message_sent",
    payload: { content: intent.visibleContent ?? "" },
    sourceIntentId: intent.id,
    sourceEventIds: [],
    emotionalSalience: salience,
    pulseIndex: ctx.pulseIndex,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public",
    },
  };
}

function buildReplyEvent(
  intent: ActionIntent,
  salience: EmotionalSalience,
  ctx: ResolveContext,
): SimulationEvent {
  const channelId = intent.channelTarget ?? ctx.channelId;
  const replyToEventId = (intent as ActionIntent & { replyToEventId?: string }).replyToEventId;
  return {
    simulationId: ctx.simulationId,
    channelId,
    actorId: intent.actorId,
    type: "reply_sent",
    payload: { content: intent.visibleContent ?? "", replyToEventId: replyToEventId ?? "" },
    sourceIntentId: intent.id,
    sourceEventIds: replyToEventId ? [replyToEventId] : [],
    emotionalSalience: salience,
    pulseIndex: ctx.pulseIndex,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public",
    },
  };
}

function buildReactionEvent(
  intent: ActionIntent,
  salience: EmotionalSalience,
  ctx: ResolveContext,
): SimulationEvent {
  const channelId = intent.channelTarget ?? ctx.channelId;
  const extIntent = intent as ActionIntent & { emoji?: string; targetEventId?: string };
  return {
    simulationId: ctx.simulationId,
    channelId,
    actorId: intent.actorId,
    type: "reaction_sent",
    payload: {
      emoji: extIntent.emoji ?? "👍",
      targetEventId: extIntent.targetEventId ?? "",
    },
    sourceIntentId: intent.id,
    sourceEventIds: extIntent.targetEventId ? [extIntent.targetEventId] : [],
    emotionalSalience: salience,
    pulseIndex: ctx.pulseIndex,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public",
    },
  };
}

function buildChannelCreatedEvent(
  intent: ActionIntent,
  ctx: ResolveContext,
): SimulationEvent {
  const extIntent = intent as ActionIntent & { channelName?: string; channelType?: string; invitedAgentIds?: string[] };
  return {
    simulationId: ctx.simulationId,
    channelId: intent.channelTarget ?? createId(),
    actorId: intent.actorId,
    type: "channel_created",
    payload: {
      channelName: extIntent.channelName ?? "private",
      channelType: extIntent.channelType ?? "private_channel",
      invitedAgentIds: extIntent.invitedAgentIds ?? intent.personTargets,
    },
    sourceIntentId: intent.id,
    sourceEventIds: [],
    emotionalSalience: "medium",
    pulseIndex: ctx.pulseIndex,
    visibility: {
      visibleToAgents: [intent.actorId, ...intent.personTargets],
      visibleToSpectators: false,
      visibleToOperators: true,
      visibilityReason: "private_channel_members_only",
    },
  };
}

function buildNoOpEvent(
  intent: ActionIntent,
  ctx: ResolveContext,
): SimulationEvent {
  return {
    simulationId: ctx.simulationId,
    channelId: ctx.channelId,
    actorId: intent.actorId,
    type: "no_op_recorded",
    payload: {
      intentType: intent.intentType,
      privateMotiveSummary: intent.privateMotiveSummary,
    },
    sourceIntentId: intent.id,
    sourceEventIds: [],
    emotionalSalience: "low",
    pulseIndex: ctx.pulseIndex,
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: false,
      visibleToOperators: true,
      visibilityReason: "operator_only",
    },
  };
}

export class IntentResolver {
  constructor(
    private readonly rateLimitGate: RateLimitGate,
    private readonly channelRegistry: ChannelRegistry,
  ) {}

  async resolve(
    intent: ActionIntent,
    ctx: ResolveContext,
  ): Promise<ResolvedIntent> {
    const validation = validateIntentPure(
      intent,
      ctx.availableActions,
      ctx.agentState,
      ctx.settings,
    );

    if (!validation.valid) {
      const blockEvent = buildBlockEvent(intent, validation.violations, ctx);
      return {
        outcome: "blocked",
        committedEvents: [blockEvent],
        operatorEvents: [],
      };
    }

    if (intent.channelTarget) {
      const isMember = await this.channelRegistry.isMember(intent.actorId, intent.channelTarget);
      if (!isMember && intent.intentType !== "create_channel") {
        const blockEvent = buildBlockEvent(intent, [{ type: "not_member" }], ctx);
        return { outcome: "blocked", committedEvents: [blockEvent], operatorEvents: [] };
      }
    }

    if (!this.rateLimitGate.allowAction(intent.actorId, intent.intentType)) {
      const blockEvent = buildBlockEvent(intent, [{ type: "rate_limited" }], ctx);
      return { outcome: "blocked", committedEvents: [blockEvent], operatorEvents: [] };
    }

    if (intent.preferredDelay && intent.preferredDelay > 0) {
      if (!Number.isFinite(ctx.settings.pulseIntervalMs) || ctx.settings.pulseIntervalMs <= 0) {
        const blockEvent = buildBlockEvent(intent, [{ type: "invalid_delay", detail: "pulseIntervalMs must be greater than 0" }], ctx);
        return { outcome: "blocked", committedEvents: [blockEvent], operatorEvents: [] };
      }
      const delayPulses = Math.min(
        10_000,
        Math.ceil(intent.preferredDelay / ctx.settings.pulseIntervalMs),
      );
      const delayUntilPulse = ctx.pulseIndex + delayPulses;
      const delayEvent = buildDelayEvent(intent, delayUntilPulse, ctx);
      return {
        outcome: "delayed",
        committedEvents: [delayEvent],
        operatorEvents: [],
        delayUntilPulse,
      };
    }

    const events = this.intentToEvents(intent, ctx);
    this.rateLimitGate.recordAction(intent.actorId, intent.intentType);

    return { outcome: "committed", committedEvents: events, operatorEvents: [] };
  }

  private intentToEvents(intent: ActionIntent, ctx: ResolveContext): SimulationEvent[] {
    const salience = deriveSalience(intent, ctx.actionEmotions);

    switch (intent.intentType) {
      case "send_message":
        return [buildMessageEvent(intent, salience, ctx)];
      case "reply_to_message":
        return [buildReplyEvent(intent, salience, ctx)];
      case "react":
        return [buildReactionEvent(intent, salience, ctx)];
      case "create_channel":
        return [buildChannelCreatedEvent(intent, ctx)];
      case "no_op":
      case "delay_response":
        return [buildNoOpEvent(intent, ctx)];
      case "invite_agent":
        return [{
          simulationId: ctx.simulationId,
          channelId: intent.channelTarget ?? ctx.channelId,
          actorId: intent.actorId,
          type: "agent_invited",
          payload: { invitedAgentId: intent.personTargets[0] ?? "" },
          sourceIntentId: intent.id,
          sourceEventIds: [],
          emotionalSalience: "low",
          pulseIndex: ctx.pulseIndex,
          visibility: {
            visibleToAgents: [intent.actorId, ...(intent.personTargets ?? [])],
            visibleToSpectators: false,
            visibleToOperators: true,
            visibilityReason: "invite_parties",
          },
        }];
      case "leave_channel":
        return [{
          simulationId: ctx.simulationId,
          channelId: intent.channelTarget ?? ctx.channelId,
          actorId: intent.actorId,
          type: "agent_left",
          payload: {},
          sourceIntentId: intent.id,
          sourceEventIds: [],
          emotionalSalience: "low",
          pulseIndex: ctx.pulseIndex,
          visibility: {
            visibleToAgents: [],
            visibleToSpectators: true,
            visibleToOperators: true,
            visibilityReason: "public",
          },
        }];
      case "typing_start":
        return [{
          simulationId: ctx.simulationId,
          channelId: intent.channelTarget ?? ctx.channelId,
          actorId: intent.actorId,
          type: "typing_started",
          payload: {},
          sourceIntentId: intent.id,
          sourceEventIds: [],
          emotionalSalience: "low",
          pulseIndex: ctx.pulseIndex,
          visibility: {
            visibleToAgents: [],
            visibleToSpectators: true,
            visibleToOperators: true,
            visibilityReason: "public",
          },
        }];
      case "typing_cancel":
        return [{
          simulationId: ctx.simulationId,
          channelId: intent.channelTarget ?? ctx.channelId,
          actorId: intent.actorId,
          type: "typing_cancelled",
          payload: {},
          sourceIntentId: intent.id,
          sourceEventIds: [],
          emotionalSalience: "low",
          pulseIndex: ctx.pulseIndex,
          visibility: {
            visibleToAgents: [],
            visibleToSpectators: true,
            visibleToOperators: true,
            visibilityReason: "public",
          },
        }];
      case "write_memory":
        return [];
    }
  }
}
