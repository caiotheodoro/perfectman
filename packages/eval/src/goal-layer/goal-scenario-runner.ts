/**
 * Goal-layer scenario runner — headless mock-only harness for threshold
 * calibration (issue #96). Ports the goal-end-to-end test (a) wiring: manual
 * GoalLayerRuntime construction, canned reached-claim client for self-
 * claims-reached arcs, witnessed-event injection between reviews, and a
 * wrapped WorldEvaluator that records EndConditionResult per goal per review
 * (re_goal/continue are pure return values inside runReview — never
 * committed — so the recorder is the only surface that can label them).
 *
 * Zero wire calls by construction: a no-op agent runtime, deterministic
 * goal synthesis, and the canned client never touch a provider.
 */

import type {
  ActionIntent,
  AgentState,
  Channel,
  ChannelMembership,
  CommittedEvent,
  DelusionGapSample,
  EndingOffer,
  GoalLayerConfig,
  SelfVerdict,
  Simulation,
  SimulationEvent,
} from "@perfectman/shared";
import { GoalLayerConfigSchema, createId } from "@perfectman/shared";
import type { AgentRuntimeInput } from "@perfectman/shared";
import { evaluateEndCondition, filterVisibleEventsForAgent } from "@perfectman/engine";
import {
  ChannelRegistry,
  GoalLayerLLMClient,
  GoalRegistry,
  InMemoryAgentStateRepository,
  InMemoryChannelRepository,
  InMemoryEventRepository,
  InMemorySimulationRepository,
  LLMBudgetTracker,
  MockDeliveryGateway,
  SimulationRuntime,
  WorldEvaluator,
  deriveMeaningMade,
  resolveGoalLayerConfig,
  type GoalLayerCallInput,
  type GoalLayerClientFactory,
  type GoalLayerLLMOutcome,
  type GoalLayerRuntime,
  type GoalLayerRuntimeConfig,
  type WorldLLMRuntime,
  type WorldReview,
  type AgentRuntimeOutput,
} from "@perfectman/server";
import type { GoalScenarioRecipe } from "./scenario-recipes.js";

export type GoalLayerRunOptions = {
  /**
   * Safety bound for the four non-terminating arcs (G5 deluded re-goal
   * included); recorded in the report and labeled pulse-cap-stop.
   */
  pulseCap?: number;
};

export type GoalRunResult = {
  scenarioId: string;
  mode: "deterministic" | "llm";
  config: GoalLayerRuntimeConfig;
  pulseCap: number;
  pulsesRun: number;
  /** True when the run ended on the pulse cap rather than an ending offer. */
  capped: boolean;
  providerCalls: number;
  llmCalls: number;
  goalCalls: number;
  events: CommittedEvent[];
  endConditionLog: RecordedEndCondition[];
  trajectories: GoalTrajectory[];
};

export type RecordedEndCondition = {
  goalId: string;
  agentId: string;
  pulseIndex: number;
  kind: "end_offered" | "re_goal" | "continue";
  reason?: string;
  offer?: EndingOffer;
};

export type GoalTrajectoryTermination =
  | "reached"
  | "story-is-over"
  | "re_goal"
  | "continue"
  | "pulse-cap-stop";

export type GoalTrajectory = {
  goalId: string;
  agentId: string;
  proposed: boolean;
  accepted: boolean;
  declined: boolean;
  gapSamples: DelusionGapSample[];
  termination: GoalTrajectoryTermination;
};

const DEFAULT_PULSE_CAP = 120;

/**
 * Harness stamping: recipe and injected events commit with run-scoped
 * sim-time (pulse * pulseIntervalMs — the scheduler's deterministic time
 * domain) and their committing pulse, never the repo's wall-clock
 * fallback, so identical seeds reproduce identical completion beats on any
 * machine (the determinism contract's oracle test).
 */
function stampHarnessEvents(
  events: SimulationEvent[],
  pulseIndex: number,
  pulseIntervalMs: number,
): SimulationEvent[] {
  const createdAt = pulseIndex * pulseIntervalMs;
  return events.map((event) => ({ ...event, createdAt, pulseIndex }));
}

const MOCK_LLM = {
  providerType: "mock" as const,
  modelName: "mock-model",
  baseUrl: "http://localhost",
  maxInputTokens: 2048,
  maxOutputTokens: 512,
  temperature: 0.7,
  timeoutMs: 5000,
  retryCount: 1,
};

function makeNoOpIntent(actorId: string): ActionIntent {
  return {
    id: createId(),
    actorId,
    intentType: "no_op",
    personTargets: [],
    privateMotiveSummary: "nothing to do",
    emotionDrivers: [],
    motivationDrivers: [],
    memoryWrites: [],
  };
}

const noOpAgentRuntime = {
  generateIntent: async (
    input: AgentRuntimeInput,
  ): Promise<AgentRuntimeOutput> => ({
    intent: makeNoOpIntent(input.agentId),
    llmUsage: null,
    latencyMs: 5,
    fallbackApplied: false,
    operatorEvents: [],
  }),
};

/** Goal-call usage counter: the only budget consumer in the harness is the
 *  goal leg, and the canned client never records usage — asserted zero. */
class CountingBudgetTracker extends LLMBudgetTracker {
  goalCalls = 0;
  override recordUsage(usage: import("@perfectman/shared").LLMUsage): void {
    if (usage.callType === "goal") this.goalCalls += 1;
    super.recordUsage(usage);
  }
}

/** Canned reached-claim combined call (deludedLlmOutcome port): genuine LLM
 *  "reached" claims for every active goal and an endorsement for every
 *  candidate, with zero transport use. */
function reachedClaimClientFactory(): GoalLayerClientFactory {
  return () => {
    const caller = Object.create(GoalLayerLLMClient.prototype) as GoalLayerLLMClient;
    caller.call = async (input: GoalLayerCallInput): Promise<GoalLayerLLMOutcome> => ({
      result: {
        proposals: input.candidates.map((candidate) => ({
          proposal: candidate,
          narrativeFraming: `${candidate.title} — ${candidate.targetState.description}`,
          confidence: 0.8,
          synthesizer: "llm" as const,
        })),
        selfVerdicts: input.activeGoals.map((goal) => ({
          agentId: goal.agentId,
          goalId: goal.id,
          claim: "reached" as const,
          confidence: 1,
          feltSignal: 0.8,
          narrative: `${goal.title}: reached`,
        })),
      },
      operatorEvents: [],
    });
    return caller;
  };
}

/** V1 structural self verdict — replica of the evaluator's module-local
 *  fallback so the recorder's end-condition reconstruction is faithful on
 *  deterministic arcs (the claim is the only field the gate reads). */
function structuralSelfVerdict(state: AgentState, goal: { id: string; title: string }): SelfVerdict {
  const feltSignal = Math.min(
    1,
    Math.max(0, ((state.coreMood.valence + 1) / 2 + state.coreMood.arousal) / 2),
  );
  return {
    agentId: state.agentId,
    goalId: goal.id,
    claim: "in_progress",
    confidence: 0.5,
    feltSignal,
    narrative: `${goal.title}: in progress`,
  };
}

function deriveDivergenceFromLog(
  agentId: string,
  log: CommittedEvent[],
  channels: Channel[],
  membership: ChannelMembership[],
): number {
  if (log.length === 0) return 0;
  const visible = filterVisibleEventsForAgent(log, agentId, channels, membership).length;
  return Math.min(1, Math.max(0, 1 - visible / log.length));
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

function deriveCompletionBeat(
  goal: { agentId: string; createdAt: number },
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
 * Wrapped WorldEvaluator (RD-2): records the end-condition decision per goal
 * per review by reconstructing it from registry state + the committed log
 * after the inner review — the same inputs the evaluator's internal gate
 * used, since the review's own events commit only after runReview returns.
 */
export class EndConditionRecorder extends WorldEvaluator {
  readonly records: RecordedEndCondition[] = [];

  constructor(
    private readonly inner: WorldEvaluator,
    private readonly deps: {
      eventRepo: InMemoryEventRepository;
      agentStateRepo: InMemoryAgentStateRepository;
      channelRegistry: ChannelRegistry;
      registry: GoalRegistry;
      meaningMadeMaxDivergence: number;
    },
  ) {
    // The super() instance is an orphan — only the inner evaluator reviews.
    super(
      deps.eventRepo,
      deps.agentStateRepo,
      deps.channelRegistry,
      deps.registry,
      RECORDER_STUB_CONFIG,
    );
  }

  override async runReview(input: {
    simulation: Simulation;
    agents: Array<{ id: string; state: AgentState }>;
    pulseIndex: number;
    now: number;
  }): Promise<WorldReview> {
    const review = await this.inner.runReview(input);
    const { eventRepo, agentStateRepo, channelRegistry, registry, meaningMadeMaxDivergence } =
      this.deps;
    const log = await eventRepo.getCommittedThrough(
      input.simulation.id,
      Number.MAX_SAFE_INTEGER,
    );
    const [channels, membership] = await Promise.all([
      channelRegistry.getChannels(input.simulation.id),
      channelRegistry.getMembershipsForSimulation(input.simulation.id),
    ]);
    for (const goal of registry.getGoals()) {
      const verdict = registry.getLatestVerdict(goal.id);
      if (!verdict) continue;
      const stored = await agentStateRepo.get(input.simulation.id, goal.agentId);
      const state =
        stored ?? input.agents.find((agent) => agent.id === goal.agentId)?.state;
      if (!state) continue;
      const selfVerdict =
        registry.getSelfVerdict(goal.id)?.verdict ??
        structuralSelfVerdict(state, goal);
      const channelId = goalChannelIdOf(goal, log, input.simulation);
      const divergenceFromLog = deriveDivergenceFromLog(
        goal.agentId,
        log,
        channels,
        membership,
      );
      const result = evaluateEndCondition(goal, selfVerdict, verdict, {
        completionBeatPresent: deriveCompletionBeat(goal, log, channelId),
        meaningMade: deriveMeaningMade(
          verdict,
          divergenceFromLog,
          meaningMadeMaxDivergence,
        ),
        nextGoalAvailable: registry.getProposals().length > 0,
      });
      this.records.push({
        goalId: goal.id,
        agentId: goal.agentId,
        pulseIndex: input.pulseIndex,
        kind: result.kind,
        ...(result.kind === "end_offered"
          ? { offer: result.offer }
          : { reason: result.reason }),
      });
    }
    return review;
  }
}

const RECORDER_STUB_CONFIG: GoalLayerRuntimeConfig = {
  enabled: true,
  reviewEveryPulses: 1,
  delusionWeightsByAgent: new Map(),
  ending: { offerAcceptPulses: 0, meaningMadeMaxDivergence: 0.33 },
  synthesizer: {
    mode: "deterministic",
    intervalPulses: 1,
    maxCandidatesPerReview: 1,
    maxSelfVerdictsPerReview: 1,
  },
  acceptance: { mode: "auto" },
};

let runCounter = 0;

export class GoalScenarioRunner {
  async run(
    recipe: GoalScenarioRecipe,
    overrides: GoalLayerConfig,
    options: GoalLayerRunOptions = {},
  ): Promise<GoalRunResult> {
    const pulseCap = options.pulseCap ?? DEFAULT_PULSE_CAP;
    const parsed = GoalLayerConfigSchema.safeParse(overrides);
    if (!parsed.success) {
      throw new Error(
        `Invalid goal-layer override cell for "${recipe.id}": ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      );
    }
    const config = resolveGoalLayerConfig({
      ...parsed.data,
      enabled: true,
      // The recipe owns the synthesis mode; cells only tune the calibrated
      // knobs (weights, review cadence, offer acceptance). The candidate cap
      // must outlive the run's per-review witnessed events so a fresh legacy
      // proposal always reaches the registry — the plateau branch relies on
      // nextGoalAvailable staying true on non-terminating arcs.
      synthesizer: {
        mode: recipe.mode,
        intervalPulses: 1,
        maxCandidatesPerReview: 200,
        maxSelfVerdictsPerReview: 3,
      },
    });

    const simulationId = `sim_goal_${recipe.id}_${runCounter++}`;
    const eventRepo = new InMemoryEventRepository();
    const agentStateRepo = new InMemoryAgentStateRepository();
    const channelRepo = new InMemoryChannelRepository();
    const simRepo = new InMemorySimulationRepository();
    const registry = new GoalRegistry();
    const channelRegistry = new ChannelRegistry(channelRepo);
    const goalBudget = new CountingBudgetTracker();

    const llmRuntime: WorldLLMRuntime | undefined =
      recipe.mode === "llm"
        ? {
            simulationId,
            llmConfigs: new Map(
              recipe.agents.map((agent) => [agent.id, MOCK_LLM]),
            ),
            budget: goalBudget,
            clientFactory: reachedClaimClientFactory(),
          }
        : undefined;

    const evaluator = new WorldEvaluator(
      eventRepo,
      agentStateRepo,
      channelRegistry,
      registry,
      config,
      llmRuntime,
    );
    const recorder = new EndConditionRecorder(evaluator, {
      eventRepo,
      agentStateRepo,
      channelRegistry,
      registry,
      meaningMadeMaxDivergence: config.ending.meaningMadeMaxDivergence,
    });
    const goalLayer: GoalLayerRuntime = {
      config,
      evaluator: recorder,
    };

    const runtime = new SimulationRuntime({
      delivery: new MockDeliveryGateway(),
      agentRuntime: noOpAgentRuntime,
      llmBudget: new LLMBudgetTracker(),
      repositories: { eventRepo, agentStateRepo, simRepo, channelRepo },
    });

    await runtime.createSimulation({
      id: simulationId,
      name: `Goal-layer ${recipe.id} (calibration run)`,
      seed: 7,
      settings: recipe.settings,
      agentContexts: recipe.agents,
      channels: recipe.channels,
      goalLayer,
    });
    await runtime.getEventLog().append(
      simulationId,
      stampHarnessEvents(recipe.seedEvents, 0, recipe.settings.pulseIntervalMs),
    );

    let pulsesRun = 0;
    let stopped = false;
    for (let pulse = 0; pulse < pulseCap; pulse += 1) {
      const injections: SimulationEvent[] = [];
      if (pulse > 0 && pulse % config.reviewEveryPulses === 0) {
        const reviewIndex = pulse / config.reviewEveryPulses;
        injections.push(...(recipe.inject?.(reviewIndex) ?? []));
      }
      injections.push(...(recipe.beforePulse?.(pulse) ?? []));
      if (injections.length > 0) {
        await runtime.getEventLog().append(
          simulationId,
          stampHarnessEvents(injections, pulse, recipe.settings.pulseIntervalMs),
        );
      }
      await runtime.runPulse(simulationId);
      pulsesRun += 1;
      const log = await eventRepo.getCommittedThrough(
        simulationId,
        Number.MAX_SAFE_INTEGER,
      );
      if (log.some((event) => event.type === "simulation_stopped")) {
        stopped = true;
        break;
      }
    }

    // Read the arc before the cap cleanup stop, so a cap stop never looks
    // like a goal-ended stop.
    const events = await eventRepo.getCommittedThrough(
      simulationId,
      Number.MAX_SAFE_INTEGER,
    );
    const active = (runtime as unknown as { active?: Map<string, unknown> }).active;
    if (active?.has(simulationId)) {
      await runtime.stop(simulationId);
    }

    return {
      scenarioId: recipe.id,
      mode: recipe.mode,
      config,
      pulseCap,
      pulsesRun,
      capped: !stopped,
      providerCalls: 0,
      llmCalls: 0,
      goalCalls: goalBudget.goalCalls,
      events,
      endConditionLog: recorder.records,
      trajectories: projectTrajectory(events, recorder.records, {
        pulseCap,
        pulsesRun,
      }),
    };
  }
}

/** Pure projection of committed goal events + the recorder log into per-goal
 *  trajectory rows; the evidence shape the sweep artifact is built from. */
export function projectTrajectory(
  events: CommittedEvent[],
  endConditionLog: RecordedEndCondition[],
  run: { pulseCap: number; pulsesRun: number },
): GoalTrajectory[] {
  const rows = new Map<string, GoalTrajectory>();
  const order: string[] = [];

  const rowFor = (goalId: string, agentId: string): GoalTrajectory => {
    let row = rows.get(goalId);
    if (!row) {
      row = {
        goalId,
        agentId,
        proposed: false,
        accepted: false,
        declined: false,
        gapSamples: [],
        termination: "continue",
      };
      rows.set(goalId, row);
      order.push(goalId);
    }
    return row;
  };

  for (const event of events) {
    if (event.type === "goal_proposed") {
      const proposal = event.payload["proposal"] as { id?: string; agentId?: string } | undefined;
      if (proposal?.id) {
        rowFor(proposal.id, proposal.agentId ?? "").proposed = true;
      }
    } else if (event.type === "goal_accepted") {
      const goal = event.payload["goal"] as { id?: string; agentId?: string } | undefined;
      if (goal?.id) rowFor(goal.id, goal.agentId ?? "").accepted = true;
    } else if (event.type === "goal_declined") {
      const proposal = event.payload["proposal"] as { id?: string; agentId?: string } | undefined;
      if (proposal?.id) rowFor(proposal.id, proposal.agentId ?? "").declined = true;
    } else if (event.type === "delusion_gap_sampled") {
      const goalId = event.payload["goalId"];
      const agentId = event.payload["agentId"];
      if (typeof goalId !== "string" || typeof agentId !== "string") continue;
      const at = event.payload["at"];
      const magnitude = event.payload["magnitude"];
      const divergenceFromLog = event.payload["divergenceFromLog"];
      const divergenceFromWorld = event.payload["divergenceFromWorld"];
      if (
        typeof at !== "number" ||
        typeof magnitude !== "number" ||
        typeof divergenceFromLog !== "number" ||
        typeof divergenceFromWorld !== "number"
      ) {
        continue;
      }
      rowFor(goalId, agentId).gapSamples.push({
        at,
        magnitude,
        divergenceFromLog,
        divergenceFromWorld,
      });
    }
  }
  for (const record of endConditionLog) {
    rowFor(record.goalId, record.agentId);
  }

  const stopped = events.find((event) => event.type === "simulation_stopped");
  const endReason = stopped?.payload["endReason"];
  const offer = stopped?.payload["endingOffer"] as EndingOffer | undefined;
  const offerGoalIds =
    endReason === "goal_end_offered" && offer ? new Set([offer.goalId]) : new Set<string>();
  const capped = stopped === undefined && run.pulsesRun >= run.pulseCap;

  const lastRecordByGoal = new Map<string, RecordedEndCondition>();
  for (const record of endConditionLog) {
    lastRecordByGoal.set(record.goalId, record);
  }

  for (const goalId of order) {
    const row = rows.get(goalId)!;
    row.gapSamples.sort((a, b) => a.at - b.at);
    if (offerGoalIds.has(goalId) && offer) {
      row.termination = offer.reasons.some((reason) =>
        reason.includes("progress plateaued"),
      )
        ? "story-is-over"
        : "reached";
    } else if (capped) {
      row.termination = "pulse-cap-stop";
    } else {
      const last = lastRecordByGoal.get(goalId);
      if (last?.kind === "end_offered" && last.offer) {
        row.termination = last.offer.reasons.some((reason) =>
          reason.includes("progress plateaued"),
        )
          ? "story-is-over"
          : "reached";
      } else {
        row.termination =
          last?.kind === "re_goal" ? "re_goal" : "continue";
      }
    }
  }

  return order.map((goalId) => rows.get(goalId)!);
}