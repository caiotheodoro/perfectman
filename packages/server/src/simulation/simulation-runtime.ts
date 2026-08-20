import type {
  Simulation,
  SimulationSettings,
  Channel,
  ChannelType,
} from "@perfectman/shared";
import { createId } from "@perfectman/shared";
import {
  InMemoryEventRepository,
  InMemoryAgentStateRepository,
  InMemorySimulationRepository,
  InMemoryChannelRepository,
} from "./in-memory-stores.js";
import type {
  IAgentStateRepository,
  IChannelRepository,
  IEventRepository,
  ISimulationRepository,
} from "../persistence/repositories.js";
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
import type { AgentRuntime, LLMBudget, AgentContext, PulseResult } from "./pulse-scheduler.js";

export type SimulationRuntimeConfig = {
  delivery: IDeliveryGateway;
  agentRuntime: AgentRuntime;
  llmBudget: LLMBudget;
  repositories?: SimulationRuntimeRepositories;
};

export type SimulationRuntimeRepositories = {
  eventRepo: IEventRepository;
  agentStateRepo: IAgentStateRepository;
  simRepo: ISimulationRepository;
  channelRepo: IChannelRepository;
};

export type ConfiguredInitialChannel = {
  id: string;
  type: ChannelType;
  name: string;
  memberAgentIds: string[];
  default?: boolean;
  createdBy?: string;
  spectatorVisible?: boolean;
  operatorVisible?: boolean;
  createdForMotives?: string[];
};

type ActiveSimulation = {
  simulation: Simulation;
  scheduler: PulseScheduler;
  defaultPublicChannelId: string;
};

export class SimulationRuntime {
  private readonly eventRepo: IEventRepository;
  private readonly agentStateRepo: IAgentStateRepository;
  private readonly simRepo: ISimulationRepository;
  private readonly channelRepo: IChannelRepository;
  private readonly channelRegistry: ChannelRegistry;
  private readonly eventLog: EventLog;
  private readonly engineEventBuilder = new EngineEventBuilder();
  private readonly engineSnapshotProjection = new EngineSnapshotProjection();

  private readonly active = new Map<string, ActiveSimulation>();

  constructor(private readonly config: SimulationRuntimeConfig) {
    const repositories = config.repositories ?? {
      eventRepo: new InMemoryEventRepository(),
      agentStateRepo: new InMemoryAgentStateRepository(),
      simRepo: new InMemorySimulationRepository(),
      channelRepo: new InMemoryChannelRepository(),
    };
    this.eventRepo = repositories.eventRepo;
    this.agentStateRepo = repositories.agentStateRepo;
    this.simRepo = repositories.simRepo;
    this.channelRepo = repositories.channelRepo;
    this.channelRegistry = new ChannelRegistry(this.channelRepo);
    this.eventLog = new EventLog(this.eventRepo);
  }

  async createSimulation(params: {
    id?: string;
    name: string;
    agentContexts: AgentContext[];
    settings: SimulationSettings;
    seed: number;
    channels?: ConfiguredInitialChannel[];
  }): Promise<Simulation> {
    const { simulation, defaultChannel } =
      params.channels && params.channels.length > 0
        ? await this.createFromConfiguredChannels(params)
        : await this.createWithDefaultChannel(params);

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

  private async createWithDefaultChannel(params: {
    id?: string;
    name: string;
    agentContexts: AgentContext[];
    settings: SimulationSettings;
    seed: number;
  }): Promise<{ simulation: Simulation; defaultChannel: Channel }> {
    const manager = new SimulationManager(
      this.simRepo,
      this.channelRegistry,
      this.eventLog,
      this.config.delivery,
    );

    return manager.create({
      name: params.name,
      agentIds: params.agentContexts.map(a => a.id),
      settings: params.settings,
      seed: params.seed,
    });
  }

  private async createFromConfiguredChannels(params: {
    id?: string;
    name: string;
    agentContexts: AgentContext[];
    settings: SimulationSettings;
    seed: number;
    channels?: ConfiguredInitialChannel[];
  }): Promise<{ simulation: Simulation; defaultChannel: Channel }> {
    const now = Date.now();
    const channels = params.channels ?? [];
    const defaultChannelConfig =
      channels.find(channel => channel.default) ??
      channels.find(channel => channel.type === "public_channel") ??
      channels[0];

    if (!defaultChannelConfig) {
      throw new Error("At least one initial channel is required");
    }

    const simulation = await this.simRepo.create({
      id: params.id ?? createId(),
      name: params.name,
      agentIds: params.agentContexts.map(a => a.id),
      channelIds: channels.map(channel => channel.id),
      settings: params.settings,
      seed: params.seed,
    });

    let defaultChannel: Channel | undefined;
    for (const channelConfig of channels) {
      const channel: Channel = {
        id: channelConfig.id,
        simulationId: simulation.id,
        type: channelConfig.type,
        name: channelConfig.name,
        createdBy: channelConfig.createdBy ?? "system",
        memberAgentIds: channelConfig.memberAgentIds,
        spectatorVisible: channelConfig.spectatorVisible ?? channelConfig.type !== "private_channel",
        operatorVisible: channelConfig.operatorVisible ?? true,
        createdForMotives: channelConfig.createdForMotives ?? [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      await this.channelRepo.create(channel);
      for (const agentId of channel.memberAgentIds) {
        await this.channelRepo.addMembership({ channelId: channel.id, agentId, joinedAt: now });
      }
      await this.config.delivery.createChannel(channel.id, channel.type, channel.memberAgentIds);
      if (channelConfig.id === defaultChannelConfig.id) {
        defaultChannel = channel;
      }
    }

    return { simulation, defaultChannel: defaultChannel ?? (await this.channelRepo.getById(defaultChannelConfig.id))! };
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

  async runPulse(simulationId: string): Promise<PulseResult> {
    const entry = this.active.get(simulationId);
    if (!entry) throw new Error(`Simulation not found: ${simulationId}`);
    return entry.scheduler.runPulse();
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
