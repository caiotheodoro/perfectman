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
  const payload: SimulationEvent["payload"] = {
    intentType: intent.intentType,
    intentId: intent.id,
    delayUntilPulse,
  };
  if (intent.preferredDelay !== undefined) {
    payload["preferredDelay"] = intent.preferredDelay;
  }

  return {
    simulationId: ctx.simulationId,
    channelId: ctx.channelId,
    actorId: intent.actorId,
    type: "intent_delayed",
    payload,
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

/** Marks an event's visibility as private-channel (members-only) and tags
 *  the payload so the model and the evidence can tell. */
function channelVisibility(
  channelId: string,
  ctx: ResolveContext,
): { payload: Record<string, unknown>; visibility: SimulationEvent["visibility"] } {
  const channel = ctx.channels.find(ch => ch.id === channelId);
  const isPrivate = channel?.type === "private_channel";
  if (!isPrivate) {
    return {
      payload: {},
      visibility: {
        visibleToAgents: [],
        visibleToSpectators: true,
        visibleToOperators: true,
        visibilityReason: "public",
      },
    };
  }
  return {
    payload: { channelType: "private_channel" },
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: false,
      visibleToOperators: true,
      visibilityReason: "private_channel_members_only",
    },
  };
}

function buildMessageEvent(
  intent: ActionIntent,
  salience: EmotionalSalience,
  ctx: ResolveContext,
): SimulationEvent {
  const channelId = intent.channelTarget ?? ctx.channelId;
  const vis = channelVisibility(channelId, ctx);
  return {
    simulationId: ctx.simulationId,
    channelId,
    actorId: intent.actorId,
    type: "message_sent",
    payload: { content: intent.visibleContent ?? "", ...vis.payload },
    sourceIntentId: intent.id,
    sourceEventIds: [],
    emotionalSalience: salience,
    pulseIndex: ctx.pulseIndex,
    visibility: vis.visibility,
  };
}

function buildReplyEvent(
  intent: ActionIntent,
  salience: EmotionalSalience,
  ctx: ResolveContext,
): SimulationEvent {
  const channelId = intent.channelTarget ?? ctx.channelId;
  const replyToEventId = intent.replyToEventId;
  const vis = channelVisibility(channelId, ctx);
  return {
    simulationId: ctx.simulationId,
    channelId,
    actorId: intent.actorId,
    type: "reply_sent",
    payload: { content: intent.visibleContent ?? "", replyToEventId: replyToEventId ?? "", ...vis.payload },
    sourceIntentId: intent.id,
    sourceEventIds: replyToEventId ? [replyToEventId] : [],
    emotionalSalience: salience,
    pulseIndex: ctx.pulseIndex,
    visibility: vis.visibility,
  };
}

function buildReactionEvent(
  intent: ActionIntent,
  salience: EmotionalSalience,
  ctx: ResolveContext,
): SimulationEvent {
  const channelId = intent.channelTarget ?? ctx.channelId;
  const vis = channelVisibility(channelId, ctx);
  return {
    simulationId: ctx.simulationId,
    channelId,
    actorId: intent.actorId,
    type: "reaction_sent",
    payload: {
      emoji: intent.emoji ?? "👍",
      targetEventId: intent.targetEventId ?? "",
      ...vis.payload,
    },
    sourceIntentId: intent.id,
    sourceEventIds: intent.targetEventId ? [intent.targetEventId] : [],
    emotionalSalience: salience,
    pulseIndex: ctx.pulseIndex,
    visibility: vis.visibility,
  };
}

function buildChannelCreatedEvent(
  intent: ActionIntent,
  ctx: ResolveContext,
): SimulationEvent[] {
  const channelId = intent.channelTarget ?? createId();
  const invitedIds = (intent.invitedAgentIds ?? intent.personTargets) || [];
  const allMembers = [intent.actorId, ...invitedIds];

  const createEvent: SimulationEvent = {
    simulationId: ctx.simulationId,
    channelId,
    actorId: intent.actorId,
    type: "channel_created",
    payload: {
      channelName: intent.channelName ?? "private",
      channelType: intent.channelType ?? "private_channel",
      invitedAgentIds: invitedIds,
    },
    sourceIntentId: intent.id,
    sourceEventIds: [],
    emotionalSalience: "medium",
    pulseIndex: ctx.pulseIndex,
    visibility: {
      visibleToAgents: allMembers,
      visibleToSpectators: false,
      visibleToOperators: true,
      visibilityReason: "private_channel_members_only",
    },
  };

  // Emit an agent_invited event per invitee so their channel anchor shifts immediately.
  const inviteEvents: SimulationEvent[] = invitedIds.map((invitedAgentId) => ({
    simulationId: ctx.simulationId,
    channelId,
    actorId: intent.actorId,
    type: "agent_invited",
    payload: { invitedAgentId },
    sourceIntentId: intent.id,
    sourceEventIds: [],
    emotionalSalience: "medium",
    pulseIndex: ctx.pulseIndex,
    visibility: {
      visibleToAgents: allMembers,
      visibleToSpectators: false,
      visibleToOperators: true,
      visibilityReason: "invite_parties",
    },
  }));

  return [createEvent, ...inviteEvents];
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

    const primaryEvents = this.intentToEvents(intent, ctx);

    // create_channel intents must REGISTER the channel + memberships —
    // otherwise the creator (and invitees) can't message inside it, and
    // the event stays invisible to the very people it concerns.
    if (intent.intentType === "create_channel") {
      const memberSet = new Set([
        intent.actorId,
        ...(intent.invitedAgentIds ?? []),
        ...(intent.personTargets ?? []),
      ]);
      const channel = await this.channelRegistry.createChannel({
        simulationId: ctx.simulationId,
        type: "private_channel",
        name: intent.channelName ?? `pv-${intent.actorId}`,
        createdBy: intent.actorId,
        memberAgentIds: [...memberSet],
        spectatorVisible: false,
        createdForMotives: [intent.privateMotiveSummary.slice(0, 80)],
      });
      // Rewrite the committed event with the real registered channel id.
      for (const evt of primaryEvents) {
        if (evt.type === "channel_created") {
          evt.channelId = channel.id;
        }
      }
    } else if (intent.intentType === "invite_agent" && intent.channelTarget) {
      for (const invitee of intent.personTargets) {
        await this.channelRegistry.addMember(intent.channelTarget, invitee);
      }
    }

    // memoryWrites attached to ANY intent commit operator-only memory events.
    const memoryEvents =
      intent.intentType !== "write_memory" ? this.memoryProposalEvents(intent, ctx) : [];
    this.rateLimitGate.recordAction(intent.actorId, intent.intentType);

    return {
      outcome: "committed",
      committedEvents: [...primaryEvents, ...memoryEvents],
      operatorEvents: [],
    };
  }

  private memoryProposalEvents(intent: ActionIntent, ctx: ResolveContext): SimulationEvent[] {
    return (intent.memoryWrites ?? []).map((proposal, i) => ({
      simulationId: ctx.simulationId,
      channelId: ctx.channelId,
      actorId: intent.actorId,
      type: "memory_written" as const,
      payload: {
        memoryType: proposal.type,
        summary: proposal.summary,
        emotionalTone: proposal.emotionalTone,
        confidence: proposal.confidence,
        unresolved: proposal.unresolved,
        subjectAgentIds: proposal.subjectAgentIds,
        proposalIndex: i,
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
    }));
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
        return buildChannelCreatedEvent(intent, ctx);
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
      case "write_memory": {
        // A bare write_memory intent with no proposals is a no-op that never
        // happened — not an event. Proposals are committed by the caller's
        // memoryProposalEvents path.
        return [];
      }
    }
  }
}
