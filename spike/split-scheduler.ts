// SPIKE FORK of packages/server/src/simulation/pulse-scheduler.ts implementing the ADR-0020 split.
// Throwaway: stagnation/goal-review omitted. Do not ship.
import { formatStoryClock, type StoryClockConfig } from "../packages/server/src/simulation/story-clock.js";
import type {
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
import { isEngineAuthoredMotive } from "../packages/server/src/agent/engine-motive.js";
import {
  runEngineStep,
  computeStagnationMetrics,
  detectAttractorStates,
  filterVisibleEventsForAgent,
  effectiveConfidence,
  shouldEvictMemory,
  MAX_MEMORIES,
} from "@perfectman/engine";
import type { IEventRepository, IAgentStateRepository } from "../packages/server/src/persistence/repositories.js";
import type { ChannelRegistry } from "../packages/server/src/simulation/channel-registry.js";
import type { RateLimitGate } from "../packages/server/src/simulation/rate-limit-gate.js";
import type { IntentResolver } from "../packages/server/src/simulation/intent-resolver.js";
import type { EngineSnapshotProjection } from "../packages/server/src/simulation/projections/engine-snapshot-projection.js";
import type { DeliveryProjection } from "../packages/server/src/simulation/projections/delivery-projection.js";
import type { SpectatorProjection } from "../packages/server/src/simulation/projections/spectator-projection.js";
import type { OperatorProjection } from "../packages/server/src/simulation/projections/operator-projection.js";
import type { EngineEventBuilder } from "../packages/server/src/simulation/engine-event-builder.js";
import { payloadDisplayFields } from "../packages/server/src/simulation/payload-readers.js";
import { serializeAgentState } from "../packages/server/src/agent/agent-state-serializer.js";
import type {
  ActionIntentOperatorData,
  AttractorDetectedOperatorData,
  EventVisibilityData,
  MemoryReinforcedOperatorData,
  StagnationMetricsOperatorData,
} from "@perfectman/shared";
import { buildAgentRuntimeInput } from "../packages/server/src/simulation/runtime-input-builder.js";
import { buildWorldSignals } from "../packages/server/src/simulation/world-signals-builder.js";
import type { AgentRuntimeContext, AgentRuntimeOutput } from "../packages/server/src/agent/agent-runtime.types.js";
import type { GoalLayerRuntime } from "../packages/server/src/simulation/world/world-evaluator.js";

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
};

// Minimal dev1 interface — concrete impl injected
export type AgentRuntime = {
  generateIntent(
    input: import("@perfectman/shared").AgentRuntimeInput,
    context: AgentRuntimeContext
  ): Promise<AgentRuntimeOutput>;
};

export type LLMBudget = {
  getPriority(simulationId: string, agentId: string): import("@perfectman/shared").BudgetPriority;
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
  // ---- spike additions (ADR-0020) ----
  generateConcurrency: number;
  generateDeadlineMs: number;
  clock: SpikeClock;
  onConsult?: (info: { agentId: string; reason: string; addressed: boolean }) => void;
  isAddressed?: (stepResult: EngineStepResult) => boolean;
  /** commit addressed replies the moment their generate task settles (variant b2) */
  earlyCommitAddressed?: boolean;
  /** focused pulses run on their own lane, gated by per-agent locks (ADR-0020 fallback "per-agent locking") */
  parallelFocused?: boolean;
  /** commit every task the moment its generate settles (releases the agent lock early); breaks strict turn-order commit */
  commitAsComplete?: boolean;
};

export type PulseOpts = {
  reason: "base" | "human_chat" | "body_arrived" | "wake";
  focusAgentIds?: string[];
  elapsedMs?: number;
};

export type SpikeClock = {
  now(): number;
  /** reject after ms if p has not settled (virtual or real time) */
  withDeadline<T>(p: Promise<T>, ms: number): Promise<T>;
};

export type PulseResult = {
  pulseIndex: number;
  eventsCommitted: number;
  agentsCalled: number;
};

export class SplitPulseScheduler {
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

  constructor(private readonly config: PulseSchedulerConfig) {
    this.agentNamesByAgentId = Object.fromEntries(
      config.agents.map((agent) => [agent.id, agent.displayName ?? agent.persona.name]),
    );
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

  private lanes = {
    main: { inFlight: null as Promise<PulseResult> | null, queued: null as null | { ids: Set<string>; reason: PulseOpts["reason"]; promise: Promise<PulseResult>; resolve: (r: PulseResult) => void } },
    focus: { inFlight: null as Promise<PulseResult> | null, queued: null as null | { ids: Set<string>; reason: PulseOpts["reason"]; promise: Promise<PulseResult>; resolve: (r: PulseResult) => void } },
  };
  private lastPulseAt = 0;
  private slotsRunning = 0;
  private slotsRunningAmbient = 0;
  private readonly slotWaiters: Array<{ addressed: boolean; grant: () => void }> = [];

  private slotFree(addressed: boolean): boolean {
    const conc = Math.max(1, this.config.generateConcurrency);
    const reserve = conc > 1 ? 1 : 0;
    return this.slotsRunning < conc && (addressed || this.slotsRunningAmbient < conc - reserve);
  }

  private acquireSlot(addressed: boolean): Promise<void> {
    if (this.slotFree(addressed) && this.slotWaiters.length === 0) {
      this.slotsRunning += 1;
      if (!addressed) this.slotsRunningAmbient += 1;
      return Promise.resolve();
    }
    return new Promise<void>((grant) => {
      const w = { addressed, grant };
      if (addressed) {
        const i = this.slotWaiters.findIndex((x) => !x.addressed);
        if (i < 0) this.slotWaiters.push(w); else this.slotWaiters.splice(i, 0, w);
      } else this.slotWaiters.push(w);
      this.pumpSlots();
    });
  }

  private releaseSlot(addressed: boolean): void {
    this.slotsRunning -= 1;
    if (!addressed) this.slotsRunningAmbient -= 1;
    this.pumpSlots();
  }

  private pumpSlots(): void {
    for (;;) {
      const i = this.slotWaiters.findIndex((w) => this.slotFree(w.addressed));
      if (i < 0) return;
      const [w] = this.slotWaiters.splice(i, 1);
      this.slotsRunning += 1;
      if (!w!.addressed) this.slotsRunningAmbient += 1;
      w!.grant();
    }
  }
  /** per-agent lock held from the decide phase until the agent's commit (variant b3, "per-agent locking") */
  private readonly agentLocks = new Map<string, Promise<void>>();

  /** Base pulses while one is in flight return the in-flight promise (today's behavior);
   *  focused requests queue behind it (one slot, ids unioned) per D-73 -- or, with
   *  parallelFocused, run on their own lane gated by per-agent locks (the ADR's last-resort option). */
  async runPulse(opts: PulseOpts = { reason: "base" }): Promise<PulseResult> {
    const focused = opts.reason !== "base";
    const laneName = focused && this.config.parallelFocused ? "focus" : "main";
    const lane = this.lanes[laneName];
    if (lane.inFlight) {
      if (!focused) return lane.inFlight;
      if (!lane.queued) {
        let resolve!: (r: PulseResult) => void;
        const promise = new Promise<PulseResult>((r) => (resolve = r));
        lane.queued = { ids: new Set(), reason: opts.reason, promise, resolve };
      }
      for (const id of opts.focusAgentIds ?? []) lane.queued.ids.add(id);
      return lane.queued.promise;
    }
    const nowMs = this.config.clock.now();
    const o: PulseOpts = { ...opts, elapsedMs: opts.elapsedMs ?? (this.lastPulseAt ? nowMs - this.lastPulseAt : this.config.pulseIntervalMs) };
    this.lastPulseAt = nowMs;
    lane.inFlight = (async () => {
      if (laneName === "focus") {
        await Promise.all((opts.focusAgentIds ?? []).map((id) => this.agentLocks.get(id)).filter(Boolean));
      }
      return this.executePulse(o);
    })()
      .catch(async (err) => {
        await this.emitOperatorEvent(this.schedulerError("Pulse failed unexpectedly", err));
        return this.finishPulse(0, 0, focused);
      })
      .finally(() => {
        lane.inFlight = null;
        const q = lane.queued;
        if (q) {
          lane.queued = null;
          void this.runPulse({ reason: q.reason, focusAgentIds: [...q.ids] }).then(q.resolve);
        }
      });
    return lane.inFlight;
  }

  /** true while any pulse is executing */
  isBusy(): boolean {
    return this.lanes.main.inFlight !== null || this.lanes.focus.inFlight !== null;
  }

  isMainBusy(): boolean {
    return this.lanes.main.inFlight !== null;
  }

  /**
   * Per-pulse agent order, a pure function of (seed, pulseIndex). Later
   * agents in a pulse see earlier agents' commits (the window refresh in
   * the loop), so a fixed config order gave agent 0 a permanent first-mover
   * slot and everyone else a permanent reactor slot. A separate rng stream
   * (seed mixed with the pulse index by a golden-ratio constant) keeps the
   * per-agent snapshot rng values unchanged.
   */
  private turnOrder(seed: number): AgentContext[] {
    const rng = createSeededRng((seed ^ Math.imul(this.pulseIndex + 1, 0x9e3779b1)) >>> 0);
    const order = [...this.config.agents];
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.nextInt(i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    return order;
  }
  private async executePulse(opts: PulseOpts): Promise<PulseResult> {
    const focused = opts.reason !== "base";
    const stepMs = opts.elapsedMs ?? this.config.pulseIntervalMs;
    this.simTime += stepMs;
    const now = this.simTime;
    const dt = stepMs / 1000;

    const sim = this.config.simulation;
    // focused pulses salt the rng (ADR-0020 D-72)
    const rng = createSeededRng(sim.seed + this.pulseIndex + (focused ? 7919 : 0));

    let eventsCommitted = 0;
    let agentsCalled = 0;

    let channels: Channel[] = [];
    let membership: ChannelMembership[] = [];
    let newEvents: CommittedEvent[] = [];
    let contextEvents: CommittedEvent[] = [];

    try {
      channels = await this.config.channelRegistry.getChannels(sim.id);
      membership = await this.config.channelRegistry.getMembershipsForSimulation(sim.id);
      newEvents = await this.config.eventRepo.getAfter(sim.id, this.lastCommittedEventId);
      contextEvents = await this.config.eventRepo.getCommittedThrough(sim.id, Number.MAX_SAFE_INTEGER);
    } catch (err) {
      await this.emitOperatorEvent(this.schedulerError("Failed to load pulse context", err));
      return this.finishPulse(eventsCommitted, agentsCalled, focused);
    }

    const pulseStartEventId = this.lastCommittedEventId;

    const agentStates = new Map<string, AgentState>();
    for (const agent of this.config.agents) {
      try {
        const stored = await this.config.agentStateRepo.get(sim.id, agent.id);
        agentStates.set(agent.id, stored ?? agent.state);
      } catch {
        agentStates.set(agent.id, agent.state);
      }
    }

    type Task = {
      agent: AgentContext;
      stepResult: EngineStepResult;
      agentState: AgentState;
      channelAnchorId: string;
      runtimeInput: import("@perfectman/shared").AgentRuntimeInput;
      addressed: boolean;
      order: number;
      output?: AgentRuntimeOutput | null;
      committed?: boolean;
      release?: () => void;
    };
    const tasks: Task[] = [];
    const focusSet = opts.focusAgentIds ? new Set(opts.focusAgentIds) : null;

    // ---- Phase A: decide (sequential, turn order) ----
    let order = 0;
    for (const agent of this.turnOrder(sim.seed)) {
      if (focusSet && !focusSet.has(agent.id)) continue;
      if (this.config.parallelFocused && this.agentLocks.has(agent.id)) continue; // busy in another pulse
      try {
        newEvents = await this.config.eventRepo.getAfter(sim.id, pulseStartEventId);
      } catch {
        /* keep stale */
      }
      const agentState = agentStates.get(agent.id) ?? agent.state;
      const rateLimitStatus = this.config.rateLimitGate.getStatus(agent.id);
      const channelAnchorId = this.currentChannelIdByAgent.get(agent.id) ?? this.config.defaultPublicChannelId;
      const worldSignals = buildWorldSignals(newEvents, agentStates, agent.id, channelAnchorId, membership);

      const snapshot = this.config.engineSnapshotProjection.build({
        pulseIndex: this.pulseIndex,
        simulation: sim,
        recentEventsWindow: contextEvents
          .filter((event) => event.visibility.visibilityReason !== "operator_only")
          .slice(-SplitPulseScheduler.CONTEXT_WINDOW_PULSES_LIMIT),
        ownHistoryWindow: contextEvents
          .filter((event) => event.actorId === agent.id && (event.type === "message_sent" || event.type === "reply_sent"))
          .slice(-OWN_HISTORY_LIMIT),
        voicedHoldRecently: false,
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
      });
      const stepResult = this.config.stepResolver ? this.config.stepResolver(snapshot) : runEngineStep(snapshot);
      const engineEvents = this.config.engineEventBuilder.fromStepResult(stepResult, {
        simulationId: sim.id,
        agentId: agent.id,
        channelId: channelAnchorId,
        pulseIndex: this.pulseIndex,
      });
      if (engineEvents.length > 0) {
        const committed = await this.appendAndProject(engineEvents, channels, membership);
        eventsCommitted += committed.length;
        this.applyMemoryProjection(committed, stepResult.updatedAgentState, now);
      }
      await this.applyMemoryReinforcement(stepResult.perceptionPacket.relevantMemories ?? [], stepResult.updatedAgentState, now);

      if (stepResult.decision.needsLLM) {
        agentsCalled += 1;
        const budgetPriority = this.config.llmBudget.getPriority(sim.id, agent.id);
        const runtimeInput = buildAgentRuntimeInput(stepResult, agent.persona, budgetPriority);
        if (this.config.storyClock) runtimeInput.storyClock = formatStoryClock(this.config.storyClock, this.pulseIndex);
        let taskRelease: (() => void) | undefined;
        if (this.config.parallelFocused) {
          let release!: () => void;
          const lock = new Promise<void>((r) => (release = r));
          this.agentLocks.set(agent.id, lock);
          taskRelease = () => { release(); if (this.agentLocks.get(agent.id) === lock) this.agentLocks.delete(agent.id); };
        }
        tasks.push({
          agent, stepResult, agentState, channelAnchorId, runtimeInput,
          addressed: this.config.isAddressed?.(stepResult) ?? false,
          order: order++,
          ...(taskRelease ? { release: taskRelease } : {}),
        });
      } else {
        await this.persistAndSnapshot(stepResult.updatedAgentState, now);
      }
    }

    // ---- Phase B: generate (instance-wide bounded concurrency, addressed first, one slot reserved) ----
    const clock = this.config.clock;
    const order2 = [...tasks].sort((x, y) => Number(y.addressed) - Number(x.addressed) || x.order - y.order);
    await Promise.all(
      order2.map(async (t) => {
        await this.acquireSlot(t.addressed);
        try {
          this.config.onConsult?.({ agentId: t.agent.id, reason: opts.reason, addressed: t.addressed });
          const call = this.config.agentRuntime.generateIntent(t.runtimeInput, { pulseIndex: this.pulseIndex, now });
          t.output = await clock.withDeadline(call, this.config.generateDeadlineMs);
        } catch (err) {
          t.output = null;
          eventsCommitted += (await this.appendAndProject([this.llmFailureEvent(t.agent.id, t.channelAnchorId, err)], channels, membership)).length;
        } finally {
          this.releaseSlot(t.addressed);
        }
        if (this.config.commitAsComplete || (this.config.earlyCommitAddressed && t.addressed)) {
          eventsCommitted += await this.commitTask(t, channels, membership, now);
        }
      }),
    );

    // ---- Phase C: commit (turn order) ----
    for (const t of [...tasks].sort((a, b) => a.order - b.order)) {
      if (t.committed) continue;
      eventsCommitted += await this.commitTask(t, channels, membership, now);
    }

    if (!focused) {
      // stagnation / goal review intentionally omitted from the spike fork
    }
    return this.finishPulse(eventsCommitted, agentsCalled, focused);
  }

  private async commitTask(
    t: { agent: AgentContext; stepResult: EngineStepResult; agentState: AgentState; channelAnchorId: string; output?: AgentRuntimeOutput | null; committed?: boolean; release?: () => void },
    channels: Channel[],
    membership: ChannelMembership[],
    now: number,
  ): Promise<number> {
    t.committed = true;
    try {
      return await this.commitTaskInner(t, channels, membership, now);
    } finally {
      t.release?.();
    }
  }

  private async commitTaskInner(
    t: { agent: AgentContext; stepResult: EngineStepResult; agentState: AgentState; channelAnchorId: string; output?: AgentRuntimeOutput | null },
    channels: Channel[],
    membership: ChannelMembership[],
    now: number,
  ): Promise<number> {
    const sim = this.config.simulation;
    let eventsCommitted = 0;
    const { agent, stepResult, agentState, channelAnchorId } = t;
    const runtimeOutput = t.output;
    if (!runtimeOutput) {
      await this.persistAndSnapshot(stepResult.updatedAgentState, now);
      return 0;
    }
    const resolved = await this.config.intentResolver.resolve(runtimeOutput.intent, {
      simulationId: sim.id,
      channelId: channelAnchorId,
      pulseIndex: this.pulseIndex,
      agentState,
      availableActions: stepResult.availableActions,
      channels,
      membership,
      settings: sim.settings,
      actionEmotions: stepResult.actionEmotions,
      agentNames: this.agentNamesByAgentId,
      ...(stepResult.decision.holdSuggested === true ? { holdSuggested: true } : {}),
    }).catch(async (err) => {
      await this.emitOperatorEvent(this.schedulerError("Intent resolver failed", err, agent.id));
      return null;
    });
    if (!resolved) {
      await this.persistAndSnapshot(stepResult.updatedAgentState, now);
      return 0;
    }
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
      pulseIndex: this.pulseIndex,
      detail: `Action intent: ${intent.intentType}`,
      data: intentData,
      createdAt: Date.now(),
    });
    if (resolved.committedEvents.length > 0) {
      const committed = await this.appendAndProject(resolved.committedEvents, channels, membership);
      eventsCommitted += committed.length;
      this.applyMemoryProjection(committed, stepResult.updatedAgentState, now);
    }
    for (const opEv of [...resolved.operatorEvents, ...runtimeOutput.operatorEvents]) {
      await this.emitOperatorEvent(opEv);
    }
    const committedActType =
      resolved.outcome === "committed" ? intent.intentType
        : resolved.outcome === "fallback_committed" ? intent.fallbackIfBlocked : undefined;
    if (committedActType && OUTWARD_SOCIAL_ACT_TYPES.has(committedActType)) {
      stepResult.updatedAgentState.lastActionAt = now;
    }
    await this.persistAndSnapshot(stepResult.updatedAgentState, now);
    return eventsCommitted;
  }

  private finishPulse(eventsCommitted: number, agentsCalled: number, focused = false): PulseResult {
    const result: PulseResult = { pulseIndex: this.pulseIndex, eventsCommitted, agentsCalled };
    if (!focused) this.pulseIndex += 1;
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

  private llmFailureEvent(agentId: string, channelId: string, err: unknown): SimulationEvent {
    return {
      simulationId: this.config.simulation.id,
      channelId,
      actorId: agentId,
      type: "llm_failure",
      payload: { reason: this.errorReason(err) },
      sourceEventIds: [],
      emotionalSalience: "low",
      pulseIndex: this.pulseIndex,
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
