import type {
  ActionIntent,
  CommittedEvent,
  SimulationEvent,
  EventPayload,
  AgentState,
  Channel,
  ChannelMembership,
  SimulationSettings,
  AvailableAction,
  OperatorEvent,
  ResolvedIntentOutcome,
  EmotionalSalience,
  ActionEmotions,
  MemoryWriteProposal,
  IntentViolation,
  PrivateMotiveSummaryPayload,
  SpaceView,
  BodyHandleMap,
  BodyHandleTarget,
  BodyIntent,
  BlockedReason,
  SpeechMode,
  HearingLevel,
} from "@perfectman/shared";
import { createId, MEMORY_TONE_UNSPECIFIED } from "@perfectman/shared";
import { SAY_CLEAR_TILES, validateIntentPure, validateBodyIntent, speechNeedsDeferral } from "@perfectman/engine";
import { memoryWrittenPayload } from "./memory-written-payload.js";
import { REPETITION_GUARD_MARKER } from "../agent/repetition-guard.js";
import { isEngineAuthoredMotive } from "../agent/engine-motive.js";
import type { RateLimitGate } from "./rate-limit-gate.js";
import type { ChannelRegistry } from "./channel-registry.js";
import type { ArbiterLineKind, IRoomSpeechArbiter } from "./hotel-runtime-api.js";
import { roomIdOfChannel } from "./room-speech-arbiter.js";
import { answerWhisper, whisperer } from "./whisper-reply.js";

export type ResolvedBody = {
  /** The validated block; handles as the model wrote them (docs/embodiment.md 6.2). */
  accepted: BodyIntent;
  /** Handle -> target for every handle in `accepted`, so the host can act without re-reading the render. */
  targets: Record<string, BodyHandleTarget>;
  blocked: BlockedReason[];
  /** Set when the speech half was held back until the speaker reaches its addressee (move_then_speak). */
  deferral?: { targetRef: string; etaMs: number; expiresAt: number };
};

export type ResolvedIntent = {
  outcome: ResolvedIntentOutcome;
  committedEvents: SimulationEvent[];
  operatorEvents: OperatorEvent[];
  delayUntilPulse?: number;
  /** Hotel mode only: what became of the intent's `body` block. */
  body?: ResolvedBody;
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
  /** agentId → display name; powers mention parsing over visibleContent. */
  agentNames?: Record<string, string>;
  /** ADR-0017: the engine consulted the model on a hold this pulse; stamped on the motive event so evidence can count consults. */
  holdSuggested?: boolean;
  /** Hotel only (ADR-0018): this agent's view of the space when it decided, for validating the intent's `body`. */
  space?: SpaceView;
  /** Hotel only: the handles minted for that render, to resolve the model's `body` references. */
  bodyHandles?: BodyHandleMap;
  /** Hotel only: reasons the parser dropped the `body` block (ADR-0019). */
  bodyDropped?: BlockedReason[];
  /** The event this decision answers. A whisper to the agent makes its spoken reply a whisper back (D44). */
  trigger?: CommittedEvent;
  /** Hotel: wall clock when the agent's view was taken. A human line that came in after it is not answered by this decision. */
  decidedAt?: number;
};

const MENTION_BOUNDARY = "[^\\p{L}\\p{N}]";
const MIN_MENTION_NAME_LENGTH = 2;

/**
 * Exact, case-insensitive display-name mentions over visible content:
 * persona name "Bruno" matches both "Bruno" and "@bruno", but not
 * "BrunoBytes". Names absent from agentNames never match.
 *
 * A name is skipped when it is shorter than {@link MIN_MENTION_NAME_LENGTH}
 * or when two or more agents share it (case-insensitively) — an ambiguous
 * mention cannot be attributed to one agent, and a wrong attribution feeds
 * relational deltas to the wrong pair.
 */
export function parseMentionedAgentIds(
  visibleContent: string | undefined,
  agentNames: Record<string, string> | undefined,
): string[] {
  if (!visibleContent || !agentNames) return [];
  // Diacritic-insensitive on both sides: "@iris" must find "Íris".
  const nameCounts = new Map<string, number>();
  for (const displayName of Object.values(agentNames)) {
    const key = fold(displayName.trim());
    if (key) nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const foldedContent = fold(visibleContent);
  const mentioned: string[] = [];
  for (const [agentId, displayName] of Object.entries(agentNames)) {
    const name = fold(displayName.trim());
    if (name.length < MIN_MENTION_NAME_LENGTH) continue;
    if ((nameCounts.get(name) ?? 0) > 1) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `(^|${MENTION_BOUNDARY})${escaped}($|${MENTION_BOUNDARY})`,
      "iu",
    );
    if (pattern.test(foldedContent)) mentioned.push(agentId);
  }
  return mentioned;
}

/** Diacritic- and case-insensitive key for name matching ("@iris" finds "Íris"). */
function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Resolve a short proposal's `about` entries (ids or display names as the
 * model saw them) to agent ids; unknown names are dropped rather than
 * stored as a subject nobody has.
 */
function resolveSubjectAgentIds(subjects: readonly string[], agentNames: Record<string, string> | undefined): string[] {
  if (!agentNames) return [...subjects];
  const byName = new Map<string, string>();
  for (const [agentId, displayName] of Object.entries(agentNames)) byName.set(fold(displayName.trim()), agentId);
  const out: string[] = [];
  for (const raw of subjects) {
    const key = raw.trim().replace(/^@/, "");
    const id = agentNames[key] !== undefined ? key : byName.get(fold(key));
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The action emotion the agent feels most, with its magnitude — a short proposal's tone. */
function dominantActionEmotion(actionEmotions: ActionEmotions): { tone: string; magnitude: number } {
  let tone = "neutral";
  let magnitude = 0;
  for (const [key, value] of Object.entries(actionEmotions)) {
    if (typeof value === "number" && value > magnitude) { tone = key; magnitude = value; }
  }
  return magnitude >= 0.2 ? { tone, magnitude } : { tone: "neutral", magnitude };
}

/** Stamps the participant identifiers relational accretion reads off payloads. */
function stampParticipantIds(payload: EventPayload, intent: ActionIntent, ctx: ResolveContext): void {
  if (intent.personTargets.length > 0) payload["personTargets"] = intent.personTargets;
  const mentionedAgentIds = parseMentionedAgentIds(intent.visibleContent, ctx.agentNames);
  if (mentionedAgentIds.length > 0) payload["mentionedAgentIds"] = mentionedAgentIds;
  const addresseeIds = deriveAddresseeIds(intent, mentionedAgentIds, ctx.agentNames);
  if (addresseeIds.length > 0) payload["addresseeIds"] = addresseeIds;
}

/**
 * Who a message is aimed at, in order of how deliberate the signal is: the
 * author of the message it replies to, the people the intent names as its
 * targets, then anyone mentioned in the text. Never the author, and only
 * agents the run knows about.
 */
function deriveAddresseeIds(
  intent: ActionIntent,
  mentionedAgentIds: readonly string[],
  agentNames: Record<string, string> | undefined,
): string[] {
  const known = agentNames ? new Set(Object.keys(agentNames)) : null;
  const ordered = [intent.replyToActorId, ...intent.personTargets, ...mentionedAgentIds];
  const out: string[] = [];
  for (const id of ordered) {
    if (!id || id === intent.actorId || out.includes(id)) continue;
    if (known && !known.has(id)) continue;
    out.push(id);
  }
  return out;
}

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
  const channelId = intent.channelTarget || ctx.channelId;
  const vis = channelVisibility(channelId, ctx);
  const payload: EventPayload = { content: intent.visibleContent ?? "", ...vis.payload };
  stampParticipantIds(payload, intent, ctx);
  return {
    simulationId: ctx.simulationId,
    channelId,
    actorId: intent.actorId,
    type: "message_sent",
    payload,
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
  const channelId = intent.channelTarget || ctx.channelId;
  const replyToEventId = intent.replyToEventId;
  const vis = channelVisibility(channelId, ctx);
  const payload: EventPayload = {
    content: intent.visibleContent ?? "",
    replyToEventId: replyToEventId ?? "",
    ...vis.payload,
  };
  stampParticipantIds(payload, intent, ctx);
  if (intent.replyToActorId) payload["replyToActorId"] = intent.replyToActorId;
  return {
    simulationId: ctx.simulationId,
    channelId,
    actorId: intent.actorId,
    type: "reply_sent",
    payload,
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
  const channelId = intent.channelTarget || ctx.channelId;
  const vis = channelVisibility(channelId, ctx);
  const payload: EventPayload = {
    emoji: intent.emoji ?? "👍",
    targetEventId: intent.targetEventId ?? "",
    ...vis.payload,
  };
  stampParticipantIds(payload, intent, ctx);
  return {
    simulationId: ctx.simulationId,
    channelId,
    actorId: intent.actorId,
    type: "reaction_sent",
    payload,
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

/**
 * A no_op that exists only because the repetition guard blocked a degenerate
 * message is not the same fact as an agent choosing to stay quiet, and the two
 * must not share an event type — see the `repetition_blocked` note in
 * event.types.ts. The guard marks its own fallback motive with a documented
 * prefix (repetition-guard.ts), which is the signal this reads.
 */
function isRepetitionBlockedIntent(intent: ActionIntent): boolean {
  return (
    intent.intentType === "no_op" &&
    typeof intent.privateMotiveSummary === "string" &&
    intent.privateMotiveSummary.startsWith(REPETITION_GUARD_MARKER)
  );
}

function buildNoOpEvent(
  intent: ActionIntent,
  ctx: ResolveContext,
): SimulationEvent {
  return {
    simulationId: ctx.simulationId,
    channelId: ctx.channelId,
    actorId: intent.actorId,
    type: isRepetitionBlockedIntent(intent) ? "repetition_blocked" : "no_op_recorded",
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
    derived.replyToActorId = primary.replyToActorId;
  }
  if (fallbackType === "react") {
    derived.channelTarget = primary.channelTarget;
    derived.targetEventId = primary.targetEventId;
    derived.emoji = primary.emoji;
  }
  return derived;
}

/** The `BodyCommand` names an accepted block turns into, in dispatch order. */
export function bodyCommandNames(body: Pick<ResolvedBody, "accepted" | "targets">): string[] {
  const { accepted, targets } = body;
  const names: string[] = [];
  const move = accepted.move;
  if (move && move.kind !== "stay") {
    const roomTarget = move.kind === "leave" && move.to ? targets[move.to]?.kind === "room" : false;
    names.push(roomTarget ? "move_room" : "walk");
  }
  if (accepted.posture) names.push(accepted.posture.pose === "sit" ? "sit" : accepted.posture.pose === "lay" ? "lay" : "stand");
  if (accepted.face) names.push("face");
  if (accepted.gesture) names.push("gesture");
  if (accepted.expression) names.push("expression");
  return names;
}

/** Who hears an actor line, and how well (docs/embodiment.md 5.2). Empty `visibleToAgents` is stored as `operator_only`. */
export type AudibilityResult = {
  visibleToAgents: string[];
  hearing: Record<string, HearingLevel>;
};

/**
 * The arbiter as the resolver uses it: the frozen gate plus the optional
 * `classify` that says whether a line is an addressed reply, an interjection
 * into a human line or ambient talk. Without `classify` every line is ambient.
 */
export type ResolverArbiter = IRoomSpeechArbiter & {
  classify?(agentId: string, roomId: string, now: number, answering?: string, decidedAt?: number): ArbiterLineKind;
};

export class IntentResolver {
  constructor(
    private readonly rateLimitGate: RateLimitGate,
    private readonly channelRegistry: ChannelRegistry,
    /** Hotel only (ADR-0021). Absent: no arbitration, byte-identical to before. */
    private readonly arbiter?: ResolverArbiter,
    /** Wall clock for the arbiter; injectable for tests. */
    private readonly clock: () => number = Date.now,
    /** Hotel mode switches (ADR-0022, 0023). Absent: events are stamped exactly as before. */
    private readonly hotel?: {
      /** Per-listener audibility of an actor line (ADR-0022 decision 2). Speech is also stamped with `senderName`, so the prompt names speakers without ever showing an id. */
      audibility?: (speakerId: string, channelId: string, mode: SpeechMode, whisperTo?: string) => AudibilityResult | undefined;
      /** The mode the line is delivered in (shout is the planner's choice); stamped with the hearing so the two agree. */
      chooseMode?: (speakerId: string, content: string, committed: SpeechMode) => SpeechMode;
      /** Pure: would the planner deliver this `say` line as a shout (arousal rule)? A shout carries across the room, so nobody walks first. */
      wouldShout?: (speakerId: string, content: string) => boolean;
    },
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
    given: ActionIntent,
    ctx: ResolveContext,
  ): Promise<ResolvedIntent> {
    // An answer to a whisper is for the whisperer alone: naming a third person in it would only walk the speaker over to them.
    const intent = this.hotel ? answerWhisper(given, ctx.trigger) : given;
    const body = this.assessBody(intent, ctx);
    const resolved =
      body?.deferral !== undefined
        ? this.deferSpeech(intent, ctx, body.deferral)
        : await this.resolveWithFallback(intent, ctx);
    // A body block rides on a real act; an invalid intent moves nobody.
    const bodyEvents = body && resolved.outcome !== "blocked" ? this.bodyEvents(intent, ctx, body) : [];
    // Every resolved intent — committed, fallback-committed, blocked or
    // delayed — leaves its private motive in the log as its own operator-only
    // event, ordered after the events it explains. The thought was real
    // whatever happened to the act; a blocked or delayed motive is exactly
    // the kind of private/public mismatch the spectator layer is for.
    return {
      ...resolved,
      committedEvents: [...resolved.committedEvents, ...bodyEvents, this.privateMotiveEvent(intent, ctx)],
      ...(body ? { body } : {}),
    };
  }

  /**
   * Hotel only: validate the `body` block against this agent's space view and
   * decide whether the line must wait for the speaker to arrive. Pure; the
   * events are built in `bodyEvents` once the speech half has resolved.
   */
  private assessBody(intent: ActionIntent, ctx: ResolveContext): ResolvedBody | undefined {
    if (!ctx.space) return undefined;
    const dropped = ctx.bodyDropped ?? [];
    const speaks = intent.intentType === "send_message" || intent.intentType === "reply_to_message";
    // An addressed `say` line to someone beyond the say radius is walked to, never sent across the room (embodiment.md 6.3).
    const far = speaks ? this.farAddressee(intent, ctx) : undefined;
    if (!intent.body && dropped.length === 0 && !far) return undefined;
    if (!intent.body || !ctx.bodyHandles) {
      const resolved: ResolvedBody = { accepted: { order: "move_then_speak" }, targets: {}, blocked: [...dropped] };
      if (far) {
        this.walkToAddressee(resolved, far.ref, ctx.bodyHandles ?? {});
        this.deferToArrival(intent, ctx, resolved, far.ref, this.clock());
      }
      return resolved;
    }
    const now = this.clock();
    const validation = validateBodyIntent(ctx.space, intent.actorId, intent.body, now, ctx.bodyHandles);
    const resolved: ResolvedBody = {
      accepted: validation.accepted,
      targets: validation.targets,
      blocked: [...dropped, ...validation.blocked],
    };
    if (speaks) {
      const addressee = intent.personTargets.find((id) => ctx.space?.room?.occupants.some((o) => o.ref === id));
      // No walk toward the addressee, or the model asked to talk first: make it a walk-then-talk.
      if (far && (resolved.accepted.move === undefined || resolved.accepted.order === "speak_then_move")) {
        this.walkToAddressee(resolved, far.ref, ctx.bodyHandles);
      }
      this.deferToArrival(intent, ctx, resolved, far?.ref ?? addressee, now);
    }
    return resolved;
  }

  /** Holds the line until the speaker reaches `addresseeRef`, when the accepted body walks toward them from beyond the say radius. */
  private deferToArrival(intent: ActionIntent, ctx: ResolveContext, resolved: ResolvedBody, addresseeRef: string | undefined, now: number): void {
    if (!ctx.space) return;
    const deferral = speechNeedsDeferral(ctx.space, intent.actorId, resolved.accepted, { ...(ctx.bodyHandles ?? {}), ...resolved.targets }, {
      now,
      speechChars: intent.visibleContent?.length ?? 0,
      ...(addresseeRef ? { addresseeRef } : {}),
    });
    if (deferral) resolved.deferral = { targetRef: deferral.targetRef, etaMs: deferral.etaMs, expiresAt: deferral.expiresAt };
  }

  /** The room occupant this line is for, when they stand beyond the say radius and the line would go out as a plain `say`. */
  private farAddressee(intent: ActionIntent, ctx: ResolveContext): { ref: string; distance: number } | undefined {
    const room = ctx.space?.room;
    const self = ctx.space?.self ?? room?.occupants.find((o) => o.ref === intent.actorId);
    if (!room || !self) return undefined;
    // The same order the event's `addresseeIds` use: who it replies to, who it names, then whoever the words call by name.
    const candidates = deriveAddresseeIds(intent, parseMentionedAgentIds(intent.visibleContent, ctx.agentNames), ctx.agentNames);
    const to = candidates.find((id) => room.occupants.some((o) => o.ref === id));
    const other = to ? room.occupants.find((o) => o.ref === to) : undefined;
    if (!to || !other) return undefined;
    const distance = Math.max(Math.abs(self.tile[0] - other.tile[0]), Math.abs(self.tile[1] - other.tile[1]));
    if (distance <= SAY_CLEAR_TILES) return undefined;
    // The arousal rule may shout it: that carries, so no walk.
    if (this.hotel?.wouldShout?.(intent.actorId, intent.visibleContent ?? "")) return undefined;
    return { ref: to, distance };
  }

  /** Fills `resolved` with an approach toward `ref` (an existing handle for them, else a minted one) and move_then_speak. */
  private walkToAddressee(
    resolved: ResolvedBody,
    ref: string,
    handles: Record<string, BodyHandleTarget>,
  ): void {
    const all = { ...handles, ...resolved.targets };
    let handle = Object.entries(all).find(([, t]) => t.kind === "person" && t.ref === ref)?.[0];
    if (!handle) {
      let n = 1;
      while (all[`p${n}`]) n++;
      handle = `p${n}`;
    }
    resolved.targets = { ...resolved.targets, [handle]: { kind: "person", ref } };
    resolved.accepted = { ...resolved.accepted, move: { kind: "approach", target: handle, band: "personal" }, order: "move_then_speak" };
  }

  /** The line is held outside the log until `body_arrived`; the simulation records only that it was deferred. */
  private deferSpeech(
    intent: ActionIntent,
    ctx: ResolveContext,
    deferral: NonNullable<ResolvedBody["deferral"]>,
  ): ResolvedIntent {
    return {
      outcome: "delayed",
      committedEvents: [
        this.bodyEvent(intent, ctx, "speech_deferred", {
          intentId: intent.id,
          targetRef: deferral.targetRef,
          expiresAt: deferral.expiresAt,
          etaMs: deferral.etaMs,
        }),
      ],
      operatorEvents: [],
    };
  }

  private bodyEvents(intent: ActionIntent, ctx: ResolveContext, body: ResolvedBody): SimulationEvent[] {
    const events: SimulationEvent[] = [];
    if (body.blocked.length > 0) {
      events.push(this.bodyEvent(intent, ctx, "body_blocked", { intentId: intent.id, reasons: body.blocked }));
    }
    const commands = bodyCommandNames(body);
    if (commands.length > 0) {
      events.push(this.bodyEvent(intent, ctx, "body_action_committed", { intentId: intent.id, commands }));
    }
    return events;
  }

  /** Body events are for the operator and the host; the room sees the body move, not an event about it. */
  private bodyEvent(
    intent: ActionIntent,
    ctx: ResolveContext,
    type: "body_action_committed" | "body_blocked" | "speech_deferred",
    payload: Record<string, unknown>,
  ): SimulationEvent {
    return {
      simulationId: ctx.simulationId,
      channelId: ctx.channelId,
      actorId: intent.actorId,
      type,
      payload: payload as EventPayload,
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

  private async resolveWithFallback(
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

    // Room speech arbiter (ADR-0021): after the rate gate and the delay branch,
    // before anything is recorded, so a denied line spends no rate counter.
    // `policy_blocked` (never rate_limited) lets `resolveWithFallback` commit
    // the engine-stamped `no_op` fallback: the simulation records a silence.
    const arbitration = this.arbitrate(intent, ctx);
    if (arbitration) {
      const blockEvent = buildBlockEvent(intent, [arbitration], ctx);
      return {
        result: { outcome: "blocked", committedEvents: [blockEvent], operatorEvents: [] },
        rateLimited: false,
      };
    }

    const primaryEvents = this.intentToEvents(intent, ctx);
    if (this.hotel) this.stampSpeech(primaryEvents, intent, ctx);

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
      // Rewrite every event of this intent with the real registered channel
      // id — the creation and each invite. Rewriting only the creation left
      // the invites on the id minted before registration, and the anchor
      // update that follows an invite then parked both parties in a channel
      // that did not exist: their next lines committed there, unmarked as
      // private, with no members, and the stage drew a lone figure "somewhere".
      for (const evt of primaryEvents) {
        if (evt.type === "channel_created" || evt.type === "agent_invited") {
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

  /**
   * Hotel only: name the speaker and say who hears the line. A line nobody
   * hears gets the `operator_only` shape, because an empty `visibleToAgents`
   * would otherwise mean everyone (ADR-0022).
   */
  private stampSpeech(events: SimulationEvent[], intent: ActionIntent, ctx: ResolveContext): void {
    for (const event of events) {
      if (event.type !== "message_sent" && event.type !== "reply_sent") continue;
      const name = ctx.agentNames?.[intent.actorId];
      if (name) event.payload["senderName"] = name;
      const content = typeof event.payload["content"] === "string" ? event.payload["content"] : "";
      // Somebody whispered to this actor: the answer goes back to them in a whisper, not to the room (D44).
      const back = whisperer(ctx.trigger, intent);
      const mode: SpeechMode = this.hotel?.chooseMode?.(intent.actorId, content, back ? "whisper" : "say") ?? (back ? "whisper" : "say");
      const heard = this.hotel?.audibility?.(intent.actorId, event.channelId, mode, mode === "whisper" ? back?.ref : undefined);
      if (!heard) continue;
      event.payload["mode"] = mode;
      event.payload["hearing"] = heard.hearing;
      if (mode === "whisper" && back) {
        event.payload["whisperTo"] = back.ref;
        if (back.name) event.payload["whisperToName"] = back.name;
        // Private: spectators never see it, and the person it is for is the audience even when nobody else is near.
        event.visibility = { ...event.visibility, visibleToSpectators: false };
      }
      event.visibility =
        heard.visibleToAgents.length > 0
          ? { ...event.visibility, visibleToAgents: heard.visibleToAgents }
          : {
              visibleToAgents: [],
              visibleToSpectators: false,
              visibleToOperators: true,
              visibilityReason: "operator_only",
            };
    }
  }

  private arbitrate(intent: ActionIntent, ctx: ResolveContext): IntentViolation | undefined {
    if (!this.arbiter) return undefined;
    if (intent.intentType !== "send_message" && intent.intentType !== "reply_to_message") return undefined;
    const roomId = roomIdOfChannel(intent.channelTarget || ctx.channelId);
    if (roomId === undefined) return undefined;
    const now = this.clock();
    const answering = ctx.trigger?.id;
    const kind = this.arbiter.classify?.(intent.actorId, roomId, now, answering, ctx.decidedAt) ?? "ambient";
    const decision = this.arbiter.gate(intent.actorId, roomId, kind, now, answering, ctx.decidedAt);
    return decision.outcome === "blocked" ? decision.violation : undefined;
  }

  /**
   * The intent's private motive as a committed `private_motive_summary`,
   * operator-only, joined to the act by `sourceIntentId` (same precedent as
   * `memoryProposalEvents`). Uses the ORIGINAL intent even when a fallback
   * was derived — the fallback copies the motive verbatim, and the reader
   * wants the thought behind the attempt, not the mechanics of the retry.
   */
  private privateMotiveEvent(intent: ActionIntent, ctx: ResolveContext): SimulationEvent {
    const payload: PrivateMotiveSummaryPayload = {
      summary: intent.privateMotiveSummary,
      intentType: intent.intentType,
      emotionDrivers: intent.emotionDrivers ?? [],
      motivationDrivers: intent.motivationDrivers ?? [],
      engineAuthored: isEngineAuthoredMotive(intent.privateMotiveSummary),
      ...(ctx.holdSuggested ? { holdSuggested: true } : {}),
    };
    return {
      simulationId: ctx.simulationId,
      channelId: intent.channelTarget || ctx.channelId,
      actorId: intent.actorId,
      type: "private_motive_summary",
      payload,
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

  private memoryProposalEvents(intent: ActionIntent, ctx: ResolveContext): SimulationEvent[] {
    return (intent.memoryWrites ?? []).map((raw, i) => {
      // A short proposal arrives with structural defaults from the parser:
      // subjects are whatever the model wrote (ids or names), tone is the
      // placeholder. Resolve subjects to ids and take tone/intensity from
      // what the agent is feeling as it acts.
      // Only a short proposal is refined; a full one is the model's (or the
      // mock's) own and passes through untouched.
      const isShort = raw.emotionalTone === MEMORY_TONE_UNSPECIFIED;
      const subjectAgentIds = isShort ? resolveSubjectAgentIds(raw.subjectAgentIds, ctx.agentNames) : raw.subjectAgentIds;
      const dominant = isShort ? dominantActionEmotion(ctx.actionEmotions) : undefined;
      const proposal: MemoryWriteProposal = {
        ...raw,
        subjectAgentIds,
        type: isShort && subjectAgentIds.length === 0 && raw.type === "relationship" ? "self" : raw.type,
        emotionalTone: dominant ? dominant.tone : raw.emotionalTone,
        intensity: dominant ? Math.max(0.2, Math.min(1, Math.round(dominant.magnitude * 100) / 100)) : raw.intensity,
      };
      return {
      simulationId: ctx.simulationId,
      channelId: ctx.channelId,
      actorId: intent.actorId,
      type: "memory_written" as const,
      payload: { ...memoryWrittenPayload(proposal), proposalIndex: i },
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
    });
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
          channelId: intent.channelTarget || ctx.channelId,
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
          channelId: intent.channelTarget || ctx.channelId,
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
          channelId: intent.channelTarget || ctx.channelId,
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
          channelId: intent.channelTarget || ctx.channelId,
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
