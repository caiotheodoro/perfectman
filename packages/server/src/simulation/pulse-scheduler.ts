import { formatStoryClock, type StoryClockConfig } from "./story-clock.js";
import type {
  SpaceMirror,
  ActionEmotions,
  AvailableAction,
  Pressure,
  SpaceView,
  SeededRng,
  Simulation,
  AgentState,
  Channel,
  ChannelMembership,
  SimulationSettings,
  PersonaConfig,
  CommittedEvent,
  ActionIntent,
  SimulationEvent,
  OperatorEvent,
  EngineSnapshot,
  EngineStepResult,
  EndingOffer,
  Memory,
} from "@perfectman/shared";
import { createId, createSeededRng, STAGNATION_WINDOW_PULSES, OWN_HISTORY_LIMIT, HOLD_VOICE_REFRACTORY_PULSES } from "@perfectman/shared";
import { isEngineAuthoredMotive } from "../agent/engine-motive.js";
import {
  runEngineStep,
  computeStagnationMetrics,
  detectAttractorStates,
  filterVisibleEventsForAgent,
  effectiveConfidence,
  shouldEvictMemory,
  MAX_MEMORIES,
} from "@perfectman/engine";
import type { IEventRepository, IAgentStateRepository } from "../persistence/repositories.js";
import type { ChannelRegistry } from "./channel-registry.js";
import type { RateLimitGate } from "./rate-limit-gate.js";
import type { IntentResolver } from "./intent-resolver.js";
import type { EngineSnapshotProjection } from "./projections/engine-snapshot-projection.js";
import type { DeliveryProjection } from "./projections/delivery-projection.js";
import type { SpectatorProjection } from "./projections/spectator-projection.js";
import type { OperatorProjection } from "./projections/operator-projection.js";
import type { EngineEventBuilder } from "./engine-event-builder.js";
import { payloadDisplayFields } from "./payload-readers.js";
import { serializeAgentState } from "../agent/agent-state-serializer.js";
import type {
  ActionIntentOperatorData,
  AttractorDetectedOperatorData,
  EventVisibilityData,
  MemoryReinforcedOperatorData,
  StagnationMetricsOperatorData,
} from "@perfectman/shared";
import { buildAgentRuntimeInput } from "./runtime-input-builder.js";
import { buildWorldSignals } from "./world-signals-builder.js";
import type { AgentRuntimeContext, AgentRuntimeOutput } from "../agent/agent-runtime.types.js";
import type { GoalLayerRuntime } from "./world/world-evaluator.js";
import type { ResolvedIntent } from "./intent-resolver.js";
import type { IRoomSpeechArbiter, OnConsult, PulseMode, PulseReason, RunPulseOptions } from "./hotel-runtime-api.js";
import type { OnAgentCommitted } from "./hotel-options.js";
import { roomIdOfChannel } from "./room-speech-arbiter.js";
import { AgentLocks, GenerateSemaphore, type GeneratePriority } from "./split-pulse-support.js";

/**
 * Intent types that count as an outward social act for the purpose of
 * stamping `AgentState.lastActionAt`. The engine reads that field to grant
 * initiative-accumulator relief on the next pulse (`justActed`); `no_op`,
 * `write_memory`, and typing/lifecycle intents must not trigger it.
 */
const OUTWARD_SOCIAL_ACT_TYPES: ReadonlySet<ActionIntent["intentType"]> = new Set([
  "send_message",
  "reply_to_message",
  "react",
  "create_channel",
]);

export type AgentContext = {
  id: string;
  state: AgentState;
  persona: PersonaConfig;
  /** Scene display name for mention parsing; falls back to `persona.name`. */
  displayName?: string;
  /** `[min, max]` ms the persona takes to answer (presenceProfile.responseDelayMs); read by hotel gateways. */
  responseDelayMs?: [number, number];
};

// Minimal dev1 interface — concrete impl injected
export type AgentRuntime = {
  generateIntent(
    input: import("@perfectman/shared").AgentRuntimeInput,
    context: AgentRuntimeContext
  ): Promise<AgentRuntimeOutput>;
};

export type LLMBudget = {
  getPriority(
    simulationId: string,
    agentId: string,
    opts?: { addressed?: boolean },
  ): import("@perfectman/shared").BudgetPriority;
};

export type PulseSchedulerConfig = {
  simulation: Simulation;
  agents: AgentContext[];
  defaultPublicChannelId: string;
  eventRepo: IEventRepository;
  agentStateRepo: IAgentStateRepository;
  channelRegistry: ChannelRegistry;
  rateLimitGate: RateLimitGate;
  intentResolver: IntentResolver;
  engineSnapshotProjection: EngineSnapshotProjection;
  deliveryProjection: DeliveryProjection;
  spectatorProjection: SpectatorProjection;
  operatorProjection: OperatorProjection;
  engineEventBuilder: EngineEventBuilder;
  agentRuntime: AgentRuntime;
  llmBudget: LLMBudget;
  pulseIntervalMs: number;
  /** Scene clock stamped onto each agent's input; absent when the scene sets none. */
  storyClock?: StoryClockConfig;
  /** Testability seam: defaults to runEngineStep(snapshot). Inject to drive the
   *  commit-ordering pipeline with a known step result without the LLM. */
  stepResolver?: (snapshot: EngineSnapshot) => EngineStepResult;
  /** Optional end-of-pulse world review (goal layer); off when absent. */
  goalLayer?: GoalLayerRuntime;
  /** World-layer ending seam: fired when the review delivers an ending offer. */
  onEndOffered?: (offer: EndingOffer, pulseIndex: number) => Promise<void>;

  // ---- hotel options (ADR-0020, 0021, 0024). Every one is inert when unset. ----
  /** "sequential" (default) is the loop as it always was; "split" is decide / generate / commit with a focus lane. */
  pulseMode?: PulseMode;
  /** Model calls in flight across both lanes; one slot is reserved for addressed replies. Default 3. */
  generateConcurrency?: number;
  /** A generate call that outlives this fails like any provider error. Default 20 000. */
  generateDeadlineMs?: number;
  /** Fires when a generate task takes its slot, just before the model call. */
  onConsult?: OnConsult;
  /** Split mode only: "settle" (default) commits each task as its call settles, "turn" commits in seeded turn order for eval and replay. */
  commitOrder?: "settle" | "turn";
  /** Bounded event reads through `IEventRepository.getWindow` (ADR-0024). */
  windowedReads?: boolean;
  /** Decide-phase checkpoint of the room speech arbiter (ADR-0021). The resolver holds the authoritative gate. */
  arbiter?: IRoomSpeechArbiter;
  /** Where bodies are; each decision reads one `SpaceView` from it (ADR-0018). */
  spaceMirror?: SpaceMirror;
  /** Fires after each agent's intent is resolved and appended; the embodiment planner's seam. */
  onAgentCommitted?: OnAgentCommitted;
  /** Wall clock for the arbiter and the space mirror; injectable for tests. */
  clock?: () => number;
};

export type PulseResult = {
  pulseIndex: number;
  eventsCommitted: number;
  agentsCalled: number;
};

/** Everything one pulse (base or focused) carries from its load to its commits. */
type PulseFrame = {
  sim: Simulation;
  pulseIndex: number;
  now: number;
  dt: number;
  rng: SeededRng;
  reason: PulseReason;
  channels: Channel[];
  membership: ChannelMembership[];
  newEvents: CommittedEvent[];
  contextEvents: CommittedEvent[];
  pulseStartEventId: string | undefined;
  agentStates: Map<string, AgentState>;
  counters: { eventsCommitted: number; agentsCalled: number };
  focusAgentIds?: ReadonlySet<string>;
};

type AgentDecision = {
  agent: AgentContext;
  agentState: AgentState;
  stepResult: EngineStepResult;
  channelAnchorId: string;
  addressed: boolean;
  priority: GeneratePriority;
  space?: SpaceView;
};

type GenerateTask = {
  agent: AgentContext;
  decision: AgentDecision;
  /** The agent's commit counter when it was decided; a different value at slot time means the decision is stale. */
  version: number;
  priority: GeneratePriority;
  turnIndex: number;
};

type DecisionContext = {
  availableActions: AvailableAction[];
  actionEmotions: ActionEmotions;
  pressures: Pressure[];
  channelAnchorId: string;
};

export class PulseScheduler {
  private pulseIndex = 0;
  /** Rolling context limit: how many recent events the LLM sees. */
  private static readonly CONTEXT_WINDOW_PULSES_LIMIT = 40;
  /**
   * Simulated simulation clock (monotonic, ms). Advances pulseIntervalMs per
   * pulse. All emotion/attention/cooldown math uses SIM time — wall clock
   * makes fast bench runs see dt≈0 and saturate every emotion (the moods
   * never spring back to baseline).
   */
  private simTime: number = 0;
  private lastCommittedEventId: string | undefined = undefined;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<PulseResult> | null = null;
  private readonly currentChannelIdByAgent = new Map<string, string>();
  private readonly agentNamesByAgentId: Record<string, string>;

  // ---- split mode state (ADR-0020); unused in sequential mode ----
  /** Focused pulses in flight, beside the single base pulse in `inFlight`. */
  private readonly focusInFlight = new Set<Promise<PulseResult>>();
  private readonly locks = new AgentLocks();
  private readonly semaphore: GenerateSemaphore;
  /** Single writer per agent: the latest committed state, read under the agent's lock. */
  private readonly stateCache = new Map<string, AgentState>();
  /** Bumped on every persist; a task whose version moved while it queued is re-decided. */
  private readonly agentVersion = new Map<string, number>();
  private readonly lastDecisionContext = new Map<string, DecisionContext>();
  private focusSeq = 0;
  private readonly clock: () => number;

  constructor(private readonly config: PulseSchedulerConfig) {
    this.agentNamesByAgentId = Object.fromEntries(
      config.agents.map((agent) => [agent.id, agent.displayName ?? agent.persona.name]),
    );
    this.semaphore = new GenerateSemaphore(config.generateConcurrency ?? 3);
    this.clock = config.clock ?? Date.now;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.runPulse().finally(() => this.scheduleNext());
    }, this.config.pulseIntervalMs);
  }

  getPulseIndex(): number {
    return this.pulseIndex;
  }

  setLastCommittedEventId(eventId: string | undefined): void {
    this.lastCommittedEventId = eventId;
  }

  async runPulse(opts?: RunPulseOptions): Promise<PulseResult> {
    if (this.config.pulseMode === "split") return this.runSplitPulse(opts ?? { reason: "base" });
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.executePulse()
      .catch(async (err) => {
        await this.emitOperatorEvent(this.schedulerError("Pulse failed unexpectedly", err));
        return this.finishPulse(0, 0);
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  /**
   * Resolves when every pulse (base and focused) and every generate task
   * already started has finished. Used by teardown to drain before closing.
   */
  async awaitIdle(): Promise<void> {
    for (;;) {
      const pending = [this.inFlight, ...this.focusInFlight].filter((p): p is Promise<PulseResult> => p !== null);
      if (pending.length === 0) return;
      await Promise.allSettled(pending);
    }
  }

  /** `[min, max]` ms the persona takes to answer (presenceProfile.responseDelayMs), when the cast states one. */
  getResponseDelayMs(agentId: string): [number, number] | undefined {
    return this.config.agents.find((agent) => agent.id === agentId)?.responseDelayMs;
  }

  hasAgent(agentId: string): boolean {
    return this.config.agents.some((agent) => agent.id === agentId);
  }

  /**
   * Hotel: the agent walked into another room, so its default channel (where an
   * unqualified line goes) is that room's channel from now on. Host-appended
   * events do not pass `appendAndProject`, which is where the anchor otherwise follows.
   */
  followToChannel(agentId: string, channelId: string): void {
    this.currentChannelIdByAgent.set(agentId, channelId);
  }

  /**
   * Per-agent pulse order, a pure function of (seed, pulseIndex[, salt]).
   * Later agents in a pulse see earlier agents' commits (the window refresh in
   * the loop), so a fixed config order gave agent 0 a permanent first-mover
   * slot and everyone else a permanent reactor slot. A separate rng stream
   * (seed mixed with the pulse index by a golden-ratio constant) keeps the
   * per-agent snapshot rng values unchanged. A focused pulse passes a salt so
   * its order does not repeat the next base pulse's.
   */
  private turnOrder(seed: number, pulseIndex: number = this.pulseIndex, salt = 0): AgentContext[] {
    const rng = createSeededRng((seed ^ Math.imul(pulseIndex + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0);
    const order = [...this.config.agents];
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.nextInt(i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    return order;
  }

  /**
   * The rolling event window the model's context and the engine's per-agent
   * histories are cut from. Hotel runs ask the repository for a bounded read
   * (ADR-0024); every other run reads the whole log as it always did.
   */
  private async readContextEvents(pulseIndex: number): Promise<CommittedEvent[]> {
    const repo = this.config.eventRepo;
    const simId = this.config.simulation.id;
    if (this.config.windowedReads && repo.getWindow) {
      return repo.getWindow(simId, {
        contextLimit: PulseScheduler.CONTEXT_WINDOW_PULSES_LIMIT,
        ownHistoryLimit: OWN_HISTORY_LIMIT,
        agentIds: this.config.agents.map((agent) => agent.id),
        sincePulseIndex: pulseIndex - Math.max(STAGNATION_WINDOW_PULSES, HOLD_VOICE_REFRACTORY_PULSES),
      });
    }
    return repo.getCommittedThrough(simId, Number.MAX_SAFE_INTEGER);
  }

  private async loadFrame(args: {
    pulseIndex: number;
    now: number;
    dt: number;
    rng: ReturnType<typeof createSeededRng>;
    reason: PulseReason;
    agentStates: Map<string, AgentState>;
    focusAgentIds?: ReadonlySet<string>;
  }): Promise<PulseFrame | null> {
    const sim = this.config.simulation;
    try {
      const channels = await this.config.channelRegistry.getChannels(sim.id);
      const membership = await this.config.channelRegistry.getMembershipsForSimulation(sim.id);
      const newEvents = await this.config.eventRepo.getAfter(sim.id, this.lastCommittedEventId);
      // The model's context is a ROLLING WINDOW, not just this pulse's
      // events — agents reference what was said earlier (docs: short-term
      // memory, "last ~10 conversations"). Seed events (any pulseIndex)
      // stay visible through the room's first pulses.
      const contextEvents = await this.readContextEvents(args.pulseIndex);
      return {
        sim,
        pulseIndex: args.pulseIndex,
        now: args.now,
        dt: args.dt,
        rng: args.rng,
        reason: args.reason,
        channels,
        membership,
        newEvents,
        contextEvents,
        // Snapshot the event cursor before the agent loop so each agent can see
        // events committed by prior agents within this same pulse.
        pulseStartEventId: this.lastCommittedEventId,
        agentStates: args.agentStates,
        counters: { eventsCommitted: 0, agentsCalled: 0 },
        ...(args.focusAgentIds ? { focusAgentIds: args.focusAgentIds } : {}),
      };
    } catch (err) {
      await this.emitOperatorEvent(this.schedulerError("Failed to load pulse context", err));
      return null;
    }
  }

  private async executePulse(): Promise<PulseResult> {
    this.simTime += this.config.pulseIntervalMs;
    const sim = this.config.simulation;

    const agentStates = new Map<string, AgentState>();
    const frame = await this.loadFrame({
      pulseIndex: this.pulseIndex,
      now: this.simTime,
      dt: this.config.pulseIntervalMs / 1000,
      rng: createSeededRng(sim.seed + this.pulseIndex),
      reason: "base",
      agentStates,
    });
    if (!frame) return this.finishPulse(0, 0);

    for (const agent of this.config.agents) {
      try {
        const stored = await this.config.agentStateRepo.get(sim.id, agent.id);
        agentStates.set(agent.id, stored ?? agent.state);
      } catch (err) {
        await this.emitOperatorEvent(this.schedulerError(`Failed to load agent state for ${agent.id}`, err, agent.id));
        agentStates.set(agent.id, agent.state);
      }
    }

    for (const agent of this.turnOrder(sim.seed)) {
      const decision = await this.decideAgent(frame, agent);
      if (decision.stepResult.decision.needsLLM) {
        frame.counters.agentsCalled += 1;
        const runtimeOutput = await this.generateFor(frame, decision, undefined);
        if (runtimeOutput) await this.commitIntent(frame, decision, runtimeOutput);
      }
      await this.persistAndSnapshot(decision.stepResult.updatedAgentState, frame.now);
    }

    await this.finishPulseWork(frame);
    return this.finishPulse(frame.counters.eventsCommitted, frame.counters.agentsCalled);
  }

  // ---- split pulse (ADR-0020) ----------------------------------------------

  private runSplitPulse(opts: RunPulseOptions): Promise<PulseResult> {
    const wrap = (): Promise<PulseResult> =>
      this.executeSplitPulse(opts).catch(async (err) => {
        await this.emitOperatorEvent(this.schedulerError("Pulse failed unexpectedly", err));
        return { pulseIndex: this.pulseIndex, eventsCommitted: 0, agentsCalled: 0 };
      });
    if (opts.focusAgentIds && opts.focusAgentIds.length > 0) {
      // The focus lane never queues behind the base pulse; the per-agent
      // locks are what keep one agent from running twice at once.
      const promise: Promise<PulseResult> = wrap().finally(() => {
        this.focusInFlight.delete(promise);
      });
      this.focusInFlight.add(promise);
      return promise;
    }
    if (this.inFlight) return this.inFlight;
    this.inFlight = wrap().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async currentState(agent: AgentContext): Promise<AgentState> {
    const cached = this.stateCache.get(agent.id);
    if (cached) return cached;
    let state: AgentState;
    try {
      state = (await this.config.agentStateRepo.get(this.config.simulation.id, agent.id)) ?? agent.state;
    } catch (err) {
      await this.emitOperatorEvent(this.schedulerError(`Failed to load agent state for ${agent.id}`, err, agent.id));
      state = agent.state;
    }
    this.stateCache.set(agent.id, state);
    return state;
  }

  private async executeSplitPulse(opts: RunPulseOptions): Promise<PulseResult> {
    const sim = this.config.simulation;
    const focus =
      opts.focusAgentIds && opts.focusAgentIds.length > 0 ? new Set(opts.focusAgentIds) : undefined;
    const elapsedMs = opts.elapsedMs ?? this.config.pulseIntervalMs;
    // A focused pulse ages the simulation by real elapsed time but is not a
    // pulse: pulseIndex, stagnation and goal review stay on the base cadence.
    this.simTime += elapsedMs;
    const pulseIndex = this.pulseIndex;
    const salt = focus ? ++this.focusSeq : 0;
    const agentStates = new Map<string, AgentState>();
    for (const agent of this.config.agents) agentStates.set(agent.id, await this.currentState(agent));
    const frame = await this.loadFrame({
      pulseIndex,
      now: this.simTime,
      dt: elapsedMs / 1000,
      rng: createSeededRng(sim.seed + pulseIndex + Math.imul(salt, 100_003)),
      reason: opts.reason,
      agentStates,
      ...(focus ? { focusAgentIds: focus } : {}),
    });
    if (!frame) return { pulseIndex, eventsCommitted: 0, agentsCalled: 0 };

    // Phase A: decide, sequential in turn order, pure engine plus engine events.
    const tasks: GenerateTask[] = [];
    const turnMode = this.config.commitOrder === "turn";
    for (const agent of this.turnOrder(sim.seed, pulseIndex, salt)) {
      if (focus && !focus.has(agent.id)) continue;
      // A base pulse skips an agent mid-call; a focused pulse waits for that
      // one call (the addressee may be generating for an ambient reason).
      if (!focus && this.locks.isLocked(agent.id)) continue;
      const release = await this.locks.acquire(agent.id);
      let decision: AgentDecision;
      try {
        frame.agentStates.set(agent.id, await this.currentState(agent));
        decision = await this.decideAgent(frame, agent);
        if (!decision.stepResult.decision.needsLLM || this.previewBlocked(frame, decision)) {
          await this.persistAndSnapshot(decision.stepResult.updatedAgentState, frame.now);
          continue;
        }
      } finally {
        release();
      }
      tasks.push({
        agent,
        decision,
        version: this.agentVersion.get(agent.id) ?? 0,
        priority: turnMode ? 1 : decision.priority,
        turnIndex: tasks.length,
      });
    }
    // The next base pulse's index applies from here on, so lines ingested and
    // focused pulses started while this one generates are stamped with it.
    if (!focus) this.pulseIndex += 1;

    // Phases B and C: generate with bounded concurrency; commit per task as
    // its call settles (live) or in turn order (eval / replay).
    const turnGate: Array<Promise<void>> = [];
    await Promise.all(
      tasks.map((task, i) => {
        const prior = i > 0 ? turnGate[i - 1]! : Promise.resolve();
        const done = this.runGenerateTask(frame, task, turnMode ? prior : undefined);
        turnGate.push(done.catch(() => undefined));
        return done;
      }),
    );

    if (!focus) await this.finishPulseWork(frame);
    return {
      pulseIndex: focus ? this.pulseIndex : frame.pulseIndex,
      eventsCommitted: frame.counters.eventsCommitted,
      agentsCalled: frame.counters.agentsCalled,
    };
  }

  /** ADR-0021 decision phase: skip the model call for a non-addressed agent the arbiter would block anyway. */
  private previewBlocked(frame: PulseFrame, decision: AgentDecision): boolean {
    const arbiter = this.config.arbiter;
    if (!arbiter || decision.addressed) return false;
    const roomId = roomIdOfChannel(decision.channelAnchorId);
    if (roomId === undefined) return false;
    return arbiter.preview(decision.agent.id, roomId, this.clock()).outcome === "blocked";
  }

  private async runGenerateTask(frame: PulseFrame, task: GenerateTask, afterTurn: Promise<void> | undefined): Promise<void> {
    const releaseSlot = await this.semaphore.acquire(task.priority);
    try {
      const releaseLock = await this.locks.acquire(task.agent.id);
      try {
        let decision = task.decision;
        if ((this.agentVersion.get(task.agent.id) ?? 0) !== task.version) {
          // Another lane committed for this agent while the task waited for a
          // slot: its decision was cut from state that no longer exists.
          const fresh = await this.redecide(frame, task.agent);
          if (!fresh) return;
          decision = fresh;
        }
        frame.counters.agentsCalled += 1;
        this.config.onConsult?.({
          agentId: task.agent.id,
          reason: frame.reason,
          addressed: decision.addressed,
        });
        const runtimeOutput = await this.generateFor(frame, decision, this.config.generateDeadlineMs ?? 20_000);
        if (afterTurn) await afterTurn;
        if (runtimeOutput) await this.commitIntent(frame, decision, runtimeOutput);
        await this.persistAndSnapshot(decision.stepResult.updatedAgentState, frame.now);
      } finally {
        releaseLock();
      }
    } finally {
      releaseSlot();
    }
  }

  /** Under the agent's lock: decide again on fresh state. Returns undefined when no model call is needed any more. */
  private async redecide(frame: PulseFrame, agent: AgentContext): Promise<AgentDecision | undefined> {
    const fresh = await this.loadFrame({
      pulseIndex: frame.pulseIndex,
      now: frame.now,
      dt: frame.dt,
      rng: frame.rng,
      reason: frame.reason,
      agentStates: frame.agentStates,
      ...(frame.focusAgentIds ? { focusAgentIds: frame.focusAgentIds } : {}),
    });
    if (!fresh) return undefined;
    fresh.counters = frame.counters;
    fresh.agentStates.set(agent.id, await this.currentState(agent));
    const decision = await this.decideAgent(fresh, agent);
    if (!decision.stepResult.decision.needsLLM || this.previewBlocked(fresh, decision)) {
      await this.persistAndSnapshot(decision.stepResult.updatedAgentState, frame.now);
      return undefined;
    }
    return decision;
  }

  /** Decide phase for one agent: snapshot, pure engine step, engine events, reinforcement. */
  private async decideAgent(frame: PulseFrame, agent: AgentContext): Promise<AgentDecision> {
    const sim = frame.sim;
    const { pulseIndex, now, dt, rng, channels, membership, contextEvents } = frame;
    // Refresh event window so this agent sees actions taken by prior agents this pulse.
    try {
      frame.newEvents = await this.config.eventRepo.getAfter(sim.id, frame.pulseStartEventId);
    } catch {
      // Keep the stale newEvents from pulse start — non-fatal
    }
    const newEvents = frame.newEvents;

    const agentState = frame.agentStates.get(agent.id) ?? agent.state;
    const rateLimitStatus = this.config.rateLimitGate.getStatus(agent.id);

    const channelAnchorId =
      this.currentChannelIdByAgent.get(agent.id) ?? this.config.defaultPublicChannelId;

    const worldSignals = buildWorldSignals(
      newEvents,
      frame.agentStates,
      agent.id,
      channelAnchorId,
      membership,
    );

    const space = this.config.spaceMirror?.view(agent.id, this.clock());
    const snapshot = this.config.engineSnapshotProjection.build({
      pulseIndex,
      simulation: sim,
      // Operator-only events (motives, memory writes, no-op records) can
      // never reach an agent, so they must not consume slots in the
      // rolling window the agent's context is cut from — with one
      // private_motive_summary per resolved intent they would otherwise
      // halve how far back the room can remember.
      recentEventsWindow: contextEvents
        .filter((event) => event.visibility.visibilityReason !== "operator_only")
        .slice(-PulseScheduler.CONTEXT_WINDOW_PULSES_LIMIT),
      // The agent's own recent messages from the whole log: the shared
      // window is the wrong source for a per-agent repetition memory.
      ownHistoryWindow: contextEvents
        .filter(
          (event) =>
            event.actorId === agent.id &&
            (event.type === "message_sent" || event.type === "reply_sent"),
        )
        .slice(-OWN_HISTORY_LIMIT),
      // ADR-0017: a model-voiced hold (a no_op the model chose, with its own
      // motive) within the refractory window means no consult this pulse.
      voicedHoldRecently: contextEvents.some(
        (event) =>
          event.actorId === agent.id &&
          event.type === "no_op_recorded" &&
          event.sourceIntentId !== undefined &&
          pulseIndex - event.pulseIndex <= HOLD_VOICE_REFRACTORY_PULSES &&
          typeof (event.payload as { privateMotiveSummary?: unknown }).privateMotiveSummary === "string" &&
          !isEngineAuthoredMotive((event.payload as { privateMotiveSummary: string }).privateMotiveSummary),
      ),
      now,
      agentState,
      persona: agent.persona,
      channels,
      membership,
      relationalStates: agentState.relationalStates,
      worldSignals,
      rateLimitStatus,
      dt,
      rng,
      ...(space ? { space } : {}),
    });

    const stepResult = this.config.stepResolver
      ? this.config.stepResolver(snapshot)
      : runEngineStep(snapshot);

    // Commit engine-emitted events before LLM path
    const engineEvents = this.config.engineEventBuilder.fromStepResult(stepResult, {
      simulationId: sim.id,
      agentId: agent.id,
      channelId: channelAnchorId,
      pulseIndex,
    });

    if (engineEvents.length > 0) {
      const committed = await this.appendAndProject(engineEvents, channels, membership);
      frame.counters.eventsCommitted += committed.length;
      this.applyMemoryProjection(committed, stepResult.updatedAgentState, now);
    }

    // Reinforcement (testing effect): every memory this pulse's selection
    // surfaced gets its decay clock reset, regardless of whether the
    // perception packet goes on to an LLM call.
    await this.applyMemoryReinforcement(
      stepResult.perceptionPacket.relevantMemories ?? [],
      stepResult.updatedAgentState,
      now,
    );

    // Only the split pulse reads these (arbiter exemption, budget priority,
    // slot ordering); the sequential loop never looks at them.
    const reasons = stepResult.attentionResults?.reasons ?? [];
    const addressed =
      (frame.reason === "human_chat" && frame.focusAgentIds?.has(agent.id) === true) ||
      reasons.includes("direct_mention") ||
      reasons.includes("reply_to_self");
    const priority: GeneratePriority = addressed
      ? 0
      : stepResult.attentionResults?.triggeringEventId !== undefined
        ? 1
        : 2;

    this.lastDecisionContext.set(agent.id, {
      availableActions: stepResult.availableActions,
      actionEmotions: stepResult.actionEmotions,
      pressures: stepResult.pressures,
      channelAnchorId,
    });

    return { agent, agentState, stepResult, channelAnchorId, addressed, priority, ...(space ? { space } : {}) };
  }

  /**
   * Generate phase for one agent. A provider throw or a missed deadline is
   * recorded as an `llm_failure` and yields no output (the caller still
   * persists state), the same failure path as before.
   */
  private async generateFor(
    frame: PulseFrame,
    decision: AgentDecision,
    deadlineMs: number | undefined,
  ): Promise<AgentRuntimeOutput | null> {
    const { agent, stepResult, channelAnchorId } = decision;
    const sim = frame.sim;
    const budgetPriority =
      this.config.pulseMode === "split" && decision.addressed
        ? this.config.llmBudget.getPriority(sim.id, agent.id, { addressed: true })
        : this.config.llmBudget.getPriority(sim.id, agent.id);
    const runtimeInput = buildAgentRuntimeInput(stepResult, agent.persona, budgetPriority);
    if (this.config.storyClock) {
      runtimeInput.storyClock = formatStoryClock(this.config.storyClock, frame.pulseIndex);
    }
    const call = this.config.agentRuntime.generateIntent(runtimeInput, {
      pulseIndex: frame.pulseIndex,
      now: frame.now,
    });
    const guarded = deadlineMs === undefined ? call : this.withDeadline(call, deadlineMs);
    return guarded.catch(async (err) => {
      const failureEvent = this.llmFailureEvent(agent.id, channelAnchorId, err, frame.pulseIndex);
      frame.counters.eventsCommitted += (
        await this.appendAndProject([failureEvent], frame.channels, frame.membership)
      ).length;
      return null;
    });
  }

  private withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`generateIntent exceeded its ${ms} ms deadline`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  /** Commit phase for one agent: resolve, append, project, apply memory, stamp the outward act. */
  private async commitIntent(
    frame: PulseFrame,
    decision: AgentDecision,
    runtimeOutput: AgentRuntimeOutput,
  ): Promise<void> {
    const { agent, stepResult, agentState, channelAnchorId } = decision;
    const sim = frame.sim;
    const { channels, membership, now } = frame;

    const resolved = await this.config.intentResolver.resolve(runtimeOutput.intent, {
      simulationId: sim.id,
      channelId: channelAnchorId,
      pulseIndex: frame.pulseIndex,
      agentState,
      availableActions: stepResult.availableActions,
      channels,
      membership,
      settings: sim.settings,
      actionEmotions: stepResult.actionEmotions,
      agentNames: this.agentNamesByAgentId,
      ...(stepResult.decision.holdSuggested === true ? { holdSuggested: true } : {}),
      ...(decision.space ? { space: decision.space } : {}),
      ...(stepResult.perceptionPacket.bodyHandles ? { bodyHandles: stepResult.perceptionPacket.bodyHandles } : {}),
      ...(runtimeOutput.bodyDropped ? { bodyDropped: runtimeOutput.bodyDropped } : {}),
    }).catch(async (err) => {
      await this.emitOperatorEvent(this.schedulerError("Intent resolver failed", err, agent.id));
      return null;
    });

    if (!resolved) return;

    const intent = runtimeOutput.intent;
    const intentData: ActionIntentOperatorData = {
      intentId: intent.id,
      intentType: intent.intentType,
      ...(intent.visibleContent !== undefined ? { visibleContent: intent.visibleContent } : {}),
      privateMotiveSummary: intent.privateMotiveSummary,
      emotionDrivers: intent.emotionDrivers ?? [],
      motivationDrivers: intent.motivationDrivers ?? [],
    };
    await this.emitOperatorEvent({
      type: "action_intent",
      simulationId: sim.id,
      agentId: agent.id,
      pulseIndex: frame.pulseIndex,
      detail: `Action intent: ${intent.intentType}`,
      data: intentData,
      createdAt: Date.now(),
    });

    let committedByResolution: CommittedEvent[] = [];
    if (resolved.committedEvents.length > 0) {
      committedByResolution = await this.appendAndProject(resolved.committedEvents, channels, membership);
      frame.counters.eventsCommitted += committedByResolution.length;
      this.applyMemoryProjection(committedByResolution, stepResult.updatedAgentState, now);
    }

    for (const opEv of [...resolved.operatorEvents, ...runtimeOutput.operatorEvents]) {
      await this.emitOperatorEvent(opEv);
    }

    if (this.config.onAgentCommitted) {
      try {
        this.config.onAgentCommitted({
          simulationId: sim.id,
          agentId: agent.id,
          reason: frame.reason,
          pulseIndex: frame.pulseIndex,
          intent,
          outcome: resolved.outcome,
          committedEvents: committedByResolution,
          ...(resolved.body ? { body: resolved.body } : {}),
          ...(decision.space ? { space: decision.space } : {}),
          agentState: stepResult.updatedAgentState,
        });
      } catch (err) {
        await this.emitOperatorEvent(this.schedulerError("onAgentCommitted failed", err, agent.id));
      }
    }

    // Stamp lastActionAt when the act that actually committed is an
    // outward social act. On fallback_committed the primary intent was
    // blocked and the fallback ran, so fallbackIfBlocked is what landed.
    const committedActType =
      resolved.outcome === "committed"
        ? intent.intentType
        : resolved.outcome === "fallback_committed"
          ? intent.fallbackIfBlocked
          : undefined;
    // A no_op with `runtimeOutput.fallbackApplied` is not a genuine "I
    // choose silence" decision — the agent's real intent attempt failed
    // (repetition guard, malformed/truncated JSON, an unresolved target,
    // a provider retry) and IntentParser substituted it. Without this,
    // the agent never gets justActed relief, her decay-exempt
    // cold_start_bootstrap accumulator saturates and never comes back
    // down, and scoreAttention's cooldown-blind cadence score then forces
    // needsLLM every subsequent pulse forever — a real production
    // lockup, root-caused via two separate live captures (a repetition
    // guard block, then independently a "No JSON object found in
    // response" parse failure) that both monopolized every pulse after
    // the affected agent's first blocked turn. `fallbackApplied` is the
    // general signal IntentParser already computes for exactly this
    // distinction — prefer it over pattern-matching specific fallback
    // reasons.
    const attemptedRealAct = resolved.outcome === "committed" && runtimeOutput.fallbackApplied;
    if ((committedActType && OUTWARD_SOCIAL_ACT_TYPES.has(committedActType)) || attemptedRealAct) {
      stepResult.updatedAgentState.lastActionAt = now;
      // Pressure discharge (ADR-0016): every urge felt when the act was
      // chosen is spent by it — not only the top one, since a hot
      // persona feels provoke/dominate/show_off together and discharging
      // one would just hand the turn to the next.
      const discharged = { ...(stepResult.updatedAgentState.pressureDischargedAt ?? {}) };
      for (const pressure of stepResult.pressures) {
        // ADR-0017: the private-channel drive is spent only by opening a
        // channel. Spending it on every public line is why the engine
        // arms opened 0–3 private rooms where the baseline opened 6–12.
        if (pressure.type === "urge_to_create_private_channel" && committedActType !== "create_channel") continue;
        discharged[pressure.type] = frame.pulseIndex;
      }
      stepResult.updatedAgentState.pressureDischargedAt = discharged;
    }
  }

  /**
   * Re-submit a held intent (a speech line deferred until its speaker arrived)
   * through the normal resolver, so the arbiter and the rate gate still
   * apply (ADR-0019). Uses the context cached at the agent's last decision.
   */
  async resolveDeferred(agentId: string, intent: ActionIntent): Promise<ResolvedIntent> {
    const agent = this.config.agents.find((a) => a.id === agentId);
    const context = this.lastDecisionContext.get(agentId);
    if (!agent || !context) throw new Error(`No decision context for agent ${agentId}`);
    const release = await this.locks.acquire(agentId);
    try {
      const sim = this.config.simulation;
      const channels = await this.config.channelRegistry.getChannels(sim.id);
      const membership = await this.config.channelRegistry.getMembershipsForSimulation(sim.id);
      const agentState = await this.currentState(agent);
      const resolved = await this.config.intentResolver.resolve(intent, {
        simulationId: sim.id,
        channelId: this.currentChannelIdByAgent.get(agentId) ?? context.channelAnchorId,
        pulseIndex: this.pulseIndex,
        agentState,
        availableActions: context.availableActions,
        channels,
        membership,
        settings: sim.settings,
        actionEmotions: context.actionEmotions,
        agentNames: this.agentNamesByAgentId,
      });
      if (resolved.committedEvents.length > 0) {
        const committed = await this.appendAndProject(resolved.committedEvents, channels, membership);
        this.applyMemoryProjection(committed, agentState, this.simTime);
      }
      for (const opEv of resolved.operatorEvents) await this.emitOperatorEvent(opEv);
      const landed =
        resolved.outcome === "committed"
          ? intent.intentType
          : resolved.outcome === "fallback_committed"
            ? intent.fallbackIfBlocked
            : undefined;
      if (landed && OUTWARD_SOCIAL_ACT_TYPES.has(landed)) {
        agentState.lastActionAt = this.simTime;
        const discharged = { ...(agentState.pressureDischargedAt ?? {}) };
        for (const pressure of context.pressures) {
          if (pressure.type === "urge_to_create_private_channel" && landed !== "create_channel") continue;
          discharged[pressure.type] = this.pulseIndex;
        }
        agentState.pressureDischargedAt = discharged;
      }
      await this.persistAndSnapshot(agentState, this.simTime);
      return resolved;
    } finally {
      release();
    }
  }

  /** End-of-base-pulse work: stagnation metrics every 10 pulses, then the goal-layer review. */
  private async finishPulseWork(frame: PulseFrame): Promise<void> {
    const sim = frame.sim;
    const { channels, membership, pulseIndex, now } = frame;

    // Every 10 pulses: compute stagnation metrics
    if (pulseIndex > 0 && pulseIndex % 10 === 0) {
      const windowFloor = pulseIndex - STAGNATION_WINDOW_PULSES;
      let recentEvents: CommittedEvent[];
      if (this.config.windowedReads && this.config.eventRepo.getWindow) {
        const windowed = await this.config.eventRepo.getWindow(sim.id, {
          contextLimit: 0,
          ownHistoryLimit: 0,
          agentIds: [],
          sincePulseIndex: windowFloor + 1,
        });
        recentEvents = windowed.filter((e) => e.pulseIndex > windowFloor && e.pulseIndex <= pulseIndex);
      } else {
        const committedThrough = await this.config.eventRepo.getCommittedThrough(sim.id, pulseIndex);
        recentEvents = committedThrough.filter((e) => e.pulseIndex > windowFloor);
      }
      const agentStatesMap = new Map<string, AgentState>();
      for (const agent of this.config.agents) {
        const stored = await this.config.agentStateRepo.get(sim.id, agent.id);
        if (stored) agentStatesMap.set(agent.id, stored);
      }
      const metrics = computeStagnationMetrics(sim.id, pulseIndex, recentEvents, agentStatesMap);

      const metricsData: StagnationMetricsOperatorData = {
        simulationId: metrics.simulationId,
        pulseIndex: metrics.pulseIndex,
        bdi: metrics.bdi,
        rdv: metrics.rdv,
        ige: metrics.ige,
        cue: metrics.cue,
        eri: metrics.eri,
        isd: metrics.isd,
        cns: metrics.cns,
        compositeScore: metrics.compositeScore,
        level: metrics.level,
      };
      await this.emitOperatorEvent({
        type: "stagnation_metrics",
        simulationId: sim.id,
        agentId: "system",
        pulseIndex,
        detail: `Stagnation metrics: ${metrics.level} (${metrics.compositeScore.toFixed(3)})`,
        data: metricsData,
        createdAt: Date.now(),
      });

      for (const signature of detectAttractorStates(recentEvents, agentStatesMap)) {
        const attractorData: AttractorDetectedOperatorData = { signature };
        await this.emitOperatorEvent({
          type: "attractor_detected",
          simulationId: sim.id,
          agentId: "system",
          pulseIndex,
          detail: `Attractor state detected: ${signature}`,
          data: attractorData,
          createdAt: Date.now(),
        });
      }

      if (metrics.level !== "normal") {
        const stagnationEvent = this.config.engineEventBuilder.fromStagnation(metrics, {
          simulationId: sim.id,
          agentId: "system",
          channelId: this.config.defaultPublicChannelId,
          pulseIndex,
        });
        if (stagnationEvent) {
          frame.counters.eventsCommitted += (await this.appendAndProject([stagnationEvent], channels, membership)).length;
        }
      }
    }

    // Goal-layer world review on the configured cadence, after the agent loop
    // so it reads this pulse's committed state (stagnation's slot).
    if (
      pulseIndex > 0 &&
      this.config.goalLayer &&
      pulseIndex % this.config.goalLayer.config.reviewEveryPulses === 0
    ) {
      try {
        const review = await this.config.goalLayer.evaluator.runReview({
          simulation: sim,
          agents: this.config.agents.map((agent) => ({ id: agent.id, state: agent.state })),
          pulseIndex,
          now,
        });
        if (review.events.length > 0) {
          const committed = await this.appendAndProject(review.events, channels, membership);
          frame.counters.eventsCommitted += committed.length;
          // The ending offer fires only after its events actually commit: a
          // failed append leaves the offer pending for the next review.
          if (committed.length > 0 && review.endingOffer) {
            await this.config.onEndOffered?.(review.endingOffer, pulseIndex);
          }
        } else if (review.endingOffer) {
          await this.config.onEndOffered?.(review.endingOffer, pulseIndex);
        }
        // World-layer operator events ride the same channel as the agent
        // loop's: goal-path failures stay observable without entering the
        // committed log the crystallizer reads.
        for (const opEv of review.operatorEvents) {
          await this.emitOperatorEvent(opEv);
        }
        // Write-through on every review, committed or not: the junction can
        // mutate on candidate-less/zero-commit reviews. Contained — a persist
        // failure degrades restart to replay-only, never fails the pulse.
        try {
          await this.config.goalLayer.evaluator.persistRegistryState(sim.id);
        } catch (err) {
          await this.emitOperatorEvent(this.schedulerError("Registry persist failed", err));
        }
      } catch (err) {
        await this.emitOperatorEvent(this.schedulerError("World review failed", err));
      }
    }
  }

  private finishPulse(eventsCommitted: number, agentsCalled: number): PulseResult {
    const result: PulseResult = { pulseIndex: this.pulseIndex, eventsCommitted, agentsCalled };
    this.pulseIndex += 1;
    return result;
  }

  private async appendAndProject(
    events: SimulationEvent[],
    channels: Channel[],
    membership: ChannelMembership[],
  ): Promise<CommittedEvent[]> {
    let committed: CommittedEvent[];
    try {
      committed = await this.config.eventRepo.append(this.config.simulation.id, events);
    } catch (err) {
      await this.emitOperatorEvent(this.schedulerError("Failed to append events", err));
      return [];
    }

    for (const ev of committed) {
      this.lastCommittedEventId = ev.id;
      this.updateCurrentChannelAnchors(ev);
      await this.projectCommittedEvent(ev, channels, membership);
      await this.emitEventVisibility(ev);
    }

    return committed;
  }

  /**
   * Copies committed `memory_written` events into the acting agent's state.
   * Mutates `updatedAgentState` in place — same-pulse `persistAndSnapshot` is
   * the single write point, and a failed append never reaches here because
   * only returned (committed) events are passed in.
   *
   * Both timestamps are stamped from the simulated clock (`now`), not from
   * `event.createdAt`. Committed events carry wall-clock time; decay,
   * reinforcement and eviction all measure age in pulses off `simTime`, so a
   * wall-clock stamp would put every memory ~1.7e12 ms in the future of the
   * clock reading it and nothing would ever age.
   */
  private applyMemoryProjection(committed: CommittedEvent[], agentState: AgentState, now: number): void {
    for (const event of committed) {
      if (event.type !== "memory_written") continue;
      agentState.memories.push({
        id: createId(),
        agentId: event.actorId,
        simulationId: event.simulationId,
        type: event.payload["memoryType"] as Memory["type"],
        subjectAgentIds: event.payload["subjectAgentIds"] as string[],
        sourceEventIds: [event.id],
        summary: event.payload["summary"] as string,
        emotionalTone: event.payload["emotionalTone"] as string,
        confidence: event.payload["confidence"] as number,
        intensity: event.payload["intensity"] as number,
        unresolved: event.payload["unresolved"] as boolean,
        createdAt: now,
        lastReinforcedAt: now,
      });
    }
  }

  /**
   * Reinforcement (testing effect): a memory surfaced by this pulse's memory
   * selection gets its decay clock (`lastReinforcedAt`) reset to `now`, and a
   * `memory_reinforced` operator event is emitted per surfaced memory. Mutates
   * `agentState.memories` in place — same single-write-point rationale as
   * `applyMemoryProjection`.
   */
  private async applyMemoryReinforcement(
    surfacedMemories: readonly Memory[],
    agentState: AgentState,
    now: number,
  ): Promise<void> {
    for (const surfaced of surfacedMemories) {
      const stored = agentState.memories.find((m) => m.id === surfaced.id);
      if (!stored) continue;
      stored.lastReinforcedAt = now;
      const data: MemoryReinforcedOperatorData = { memoryId: stored.id, memoryType: stored.type };
      await this.emitOperatorEvent({
        type: "memory_reinforced",
        simulationId: agentState.simulationId,
        agentId: agentState.agentId,
        pulseIndex: this.pulseIndex,
        detail: `Memory reinforced: ${stored.type}`,
        data,
        createdAt: Date.now(),
      });
    }
  }

  /**
   * Eviction pass over an agent's memory store, run right before persistence
   * so every pulse's write reflects a decayed-and-capped store regardless of
   * which code path produced this pulse's `agentState` (LLM failure, resolver
   * failure, or the full commit path all funnel through `persistAndSnapshot`).
   * Drops faded, stale, non-open-loop memories first (`shouldEvictMemory`),
   * then applies the `MAX_MEMORIES` backstop by strength if still over.
   */
  private applyMemoryEviction(agentState: AgentState, now: number): void {
    const pulseIntervalMs = this.config.pulseIntervalMs;
    agentState.memories = agentState.memories.filter(
      (m) => !shouldEvictMemory(m, now, pulseIntervalMs),
    );
    if (agentState.memories.length > MAX_MEMORIES) {
      agentState.memories = [...agentState.memories]
        .sort((a, b) => effectiveConfidence(b, now, pulseIntervalMs) - effectiveConfidence(a, now, pulseIntervalMs))
        .slice(0, MAX_MEMORIES);
    }
  }

  private async emitEventVisibility(event: CommittedEvent): Promise<void> {
    const data: EventVisibilityData = {
      eventId: event.id,
      eventType: event.type,
      actorId: event.actorId,
      channelId: event.channelId,
      visibleToAgents: event.visibility.visibleToAgents,
      ...payloadDisplayFields(event.payload),
    };
    await this.emitOperatorEvent({
      type: "event_visibility",
      simulationId: event.simulationId,
      agentId: event.actorId,
      pulseIndex: event.pulseIndex,
      detail: `Event visibility: ${event.type}`,
      data,
      createdAt: Date.now(),
    });
  }

  private async projectCommittedEvent(
    event: CommittedEvent,
    channels: Channel[],
    membership: ChannelMembership[],
  ): Promise<void> {
    const settings = this.config.simulation.settings;
    try {
      await this.config.deliveryProjection.project(event, channels, membership, settings);
    } catch (err) {
      await this.emitOperatorEvent(this.schedulerError("Delivery projection failed", err, event.actorId, event.id));
    }
    try {
      await this.config.spectatorProjection.project(event, channels, settings);
    } catch (err) {
      await this.emitOperatorEvent(this.schedulerError("Spectator projection failed", err, event.actorId, event.id));
    }
    try {
      await this.config.operatorProjection.project(event, settings);
    } catch {
      // Nothing else can report an operator gateway failure without risking another throw.
    }
  }

  private async persistAndSnapshot(agentState: AgentState, now: number): Promise<void> {
    this.applyMemoryEviction(agentState, now);
    this.stateCache.set(agentState.agentId, agentState);
    this.agentVersion.set(agentState.agentId, (this.agentVersion.get(agentState.agentId) ?? 0) + 1);
    try {
      await this.config.agentStateRepo.upsert(agentState);
    } catch (err) {
      await this.emitOperatorEvent(this.schedulerError("Failed to persist agent state", err, agentState.agentId));
    }
    await this.emitOperatorEvent({
      type: "agent_state_snapshot",
      simulationId: this.config.simulation.id,
      agentId: agentState.agentId,
      pulseIndex: this.pulseIndex,
      detail: "Agent state snapshot",
      data: { state: serializeAgentState(agentState) },
      createdAt: Date.now(),
    });
  }

  private async emitOperatorEvent(event: OperatorEvent): Promise<void> {
    try {
      await this.config.operatorProjection.emit(event);
    } catch {
      // Operator delivery is best-effort; runPulse must not reject.
    }
  }

  private schedulerError(detail: string, err: unknown, agentId?: string, eventId?: string): OperatorEvent {
    const data: NonNullable<OperatorEvent["data"]> = { reason: this.errorReason(err) };
    if (eventId !== undefined) {
      data["eventId"] = eventId;
    }

    return {
      type: "scheduler_error",
      simulationId: this.config.simulation.id,
      agentId,
      pulseIndex: this.pulseIndex,
      detail,
      data,
      createdAt: Date.now(),
    };
  }

  private llmFailureEvent(
    agentId: string,
    channelId: string,
    err: unknown,
    pulseIndex: number = this.pulseIndex,
  ): SimulationEvent {
    return {
      simulationId: this.config.simulation.id,
      channelId,
      actorId: agentId,
      type: "llm_failure",
      // `stage` lets the circuit breaker count a call that threw out of
      // `generateIntent` (or missed its deadline) before the step produced an
      // `action_intent`; those never reach it any other way.
      payload: { reason: this.errorReason(err), stage: "generate" },
      sourceEventIds: [],
      emotionalSalience: "low",
      pulseIndex,
      visibility: {
        visibleToAgents: [],
        visibleToSpectators: false,
        visibleToOperators: true,
        visibilityReason: "operator_only",
      },
    };
  }

  private errorReason(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private updateCurrentChannelAnchors(event: CommittedEvent): void {
    switch (event.type) {
      case "message_sent":
      case "reply_sent":
      case "reaction_sent":
      case "typing_started":
      case "typing_cancelled":
      case "channel_created":
        this.currentChannelIdByAgent.set(event.actorId, event.channelId);
        break;
      case "agent_invited": {
        const invitedAgentId = event.payload["invitedAgentId"];
        if (typeof invitedAgentId === "string" && invitedAgentId.length > 0) {
          this.currentChannelIdByAgent.set(invitedAgentId, event.channelId);
        }
        this.currentChannelIdByAgent.set(event.actorId, event.channelId);
        break;
      }
      case "moved_room":
        // Hotel (ADR-0018): the event is committed on the destination room's
        // channel, so the actor's default channel follows it through the door.
        this.currentChannelIdByAgent.set(event.actorId, event.channelId);
        break;
      case "agent_left":
        if (this.currentChannelIdByAgent.get(event.actorId) === event.channelId) {
          this.currentChannelIdByAgent.delete(event.actorId);
        }
        break;
      default:
        break;
    }
  }
}
