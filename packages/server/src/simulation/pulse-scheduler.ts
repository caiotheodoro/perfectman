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
} from "@perfectman/shared";
import { createSeededRng } from "@perfectman/shared";
import { runEngineStep, computeStagnationMetrics, filterVisibleEventsForAgent } from "@perfectman/engine";
import type { IEventRepository, IAgentStateRepository } from "../persistence/repositories.js";
import type { ChannelRegistry } from "./channel-registry.js";
import type { RateLimitGate } from "./rate-limit-gate.js";
import type { IntentResolver } from "./intent-resolver.js";
import type { EngineSnapshotProjection } from "./projections/engine-snapshot-projection.js";
import type { DeliveryProjection } from "./projections/delivery-projection.js";
import type { SpectatorProjection } from "./projections/spectator-projection.js";
import type { OperatorProjection } from "./projections/operator-projection.js";
import type { EngineEventBuilder } from "./engine-event-builder.js";
import { buildAgentRuntimeInput } from "./runtime-input-builder.js";
import { buildWorldSignals } from "./world-signals-builder.js";
import type { AgentRuntimeContext, AgentRuntimeOutput } from "../agent/agent-runtime.types.js";

export type AgentContext = {
  id: string;
  state: AgentState;
  persona: PersonaConfig;
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
  /** Testability seam: defaults to runEngineStep(snapshot). Inject to drive the
   *  commit-ordering pipeline with a known step result without the LLM. */
  stepResolver?: (snapshot: EngineSnapshot) => EngineStepResult;
};

export type PulseResult = {
  pulseIndex: number;
  eventsCommitted: number;
  agentsCalled: number;
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

  constructor(private readonly config: PulseSchedulerConfig) {}

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

  async runPulse(): Promise<PulseResult> {
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

  private async executePulse(): Promise<PulseResult> {
    this.simTime += this.config.pulseIntervalMs;
    const now = this.simTime;
    const dt = this.config.pulseIntervalMs / 1000;

    const sim = this.config.simulation;
    const rng = createSeededRng(sim.seed + this.pulseIndex);

    let eventsCommitted = 0;
    let agentsCalled = 0;

    let channels: Channel[] = [];
    let membership: ChannelMembership[] = [];
    let newEvents: CommittedEvent[] = [];
    let contextEvents: CommittedEvent[] = [];

    try {
      channels = await this.config.channelRegistry.getChannels(sim.id);
      membership = await this.config.channelRegistry.getMembershipsForSimulation(sim.id);
      newEvents = await this.config.eventRepo.getAfter(
        sim.id,
        this.lastCommittedEventId,
      );
      // The model's context is a ROLLING WINDOW, not just this pulse's
      // events — agents reference what was said earlier (docs: short-term
      // memory, "last ~10 conversations"). Seed events (any pulseIndex)
      // stay visible through the room's first pulses.
      const allCommitted = await this.config.eventRepo.getCommittedThrough(
        sim.id,
        Number.MAX_SAFE_INTEGER,
      );
      contextEvents = allCommitted;
    } catch (err) {
      await this.emitOperatorEvent(this.schedulerError("Failed to load pulse context", err));
      return this.finishPulse(eventsCommitted, agentsCalled);
    }

    // Snapshot the event cursor before the agent loop so each agent can see
    // events committed by prior agents within this same pulse.
    const pulseStartEventId = this.lastCommittedEventId;

    const agentStates = new Map<string, AgentState>();
    for (const agent of this.config.agents) {
      try {
        const stored = await this.config.agentStateRepo.get(sim.id, agent.id);
        agentStates.set(agent.id, stored ?? agent.state);
      } catch (err) {
        await this.emitOperatorEvent(this.schedulerError(`Failed to load agent state for ${agent.id}`, err, agent.id));
        agentStates.set(agent.id, agent.state);
      }
    }

    for (const agent of this.config.agents) {
      // Refresh event window so this agent sees actions taken by prior agents this pulse.
      try {
        newEvents = await this.config.eventRepo.getAfter(sim.id, pulseStartEventId);
      } catch {
        // Keep the stale newEvents from pulse start — non-fatal
      }

      const agentState = agentStates.get(agent.id) ?? agent.state;
      const rateLimitStatus = this.config.rateLimitGate.getStatus(agent.id);

      const channelAnchorId =
        this.currentChannelIdByAgent.get(agent.id) ?? this.config.defaultPublicChannelId;

      const worldSignals = buildWorldSignals(
        newEvents,
        agentStates,
        agent.id,
        channelAnchorId,
        membership,
      );

      const snapshot = this.config.engineSnapshotProjection.build({
        pulseIndex: this.pulseIndex,
        simulation: sim,
        recentEventsWindow: contextEvents.slice(-PulseScheduler.CONTEXT_WINDOW_PULSES_LIMIT),
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

      const stepResult = this.config.stepResolver
        ? this.config.stepResolver(snapshot)
        : runEngineStep(snapshot);

      // Commit engine-emitted events before LLM path
      const engineEvents = this.config.engineEventBuilder.fromStepResult(stepResult, {
        simulationId: sim.id,
        agentId: agent.id,
        channelId: channelAnchorId,
        pulseIndex: this.pulseIndex,
      });

      if (engineEvents.length > 0) {
        eventsCommitted += await this.appendAndProject(engineEvents, channels, membership);
      }

      if (stepResult.decision.needsLLM) {
        agentsCalled += 1;
        const budgetPriority = this.config.llmBudget.getPriority(sim.id, agent.id);
        const runtimeInput = buildAgentRuntimeInput(stepResult, agent.persona, budgetPriority);
        const runtimeOutput = await this.config.agentRuntime.generateIntent(runtimeInput, {
          pulseIndex: this.pulseIndex,
          now,
        }).catch(async (err) => {
          const failureEvent = this.llmFailureEvent(agent.id, channelAnchorId, err);
          eventsCommitted += await this.appendAndProject([failureEvent], channels, membership);
          return null;
        });

        if (!runtimeOutput) {
          await this.safeUpsertAgentState(stepResult.updatedAgentState);
          continue;
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
        }).catch(async (err) => {
          await this.emitOperatorEvent(this.schedulerError("Intent resolver failed", err, agent.id));
          return null;
        });

        if (!resolved) {
          await this.safeUpsertAgentState(stepResult.updatedAgentState);
          continue;
        }

        if (resolved.committedEvents.length > 0) {
          eventsCommitted += await this.appendAndProject(resolved.committedEvents, channels, membership);
        }

        for (const opEv of [...resolved.operatorEvents, ...runtimeOutput.operatorEvents]) {
          await this.emitOperatorEvent(opEv);
        }
      }

      await this.safeUpsertAgentState(stepResult.updatedAgentState);
    }

    // Every 10 pulses: compute stagnation metrics
    if (this.pulseIndex > 0 && this.pulseIndex % 10 === 0) {
      const recentEvents = await this.config.eventRepo.getCommittedThrough(sim.id, this.pulseIndex);
      const agentStatesMap = new Map<string, AgentState>();
      for (const agent of this.config.agents) {
        const stored = await this.config.agentStateRepo.get(sim.id, agent.id);
        if (stored) agentStatesMap.set(agent.id, stored);
      }
      const metrics = computeStagnationMetrics(sim.id, this.pulseIndex, recentEvents, agentStatesMap);
      if (metrics.level !== "normal") {
        const stagnationEvent = this.config.engineEventBuilder.fromStagnation(metrics, {
          simulationId: sim.id,
          agentId: "system",
          channelId: this.config.defaultPublicChannelId,
          pulseIndex: this.pulseIndex,
        });
        if (stagnationEvent) {
          eventsCommitted += await this.appendAndProject([stagnationEvent], channels, membership);
        }
      }
    }

    return this.finishPulse(eventsCommitted, agentsCalled);
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
  ): Promise<number> {
    let committed: CommittedEvent[];
    try {
      committed = await this.config.eventRepo.append(this.config.simulation.id, events);
    } catch (err) {
      await this.emitOperatorEvent(this.schedulerError("Failed to append events", err));
      return 0;
    }

    for (const ev of committed) {
      this.lastCommittedEventId = ev.id;
      this.updateCurrentChannelAnchors(ev);
      await this.projectCommittedEvent(ev, channels, membership);
    }

    return committed.length;
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

  private async safeUpsertAgentState(agentState: AgentState): Promise<void> {
    try {
      await this.config.agentStateRepo.upsert(agentState);
    } catch (err) {
      await this.emitOperatorEvent(this.schedulerError("Failed to persist agent state", err, agentState.agentId));
    }
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
