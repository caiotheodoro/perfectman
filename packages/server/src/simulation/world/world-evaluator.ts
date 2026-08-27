import type {
  AcceptanceMode,
  AgentAcceptanceContext,
  AgentContextDigest,
  AgentState,
  Channel,
  ChannelMembership,
  CommittedEvent,
  DelusionWeights,
  EmergentGoal,
  EndingOffer,
  GoalLayerConfig,
  GoalProposal,
  OperatorEvent,
  SelfVerdict,
  Simulation,
  SimulationEvent,
  SynthesizerConfig,
  WorldVerdict,
} from "@perfectman/shared";
import {
  DEFAULT_DELUSION_WEIGHTS,
  computeDelusionGap,
  crystallizeGoalProposals,
  evaluateEndCondition,
  evaluateWorldVerdict,
  filterVisibleEventsForAgent,
  rateGoalProposal,
  verifyGoalProgress,
} from "@perfectman/engine";
import type { DeferenceSignal, GoalRatingContext, WorldStateSnapshot } from "@perfectman/engine";
import type { IAgentStateRepository, IEventRepository } from "../../persistence/repositories.js";
import type { ChannelRegistry } from "../channel-registry.js";
import { EngineEventBuilder } from "../engine-event-builder.js";
import { payloadString } from "../payload-readers.js";
import type { GoalRegistry } from "./goal-registry.js";
import { createGoalSynthesizer } from "./goal-synthesizer.js";
import type { GoalSynthesizer, GoalLayerClientFactory, LLMGoalSynthesizer } from "./goal-synthesizer.js";
import type { LLMConfig } from "../../llm/llm-config.js";
import type { LLMBudgetTracker } from "../../llm/llm-budget.js";
import { createAcceptanceGate } from "./acceptance-gate.js";
import type { AcceptanceGate } from "./acceptance-gate.js";

export type GoalLayerRuntimeConfig = {
  enabled: boolean;
  reviewEveryPulses: number;
  delusionWeightsByAgent: ReadonlyMap<string, DelusionWeights>;
  ending: { offerAcceptPulses: number; meaningMadeMaxDivergence: number };
  synthesizer: SynthesizerConfig;
  acceptance: { mode: AcceptanceMode };
};

/** Wired into the pulse scheduler as one unit. */
export type GoalLayerRuntime = {
  config: GoalLayerRuntimeConfig;
  evaluator: WorldEvaluator;
};

export type WorldReview = {
  events: SimulationEvent[];
  endingOffer: EndingOffer | null;
  /** Scheduler-emitted operator events; always [] on deterministic paths. */
  operatorEvents: OperatorEvent[];
};

/** D-32 seam: the evaluator's optional DB dependency, typed without importing
 *  the sqlite implementation (world never imports persistence impls). */
export type GoalSelfVerdictEntry = {
  goalId: string;
  verdict: SelfVerdict;
  source: "llm" | "deterministic";
};

export type GoalRegistryPersister = {
  saveSelfVerdicts(simulationId: string, entries: GoalSelfVerdictEntry[]): Promise<void>;
  loadSelfVerdicts(simulationId: string): Promise<GoalSelfVerdictEntry[]>;
};

/** LLM-mode wiring (D-18): the evaluator's injected per-agent providers + shared budget. */
export type WorldLLMRuntime = {
  simulationId: string;
  llmConfigs: ReadonlyMap<string, LLMConfig>;
  budget: LLMBudgetTracker;
  clientFactory?: GoalLayerClientFactory;
};

const RATING_CONTEXT: GoalRatingContext = {
  currentDistance: 1,
  feasibility: 1,
  empowermentGain: 0.5,
};

/**
 * Event types the world layer itself authors, plus scheduler/system
 * diagnostics the visibility filter blocks from agents (mirror of the
 * engine's AGENT_BLOCKED_TYPES — the crystallizer reads empty
 * visibleToAgents as witnessed by all, so agent-invisible events must not
 * feed it). Memory/no-op records stay in scope: agent-authored, they are
 * organic signals the crystallizer already ignores by type.
 */
const WORLD_EVENT_TYPES: ReadonlySet<CommittedEvent["type"]> = new Set([
  "goal_proposed",
  "goal_accepted",
  "goal_declined",
  "world_verdict",
  "delusion_gap_sampled",
  "ending_offered",
  "stagnation_detected",
  "operator_warning",
  "llm_failure",
  "private_motive_summary",
]);

function organicSignalHistory(log: CommittedEvent[]): CommittedEvent[] {
  return log.filter((event) => !WORLD_EVENT_TYPES.has(event.type));
}

const DEFER_EMOJI = new Set(["👍", "❤️", "✅", "👏", "🌟", "😄"]);
const RIDICULE_EMOJI = new Set(["👎", "😠", "❌", "🙄", "💢"]);
const CHALLENGE_MARKERS = ["no", "not", "stop", "refuse", "won't", "never", "doubt"];

/**
 * Defaults + config-file merge. The resolver accepts every mode; each
 * implementation owns its own wiring guard (the acceptance gate for
 * "agent", the evaluator's llmRuntime requirement for "llm").
 */
export function resolveGoalLayerConfig(
  parsed: GoalLayerConfig | undefined,
): GoalLayerRuntimeConfig {
  const config: GoalLayerRuntimeConfig = {
    enabled: parsed?.enabled ?? false,
    reviewEveryPulses: parsed?.reviewEveryPulses ?? 10,
    delusionWeightsByAgent: new Map(
      Object.entries(parsed?.delusionWeightsByAgent ?? {}),
    ),
    ending: {
      offerAcceptPulses: parsed?.ending?.offerAcceptPulses ?? 0,
      // Meaning-made gate ceiling for divergenceFromLog (issue #106). The
      // default is the pre-config scaffold value (ADR-0011 D-28 routed the
      // dedicated calibration here); the sweep overrides it per cell.
      meaningMadeMaxDivergence:
        parsed?.ending?.meaningMadeMaxDivergence ?? 0.33,
    },
    synthesizer: {
      mode: parsed?.synthesizer?.mode ?? "deterministic",
      intervalPulses: parsed?.synthesizer?.intervalPulses ?? 1,
      maxCandidatesPerReview: parsed?.synthesizer?.maxCandidatesPerReview ?? 3,
      maxSelfVerdictsPerReview:
        parsed?.synthesizer?.maxSelfVerdictsPerReview ?? 3,
    },
    acceptance: { mode: parsed?.acceptance?.mode ?? "auto" },
  };
  return config;
}

/**
 * The agent-side narrative digest for synthesis: deterministic over
 * (AgentState, committed log) only — the LLM slice extends it additively.
 */
export function buildAgentContextDigest(
  agentState: AgentState,
  log: CommittedEvent[],
  window: CommittedEvent[] = log,
): AgentContextDigest {
  const recentMemories = [...agentState.memories]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10)
    .map((memory) => ({
      summary: memory.summary,
      sourceEventIds: memory.sourceEventIds,
    }));
  const privateMotiveSummaries = window
    .filter(
      (event) =>
        event.type === "no_op_recorded" && event.actorId === agentState.agentId,
    )
    .map((event) => event.payload["privateMotiveSummary"])
    .filter((summary): summary is string => typeof summary === "string")
    .slice(-5)
    .reverse();
  return {
    personaId: agentState.personaId,
    recentMemories,
    privateMotiveSummaries,
  };
}

/**
 * Server-side world review (stagnation-chain role): crystallize → synthesize
 * → rate → accept → verify → world-verdict → delusion-gap → end-condition.
 * Pure orchestration over injected repos — no rng, no LLM, no I/O beyond the
 * repo reads.
 */
export class WorldEvaluator {
  private readonly builder = new EngineEventBuilder();
  private readonly synthesizer: GoalSynthesizer;
  private readonly llmSynthesizer: LLMGoalSynthesizer | null;
  private readonly acceptanceGate: AcceptanceGate;
  private offerDelivered = false;

  constructor(
    private readonly eventRepo: IEventRepository,
    private readonly agentStateRepo: IAgentStateRepository,
    private readonly channelRegistry: ChannelRegistry,
    private readonly registry: GoalRegistry,
    private readonly config: GoalLayerRuntimeConfig,
    llmRuntime?: WorldLLMRuntime,
    private readonly registryPersister?: GoalRegistryPersister,
  ) {
    // The factory's "llm" branch fails closed on missing deps; the evaluator
    // names the requirement so the config error cites the wiring, not an
    // absent provider detail.
    if (config.synthesizer.mode === "llm" && !llmRuntime) {
      throw new Error(
        'synthesizer.mode "llm" requires a goal-layer LLM runtime (per-agent LLM configs + budget)',
      );
    }
    this.synthesizer = createGoalSynthesizer(
      config.synthesizer.mode,
      llmRuntime
        ? {
            simulationId: llmRuntime.simulationId,
            llmConfigs: llmRuntime.llmConfigs,
            budget: llmRuntime.budget,
            registry: this.registry,
            synthesizerConfig: config.synthesizer,
            clientFactory: llmRuntime.clientFactory,
          }
        : undefined,
    );
    this.acceptanceGate = createAcceptanceGate(config.acceptance.mode);
    this.llmSynthesizer =
      config.synthesizer.mode === "llm"
        ? (this.synthesizer as LLMGoalSynthesizer)
        : null;
  }

  /** Review-end write-through (D-31): whole-junction serialization over the
   *  registry's live state; reads only getGoals()/getSelfVerdict, so replay
   *  stays the authority. No-op in memory mode (no persister injected). */
  async persistRegistryState(simulationId: string): Promise<void> {
    if (!this.registryPersister) return;
    const entries: GoalSelfVerdictEntry[] = [];
    for (const goal of this.registry.getGoals()) {
      const stored = this.registry.getSelfVerdict(goal.id);
      if (stored) {
        entries.push({ goalId: goal.id, verdict: stored.verdict, source: stored.source });
      }
    }
    await this.registryPersister.saveSelfVerdicts(simulationId, entries);
  }

  async runReview(input: {
    simulation: Simulation;
    agents: Array<{ id: string; state: AgentState }>;
    pulseIndex: number;
    now: number;
  }): Promise<WorldReview> {
    const { simulation, agents, pulseIndex, now } = input;
    const log = await this.eventRepo.getCommittedThrough(
      simulation.id,
      Number.MAX_SAFE_INTEGER,
    );

    // Single-offer gate first: while an offer is pending no further world
    // events commit; once the accept window elapses the offer is delivered.
    const pending = this.registry.getPendingOffer();
    if (pending !== null) {
      if (this.config.ending.offerAcceptPulses === 0) {
        // Immediate-delivery offers are handed to the scheduler the pulse
        // their ending_offered event commits, so a committed event is the
        // delivery marker. Absent one, the creation append failed and the
        // offer is still owed — re-deliver until a commit sticks.
        if (log.some((event) => event.type === "ending_offered")) {
          return { events: [], endingOffer: null, operatorEvents: [] };
        }
        return { events: [], endingOffer: pending.offer, operatorEvents: [] };
      }
      if (this.offerDelivered) {
        return { events: [], endingOffer: null, operatorEvents: [] };
      }
      if (pulseIndex - pending.offeredAtPulse >= this.config.ending.offerAcceptPulses) {
        this.offerDelivered = true;
        return { events: [], endingOffer: pending.offer, operatorEvents: [] };
      }
      return { events: [], endingOffer: null, operatorEvents: [] };
    }

    const events: SimulationEvent[] = [];
    const operatorEvents: OperatorEvent[] = [];
    const [channels, membership] = await Promise.all([
      this.channelRegistry.getChannels(simulation.id),
      this.channelRegistry.getMembershipsForSimulation(simulation.id),
    ]);
    const agentStateById = new Map<string, AgentState>();
    for (const agent of agents) {
      const stored = await this.agentStateRepo.get(simulation.id, agent.id);
      agentStateById.set(agent.id, stored ?? agent.state);
    }

    // Acceptance of proposals proposed at earlier reviews — the gate
    // decides; acceptance is a config-selected policy.
    for (const proposal of this.registry.getProposals()) {
      const rating = rateGoalProposal(proposal, RATING_CONTEXT);
      const channelId = goalChannelIdOf(proposal, log, simulation);
      const decision = this.acceptanceGate.decide(
        proposal,
        rating,
        buildAcceptanceContext(proposal, log, channelId, agentStateById),
      );
      const ctx = { simulationId: simulation.id, channelId, pulseIndex };
      if (decision.decision === "accept") {
        const goal = this.registry.promoteProposal(proposal.id);
        if (goal) events.push(this.builder.fromGoalAccepted(goal, ctx));
      } else {
        this.registry.declineProposal(proposal.id);
        events.push(this.builder.fromGoalDeclined(proposal, ctx));
      }
    }

    // Synthesis on the interval cadence (LLM-mode cost gate), capped per agent.
    if (pulseIndex % this.config.synthesizer.intervalPulses === 0) {
      for (const agent of agents) {
        const agentState = agentStateById.get(agent.id) ?? agent.state;
        const candidates = dedupeById(
          crystallizeGoalProposals(agent.id, organicSignalHistory(log)),
        ).slice(
          0,
          this.config.synthesizer.maxCandidatesPerReview,
        );
        if (candidates.length === 0) continue;
        // Per-review pulse/time for the operator-event literals and usage
        // records; deterministic paths have no llmSynthesizer to set.
        this.llmSynthesizer?.setReviewContext(pulseIndex, now);
        const results = await this.synthesizer.synthesize({
          agentId: agent.id,
          candidates,
          context: buildAgentContextDigest(agentState, log),
        });
        if (this.llmSynthesizer) {
          operatorEvents.push(...this.llmSynthesizer.takeOperatorEvents());
        }
        for (const result of results) {
          if (
            this.registry.hasProposal(result.proposal.id) ||
            this.registry.getGoal(result.proposal.id) !== undefined
          ) {
            continue;
          }
          const rating = rateGoalProposal(result.proposal, RATING_CONTEXT);
          if (!rating.recommendAccept) continue;
          this.registry.recordProposal(result.proposal);
          events.push(
            this.builder.fromGoalProposed(result, {
              simulationId: simulation.id,
              channelId: goalChannelIdOf(result.proposal, log, simulation),
              pulseIndex,
            }),
          );
        }
      }
    }

    // Per active goal: snapshots → verify → world verdict; self verdict →
    // delusion gap. Two independent verdict machines; termination later gates
    // on the world verdict only.
    const gateData = new Map<
      string,
      { selfVerdict: SelfVerdict; divergenceFromLog: number }
    >();
    for (const goal of this.registry.getGoals()) {
      const agentState = agentStateById.get(goal.agentId)!;
      const channelId = goalChannelIdOf(goal, log, simulation);
      const objective = verifyGoalProgress(
        goal,
        deriveSnapshots(goal, log, now),
      );
      const signals = deriveDeferenceSignals(goal, log, channelId);
      const verdict = evaluateWorldVerdict(goal.id, objective, signals);
      this.registry.recordVerdict(verdict);
      events.push(
        this.builder.fromWorldVerdict(verdict, {
          simulationId: simulation.id,
          channelId,
          pulseIndex,
        }),
      );

      // Stored-first (D-23): the combined call's LLM verdict rides the
      // registry junction between intervals; the structural V1 producer is
      // only the fallback. Deterministic paths are unaffected — nothing
      // ever stores into the junction.
      const selfVerdict =
        this.registry.getSelfVerdict(goal.id)?.verdict ??
        synthesizeSelfVerdict(agentState, goal, now);
      const divergenceFromLog = deriveDivergenceFromLog(
        goal.agentId,
        log,
        channels,
        membership,
      );
      const gap = computeDelusionGap(
        selfVerdict,
        verdict,
        divergenceFromLog,
        this.registry.getGapHistory(goal.id),
        now,
        this.config.delusionWeightsByAgent.get(goal.agentId) ??
          DEFAULT_DELUSION_WEIGHTS,
      );
      const sample = gap.history[gap.history.length - 1]!;
      this.registry.recordGapSample(goal.id, sample);
      events.push(
        this.builder.fromDelusionGapSampled(gap, {
          simulationId: simulation.id,
          channelId,
          pulseIndex,
        }),
      );
      gateData.set(goal.id, { selfVerdict, divergenceFromLog });
    }

    // Ending gate: only end_offered terminates — re_goal/continue keep the
    // arc running. The first end_offered wins; the registry's single-offer
    // invariant refuses any later claim.
    let endingOffer: EndingOffer | null = null;
    for (const goal of this.registry.getGoals()) {
      const verdict = this.registry.getLatestVerdict(goal.id);
      const data = gateData.get(goal.id);
      if (!verdict || !data) continue;
      const result = evaluateEndCondition(goal, data.selfVerdict, verdict, {
        completionBeatPresent: deriveCompletionBeat(
          goal,
          log,
          goalChannelIdOf(goal, log, simulation),
        ),
        meaningMade: deriveMeaningMade(
          verdict,
          data.divergenceFromLog,
          this.config.ending.meaningMadeMaxDivergence,
        ),
        nextGoalAvailable: deriveNextGoalAvailable(this.registry),
      });
      if (result.kind !== "end_offered") continue;
      if (!this.registry.setPendingOffer(result.offer, pulseIndex)) break;
      events.push(
        this.builder.fromEndingOffered(result.offer, {
          simulationId: simulation.id,
          channelId: goalChannelIdOf(goal, log, simulation),
          pulseIndex,
        }),
      );
      if (this.config.ending.offerAcceptPulses === 0) {
        endingOffer = result.offer;
      }
      break;
    }

    return { events, endingOffer, operatorEvents };
  }
}

/**
 * One snapshot per past review, plus the current one. Windows are split by
 * log POSITION, never by comparing event createdAt against the review's
 * sim-time now: committed events carry wall-clock stamps while the review
 * clock is sim time, so a time-domain window can never include the current
 * pulse's events. The final window runs from the last committed verdict to
 * the end of the log — this pulse's agent-loop events land inside it.
 */
function deriveSnapshots(
  goal: EmergentGoal,
  log: CommittedEvent[],
  now: number,
): WorldStateSnapshot[] {
  const verdictIndices: number[] = [];
  log.forEach((event, index) => {
    if (
      event.type === "world_verdict" &&
      event.payload["goalId"] === goal.id
    ) {
      verdictIndices.push(index);
    }
  });
  let windowStart = log.findIndex(
    (event) =>
      event.type === "goal_accepted" && event.payload["goalId"] === goal.id,
  );
  if (windowStart < 0) {
    // First review of a just-accepted goal: the acceptance event is still in
    // this review's uncommitted batch, so anchor on the last source event.
    const sources = new Set(goal.sourceEventIds);
    log.forEach((event, index) => {
      if (sources.has(event.id)) windowStart = index;
    });
  }
  const snapshots: WorldStateSnapshot[] = [];
  for (const index of verdictIndices) {
    snapshots.push(
      snapshotAt(goal, log, log[index]!.createdAt, windowStart + 1, index + 1),
    );
    windowStart = index;
  }
  snapshots.push(snapshotAt(goal, log, now, windowStart + 1, log.length));
  return snapshots;
}

function snapshotAt(
  goal: EmergentGoal,
  log: CommittedEvent[],
  at: number,
  start: number,
  end: number,
): WorldStateSnapshot {
  const window = log.slice(start, end);
  return {
    at,
    satisfiedCriteria: goal.targetState.observableCriteria.filter(
      (criterion) => criterionSatisfied(criterion, goal, window),
    ),
  };
}

function criterionSatisfied(
  criterion: string,
  goal: EmergentGoal,
  window: CommittedEvent[],
): boolean {
  if (criterion.startsWith("no more blocked intents from")) {
    const channelId = channelFromCriterion(criterion);
    return !window.some(
      (event) =>
        event.type === "intent_blocked" &&
        event.actorId === goal.agentId &&
        (channelId === undefined || event.channelId === channelId),
    );
  }
  if (criterion.startsWith("a successful follow-up")) {
    const channelId = channelFromCriterion(criterion);
    return window.some(
      (event) =>
        (event.type === "message_sent" || event.type === "reply_sent") &&
        event.actorId === goal.agentId &&
        (channelId === undefined || event.channelId === channelId),
    );
  }
  if (criterion.includes("keeps engaging")) {
    return (
      window.filter(
        (event) =>
          (event.type === "message_sent" || event.type === "reply_sent") &&
          event.actorId === goal.agentId,
      ).length >= 2
    );
  }
  if (criterion.includes("reciprocated")) {
    return window.some(
      (event) =>
        event.actorId !== goal.agentId &&
        (event.type === "message_sent" ||
          event.type === "reply_sent" ||
          event.type === "reaction_sent") &&
        payloadMentionsAgent(event.payload, goal.agentId),
    );
  }
  if (criterion.includes("is settled") || criterion.includes("is restored")) {
    return !window.some(
      (event) => event.type === "agent_left" && event.actorId === goal.agentId,
    );
  }
  if (
    criterion.includes("resumes") ||
    criterion.includes("acts on") ||
    criterion.includes("gains a return")
  ) {
    return window.some(
      (event) =>
        (event.type === "message_sent" || event.type === "reply_sent") &&
        event.actorId === goal.agentId,
    );
  }
  return false;
}

function channelFromCriterion(criterion: string): string | undefined {
  const parts = criterion.split(" in ");
  return parts.length > 1 ? parts[1]!.split(" ")[0] : undefined;
}

/**
 * Only other agents' events count — messages/reactions toward the goal
 * agent's channel. Empty when uncontested.
 */
function deriveDeferenceSignals(
  goal: EmergentGoal,
  log: CommittedEvent[],
  channelId: string,
): DeferenceSignal[] {
  const signals: DeferenceSignal[] = [];
  for (const event of log) {
    if (event.actorId === goal.agentId) continue;
    if (event.channelId !== channelId) continue;
    if (event.type === "message_sent" || event.type === "reply_sent") {
      const content = payloadString(event.payload, "content");
      if (!content.includes(goal.agentId)) continue;
      const challenged = CHALLENGE_MARKERS.some((marker) =>
        content.toLowerCase().includes(marker),
      );
      signals.push({
        sourceAgentId: event.actorId,
        stance: challenged ? "challenge" : "defer",
        strength: challenged ? 0.6 : 0.3,
      });
    } else if (event.type === "reaction_sent") {
      const emoji = payloadString(event.payload, "emoji");
      if (DEFER_EMOJI.has(emoji)) {
        signals.push({ sourceAgentId: event.actorId, stance: "defer", strength: 0.4 });
      } else if (RIDICULE_EMOJI.has(emoji)) {
        signals.push({ sourceAgentId: event.actorId, stance: "ridicule", strength: 0.7 });
      }
    }
  }
  return signals;
}

/**
 * V1 self verdict — no self-claim machinery exists anywhere, so the claim is
 * a deterministic in-progress default; the felt signal comes from the mood.
 * The claimed-reached seam is deferred to the LLM slice.
 */
function synthesizeSelfVerdict(
  agentState: AgentState,
  goal: EmergentGoal,
  _now: number,
): SelfVerdict {
  const feltSignal = clamp01(
    ((agentState.coreMood.valence + 1) / 2 + agentState.coreMood.arousal) / 2,
  );
  return {
    agentId: goal.agentId,
    goalId: goal.id,
    claim: "in_progress",
    confidence: 0.5,
    feltSignal,
    narrative: `${goal.title}: in progress`,
  };
}

/** Exposure ratio: the fraction of log events the agent could see. */
function deriveDivergenceFromLog(
  agentId: string,
  log: CommittedEvent[],
  channels: Channel[],
  membership: ChannelMembership[],
): number {
  if (log.length === 0) return 0;
  const visible = filterVisibleEventsForAgent(log, agentId, channels, membership)
    .length;
  return clamp01(1 - visible / log.length);
}

/** The agent returned to the scene after the goal was set. */
function deriveCompletionBeat(
  goal: EmergentGoal,
  log: CommittedEvent[],
  channelId: string,
): boolean {
  return log.some(
    (event) =>
      (event.type === "message_sent" || event.type === "reply_sent") &&
      event.actorId === goal.agentId &&
      event.channelId === channelId &&
      event.createdAt > goal.createdAt,
  );
}

/**
 * The meaning-made gate (issue #106, routed by ADR-0011 D-28): a reached
 * world verdict only counts as meaning-made when the agent's narrative stays
 * strictly under the configured divergence ceiling. The ceiling lives in
 * config (`ending.meaningMadeMaxDivergence`, default 0.33) so the calibration
 * sweep can move it; this predicate is the single derivation — the eval
 * harness's end-condition recorder consumes it through the eval surface.
 */
export function deriveMeaningMade(
  worldVerdict: WorldVerdict,
  divergenceFromLog: number,
  maxDivergence: number,
): boolean {
  return (
    worldVerdict.determination === "reached" &&
    divergenceFromLog < maxDivergence
  );
}

function deriveNextGoalAvailable(registry: GoalRegistry): boolean {
  return registry.getProposals().length > 0;
}

/**
 * Agent-mode acceptance context (D-21): the target agent's post-proposal
 * behavior window — the log slice from its goal_proposed commit position to
 * log end (ADR-0009 positional rule), scoped to the agent and its channel —
 * plus the agent's committed digest. Engagement before the proposal commit
 * never counts: only behavior after perceiving the goal is ownership.
 */
function buildAcceptanceContext(
  proposal: GoalProposal,
  log: CommittedEvent[],
  channelId: string,
  agentStateById: ReadonlyMap<string, AgentState>,
): AgentAcceptanceContext {
  const proposedAt = log.findIndex(
    (event) =>
      event.type === "goal_proposed" && event.payload["goalId"] === proposal.id,
  );
  const behaviorWindow =
    proposedAt < 0
      ? []
      : log.slice(proposedAt + 1).filter(
          (event) =>
            event.actorId === proposal.agentId && event.channelId === channelId,
        );
  const agentState = agentStateById.get(proposal.agentId);
  return {
    behaviorWindow,
    // The gate decides from the window alone; a proposal whose agent is no
    // longer in the review's agent set still gets a digest it never reads.
    digest: agentState
      ? buildAgentContextDigest(agentState, log, behaviorWindow)
      : { personaId: "", recentMemories: [], privateMotiveSummaries: [] },
  };
}

function goalChannelIdOf(
  source: { sourceEventIds: string[] },
  log: CommittedEvent[],
  simulation: Simulation,
): string {
  const sourceIds = new Set(source.sourceEventIds);
  for (const event of log) {
    if (sourceIds.has(event.id)) return event.channelId;
  }
  return simulation.channelIds[0] ?? "";
}

function dedupeById(items: GoalProposal[]): GoalProposal[] {
  const seen = new Set<string>();
  const result: GoalProposal[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

function payloadMentionsAgent(value: unknown, agentId: string): boolean {
  if (typeof value === "string") return value.includes(agentId);
  if (Array.isArray(value)) return value.some((v) => payloadMentionsAgent(v, agentId));
  if (value !== null && typeof value === "object") {
    return Object.values(value).some((v) => payloadMentionsAgent(v, agentId));
  }
  return false;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}