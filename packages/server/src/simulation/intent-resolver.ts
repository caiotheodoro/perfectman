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

/**
 * Engine clamp for engine-assigned `fallbackIfBlocked` (see
 * `composeIntentPacket`): only low-risk surfaces are reachable when the
 * primary action is denied. Side-effect-heavy types (create_channel,
 * invite_agent, write_memory) are excluded — a denied intent must not
 * become a route to structural changes. `delay_response` is excluded too:
 * `deriveFallbackIntent` never carries `preferredDelay` over (fallback
 * resolution is single-level, same pulse — a genuine delay defers to a
 * future pulse, which isn't a same-pulse resolution), so a delay_response
 * fallback would always resolve as an immediate no_op mislabeled as a
 * delay. Wiring a real delayed fallback needs the resolver to treat a
 * "delayed" secondary outcome as a distinct success case, which is out of
 * scope here.
 */
const FALLBACK_ALLOWED_TYPES: ReadonlySet<ActionIntent["intentType"]> = new Set([
  "no_op",
  "send_message",
  "reply_to_message",
  "react",
]);

/**
 * `blockReason` values that mean the anti-gaming rate limiter denied the
 * action — whether baked into `availableActions` up front by
 * `computeAvailableActions` (`message_rate_limit`) or surfaced later via
 * `RateLimitGate.getStatus()` (`messages_per_minute_exceeded`). Both trace
 * back to the same per-agent message counter; either must suppress
 * fallback the same way `RateLimitGate.allowAction()` does below.
 */
const RATE_LIMIT_BLOCK_REASONS: ReadonlySet<string> = new Set([
  "message_rate_limit",
  "messages_per_minute_exceeded",
]);

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

/**
 * Builds the derived fallback intent with per-type field selection: only the
 * fields the fallback type can actually use carry over — including
 * `channelTarget` for every channel-scoped type (send_message,
 * reply_to_message, react), so membership/visibility checks re-run against
 * the real target instead of silently re-homing to `ctx.channelId`. The
 * denied primary's `memoryWrites` are dropped — recording "I told Bruno X"
 * as memory after the message was refused would be false telemetry.
 * `fallbackIfBlocked` and `preferredDelay` never carry over (single level,
 * same pulse).
 */
function deriveFallbackIntent(
  primary: ActionIntent,
  fallbackType: NonNullable<ActionIntent["fallbackIfBlocked"]>,
): ActionIntent {
  const derived: ActionIntent = {
    id: createId(),
    actorId: primary.actorId,
    intentType: fallbackType,
    personTargets: primary.personTargets,
    privateMotiveSummary: primary.privateMotiveSummary,
    emotionDrivers: primary.emotionDrivers,
    motivationDrivers: primary.motivationDrivers,
    memoryWrites: [],
  };
  if (fallbackType === "send_message" || fallbackType === "reply_to_message") {
    derived.visibleContent = primary.visibleContent;
    derived.channelTarget = primary.channelTarget;
  }
  if (fallbackType === "reply_to_message") {
    derived.replyToEventId = primary.replyToEventId;
  }
  if (fallbackType === "react") {
    derived.channelTarget = primary.channelTarget;
    derived.targetEventId = primary.targetEventId;
    derived.emoji = primary.emoji;
  }
  return derived;
}

export class IntentResolver {
  constructor(
    private readonly rateLimitGate: RateLimitGate,
    private readonly channelRegistry: ChannelRegistry,
  ) {}

  /**
   * Resolves an intent, honoring an engine-assigned `fallbackIfBlocked`
   * (stamped by `composeIntentPacket`, never model-declared — see
   * `ENGINE_FALLBACK_ELIGIBLE_TYPES`) when the primary action is denied —
   * with engine clamps:
   *
   * - Single level, same pulse. The derived intent gets a fresh id and its
   *   own `fallbackIfBlocked` cleared, so chains are impossible.
   * - Allow-list clamp: only low-risk surfaces are reachable as fallbacks —
   *   no create_channel / invite_agent / write_memory via a denied intent.
   * - Rate-limit blocks suppress fallback entirely: a denied action must not
   *   become a route around the gate.
   * - The primary's `intent_blocked` event is retained in the committed
   *   events either way: on a successful fallback the outcome becomes
   *   "fallback_committed"; if the fallback is denied too, the outcome stays
   *   "blocked" but both the primary's and the fallback's block events are
   *   kept in `committedEvents` for the audit trail.
   */
  async resolve(
    intent: ActionIntent,
    ctx: ResolveContext,
  ): Promise<ResolvedIntent> {
    const primary = await this.resolveInternal(intent, ctx);
    if (primary.result.outcome !== "blocked") return primary.result;
    if (primary.rateLimited) return primary.result;

    const fallbackType = intent.fallbackIfBlocked;
    if (!fallbackType || !FALLBACK_ALLOWED_TYPES.has(fallbackType)) {
      return primary.result;
    }
    if (
      (fallbackType === "send_message" || fallbackType === "reply_to_message") &&
      !intent.visibleContent?.trim()
    ) {
      // A content-bearing fallback without content would only re-create the
      // empty-message defect — let the denial stand.
      return primary.result;
    }
    if (fallbackType === "reply_to_message" && !intent.replyToEventId) {
      // A reply with no target event is an orphan reference — denial stands.
      return primary.result;
    }
    if (fallbackType === "react" && !intent.targetEventId) {
      // Same orphan-reference rule for reactions.
      return primary.result;
    }

    const derived = deriveFallbackIntent(intent, fallbackType);
    const secondary = await this.resolveInternal(derived, ctx);
    if (secondary.result.outcome !== "committed") {
      // Same retention rule as the successful-fallback path below: every
      // attempt's events stay in the audit trail, even when both the
      // primary and the fallback end up denied.
      return {
        ...primary.result,
        committedEvents: [...primary.result.committedEvents, ...secondary.result.committedEvents],
      };
    }

    return {
      ...secondary.result,
      outcome: "fallback_committed",
      committedEvents: [...primary.result.committedEvents, ...secondary.result.committedEvents],
    };
  }

  private async resolveInternal(
    intent: ActionIntent,
    ctx: ResolveContext,
  ): Promise<{ result: ResolvedIntent; rateLimited: boolean }> {
    const validation = validateIntentPure(
      intent,
      ctx.availableActions,
      ctx.agentState,
      ctx.settings,
    );

    if (!validation.valid) {
      const blockEvent = buildBlockEvent(intent, validation.violations, ctx);
      // The anti-gaming rate limit is baked into `availableActions` before
      // the LLM call (see `computeAvailableActions`), so a rate-limited
      // primary is denied here — not at the `RateLimitGate.allowAction()`
      // check further down, which a rate-limited intent never reaches.
      const rateLimited = validation.violations.some(
        v => v.type === "rate_limited" && v.detail !== undefined && RATE_LIMIT_BLOCK_REASONS.has(v.detail),
      );
      return {
        result: { outcome: "blocked", committedEvents: [blockEvent], operatorEvents: [] },
        rateLimited,
      };
    }

    if (intent.channelTarget) {
      const isMember = await this.channelRegistry.isMember(intent.actorId, intent.channelTarget);
      if (!isMember && intent.intentType !== "create_channel") {
        const blockEvent = buildBlockEvent(intent, [{ type: "not_member" }], ctx);
        return {
          result: { outcome: "blocked", committedEvents: [blockEvent], operatorEvents: [] },
          rateLimited: false,
        };
      }
    }

    if (!this.rateLimitGate.allowAction(intent.actorId, intent.intentType)) {
      const blockEvent = buildBlockEvent(intent, [{ type: "rate_limited" }], ctx);
      return {
        result: { outcome: "blocked", committedEvents: [blockEvent], operatorEvents: [] },
        rateLimited: true,
      };
    }

    if (intent.preferredDelay && intent.preferredDelay > 0) {
      if (!Number.isFinite(ctx.settings.pulseIntervalMs) || ctx.settings.pulseIntervalMs <= 0) {
        const blockEvent = buildBlockEvent(intent, [{ type: "invalid_delay", detail: "pulseIntervalMs must be greater than 0" }], ctx);
        return {
          result: { outcome: "blocked", committedEvents: [blockEvent], operatorEvents: [] },
          rateLimited: false,
        };
      }
      const delayPulses = Math.min(
        10_000,
        Math.ceil(intent.preferredDelay / ctx.settings.pulseIntervalMs),
      );
      const delayUntilPulse = ctx.pulseIndex + delayPulses;
      const delayEvent = buildDelayEvent(intent, delayUntilPulse, ctx);
      return {
        result: {
          outcome: "delayed",
          committedEvents: [delayEvent],
          operatorEvents: [],
          delayUntilPulse,
        },
        rateLimited: false,
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
        type: intent.channelType ?? "private_channel",
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
      result: {
        outcome: "committed",
        committedEvents: [...primaryEvents, ...memoryEvents],
        operatorEvents: [],
      },
      rateLimited: false,
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
        intensity: proposal.intensity,
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
