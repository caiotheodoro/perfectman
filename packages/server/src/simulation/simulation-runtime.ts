import type {
  Simulation,
  SimulationSettings,
} from "@perfectman/shared";
import {
  InMemoryEventRepository,
  InMemoryAgentStateRepository,
  InMemorySimulationRepository,
  InMemoryChannelRepository,
} from "./in-memory-stores.js";
import { EventLog } from "./event-log.js";
import { ChannelRegistry } from "./channel-registry.js";
import { RateLimitGate } from "./rate-limit-gate.js";
import { IntentResolver } from "./intent-resolver.js";
import { SimulationManager } from "./simulation-manager.js";
import { EngineSnapshotProjection } from "./projections/engine-snapshot-projection.js";
import { DeliveryProjection } from "./projections/delivery-projection.js";
import { SpectatorProjection } from "./projections/spectator-projection.js";
import { OperatorProjection } from "./projections/operator-projection.js";
import { EngineEventBuilder } from "./engine-event-builder.js";
import { PulseScheduler } from "./pulse-scheduler.js";
import type { IDeliveryGateway } from "./scheduler-contracts.js";
import type { AgentRuntime, LlmBudget, AgentContext } from "./pulse-scheduler.js";

export type SimulationRuntimeConfig = {
  delivery: IDeliveryGateway;
  agentRuntime: AgentRuntime;
  llmBudget: LlmBudget;
};

type ActiveSimulation = {
  simulation: Simulation;
  scheduler: PulseScheduler;
  defaultPublicChannelId: string;
};

export class SimulationRuntime {
  private readonly eventRepo = new InMemoryEventRepository();
  private readonly agentStateRepo = new InMemoryAgentStateRepository();
  private readonly simRepo = new InMemorySimulationRepository();
  private readonly channelRepo = new InMemoryChannelRepository();
  private readonly channelRegistry: ChannelRegistry;
  private readonly eventLog: EventLog;
  private readonly engineEventBuilder = new EngineEventBuilder();
  private readonly engineSnapshotProjection = new EngineSnapshotProjection();

  private readonly active = new Map<string, ActiveSimulation>();

  constructor(private readonly config: SimulationRuntimeConfig) {
    this.channelRegistry = new ChannelRegistry(this.channelRepo);
    this.eventLog = new EventLog(this.eventRepo);
  }

  async createSimulation(params: {
    name: string;
    agentContexts: AgentContext[];
    settings: SimulationSettings;
    seed: number;
  }): Promise<Simulation> {
    const manager = new SimulationManager(
      this.simRepo,
      this.channelRegistry,
      this.eventLog,
      this.config.delivery,
    );

    const { simulation, defaultChannel } = await manager.create({
      name: params.name,
      agentIds: params.agentContexts.map(a => a.id),
      settings: params.settings,
      seed: params.seed,
    });

    for (const agent of params.agentContexts) {
      await this.agentStateRepo.upsert(agent.state);
    }

    const rateLimitGate = new RateLimitGate(params.settings);
    const intentResolver = new IntentResolver(rateLimitGate, this.channelRegistry);
    const deliveryProjection = new DeliveryProjection(this.config.delivery);
    const spectatorProjection = new SpectatorProjection(this.config.delivery);
    const operatorProjection = new OperatorProjection(this.config.delivery);

    const scheduler = new PulseScheduler({
      simulation,
      agents: params.agentContexts,
      defaultPublicChannelId: defaultChannel.id,
      eventRepo: this.eventRepo,
      agentStateRepo: this.agentStateRepo,
      channelRegistry: this.channelRegistry,
      rateLimitGate,
      intentResolver,
      engineSnapshotProjection: this.engineSnapshotProjection,
      deliveryProjection,
      spectatorProjection,
      operatorProjection,
      engineEventBuilder: this.engineEventBuilder,
      agentRuntime: this.config.agentRuntime,
      llmBudget: this.config.llmBudget,
      pulseIntervalMs: params.settings.pulseIntervalMs,
    });

    this.active.set(simulation.id, {
      simulation,
      scheduler,
      defaultPublicChannelId: defaultChannel.id,
    });

    return simulation;
  }

  async start(simulationId: string): Promise<void> {
    const entry = this.active.get(simulationId);
    if (!entry) throw new Error(`Simulation not found: ${simulationId}`);
    const sim = await this.simRepo.get(simulationId);
    if (!sim) throw new Error(`Simulation not found in repo: ${simulationId}`);
    // Lifecycle: start
    await this.simRepo.updateStatus(simulationId, "running");
    const committed = await this.eventLog.append(simulationId, [{
      simulationId,
      channelId: entry.defaultPublicChannelId,
      actorId: "system",
      type: "simulation_started",
      payload: { simulationId },
      sourceEventIds: [],
      emotionalSalience: "low",
      pulseIndex: 0,
      visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "lifecycle" },
    }]);
    entry.scheduler.setLastCommittedEventId(committed.at(-1)?.id);
    entry.scheduler.start();
  }

  async pause(simulationId: string): Promise<void> {
    const entry = this.active.get(simulationId);
    if (!entry) throw new Error(`Simulation not found: ${simulationId}`);
    entry.scheduler.stop();
    await this.simRepo.updateStatus(simulationId, "paused");
    await this.eventLog.append(simulationId, [{
      simulationId,
      channelId: entry.defaultPublicChannelId,
      actorId: "system",
      type: "simulation_paused",
      payload: { simulationId },
      sourceEventIds: [],
      emotionalSalience: "low",
      pulseIndex: entry.scheduler.getPulseIndex(),
      visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "lifecycle" },
    }]);
  }

  async stop(simulationId: string): Promise<void> {
    const entry = this.active.get(simulationId);
    if (!entry) throw new Error(`Simulation not found: ${simulationId}`);
    entry.scheduler.stop();
    await this.simRepo.updateStatus(simulationId, "stopped");
    await this.eventLog.append(simulationId, [{
      simulationId,
      channelId: entry.defaultPublicChannelId,
      actorId: "system",
      type: "simulation_stopped",
      payload: { simulationId },
      sourceEventIds: [],
      emotionalSalience: "low",
      pulseIndex: entry.scheduler.getPulseIndex(),
      visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "lifecycle" },
    }]);
    await this.config.delivery.onSimulationStopped(simulationId);
    this.active.delete(simulationId);
  }

  getEventLog(): EventLog {
    return this.eventLog;
  }
}
