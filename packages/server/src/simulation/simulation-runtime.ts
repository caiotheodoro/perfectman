import type { StoryClockConfig } from "./story-clock.js";
import type {
  ActionIntent,
  CommittedEvent,
  EventPayload,
  SpeechMode,
  UntrustedMessagePayload,
  Simulation,
  SimulationSettings,
  Channel,
  ChannelType,
  EndReason,
  EndingOffer,
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
import { IntentResolver, type ResolvedIntent } from "./intent-resolver.js";
import { RoomSpeechArbiter, roomIdOfChannel } from "./room-speech-arbiter.js";
import { computeActorAudibility } from "./actor-audibility.js";
import type { HotelSimulationOptions } from "./hotel-options.js";
import type { GuestIngest, GuestLineInput, HotelRuntimeApi, RunPulseOptions } from "./hotel-runtime-api.js";
import { SimulationManager } from "./simulation-manager.js";
import { EngineSnapshotProjection } from "./projections/engine-snapshot-projection.js";
import { DeliveryProjection } from "./projections/delivery-projection.js";
import { SpectatorProjection } from "./projections/spectator-projection.js";
import { OperatorProjection } from "./projections/operator-projection.js";
import { EngineEventBuilder } from "./engine-event-builder.js";
import { PulseScheduler } from "./pulse-scheduler.js";
import type { IDeliveryGateway } from "./scheduler-contracts.js";
import type { AgentRuntime, LLMBudget, AgentContext, PulseResult } from "./pulse-scheduler.js";
import type { GoalLayerRuntime } from "./world/world-evaluator.js";

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
  arbiter?: RoomSpeechArbiter;
};

/** Longest guest line the runtime will append (the Tilehouse chat limit, ADR-0022). */
const GUEST_LINE_MAX_CHARS = 200;

export class SimulationRuntime implements GuestIngest, HotelRuntimeApi {
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
    goalLayer?: GoalLayerRuntime;
    storyClock?: StoryClockConfig;
    attachExisting?: boolean;
    /** Hotel mode (ADR-0020 to 0024). Absent: the loop, resolver and reads are unchanged. */
    hotel?: HotelSimulationOptions;
  }): Promise<Simulation> {
    const { simulation, defaultChannel } =
      params.channels && params.channels.length > 0
        ? await this.createFromConfiguredChannels(params)
        : await this.createWithDefaultChannel(params);

    for (const agent of params.agentContexts) {
      await this.agentStateRepo.upsert(agent.state);
    }

    const hotel = params.hotel;
    const rateLimitGate = new RateLimitGate(params.settings);
    const arbiter = hotel?.arbiter ? new RoomSpeechArbiter(hotel.arbiter) : undefined;
    const mirror = hotel?.spaceMirror;
    const intentResolver = new IntentResolver(
      rateLimitGate,
      this.channelRegistry,
      arbiter,
      hotel?.clock,
      hotel
        ? {
            ...(hotel.chooseMode ? { chooseMode: hotel.chooseMode } : {}),
            ...(hotel.wouldShout ? { wouldShout: hotel.wouldShout } : {}),
            ...(mirror
              ? {
                  audibility: (speakerId: string, _channelId: string, mode: SpeechMode, whisperTo?: string) =>
                    computeActorAudibility(mirror.model(), speakerId, mode, whisperTo),
                }
              : {}),
          }
        : undefined,
    );
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
      ...(params.goalLayer ? { goalLayer: params.goalLayer } : {}),
      ...(params.storyClock ? { storyClock: params.storyClock } : {}),
      ...(hotel
        ? {
            pulseMode: hotel.pulseMode ?? "split",
            ...(hotel.generateConcurrency !== undefined ? { generateConcurrency: hotel.generateConcurrency } : {}),
            ...(hotel.generateDeadlineMs !== undefined ? { generateDeadlineMs: hotel.generateDeadlineMs } : {}),
            ...(hotel.onConsult ? { onConsult: hotel.onConsult } : {}),
            ...(hotel.ambientGate ? { ambientGate: hotel.ambientGate } : {}),
            ...(hotel.commitOrder ? { commitOrder: hotel.commitOrder } : {}),
            windowedReads: hotel.windowedReads ?? true,
            ...(arbiter ? { arbiter } : {}),
            ...(hotel.spaceMirror ? { spaceMirror: hotel.spaceMirror } : {}),
            ...(hotel.onAgentCommitted ? { onAgentCommitted: hotel.onAgentCommitted } : {}),
            ...(hotel.clock ? { clock: hotel.clock } : {}),
          }
        : {}),
      onEndOffered: (offer) =>
        this.stop(simulation.id, { endReason: "goal_end_offered", endingOffer: offer }),
    });

    this.active.set(simulation.id, {
      simulation,
      scheduler,
      defaultPublicChannelId: defaultChannel.id,
      ...(arbiter ? { arbiter } : {}),
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
    attachExisting?: boolean;
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

    // Restart resume (get-or-create): attach to the surviving row instead of
    // hitting the simulations.id PK. Mode-agnostic — simRepo.get and
    // channelRepo.getById exist in both persistence implementations.
    const simId = params.id ?? createId();
    const existing = params.attachExisting ? await this.simRepo.get(simId) : null;
    if (existing) {
      for (const channelConfig of channels) {
        await this.config.delivery.createChannel(
          channelConfig.id,
          channelConfig.type,
          channelConfig.memberAgentIds,
        );
      }
      const defaultChannel = await this.channelRepo.getById(defaultChannelConfig.id);
      if (!defaultChannel) {
        throw new Error(
          `Channel ${defaultChannelConfig.id} not found for existing simulation ${simId}`,
        );
      }
      return { simulation: existing, defaultChannel };
    }

    const simulation = await this.simRepo.create({
      id: simId,
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

  async runPulse(simulationId: string, opts?: RunPulseOptions): Promise<PulseResult> {
    const entry = this.active.get(simulationId);
    if (!entry) throw new Error(`Simulation not found: ${simulationId}`);
    return entry.scheduler.runPulse(opts);
  }

  /** Current pulse index, stamped on ingested human events (ADR-0022). */
  getPulseIndex(simulationId: string): number {
    const entry = this.active.get(simulationId);
    if (!entry) throw new Error(`Simulation not found: ${simulationId}`);
    return entry.scheduler.getPulseIndex();
  }

  /** The run's room speech arbiter; the hotel feeds it human lines and typing (ADR-0021). Hotel mode only. */
  getArbiter(simulationId: string): RoomSpeechArbiter | undefined {
    return this.active.get(simulationId)?.arbiter;
  }

  /** Resolves when no pulse or generate task of this simulation is in flight. */
  async awaitIdle(simulationId: string): Promise<void> {
    await this.active.get(simulationId)?.scheduler.awaitIdle();
  }

  /** `[min, max]` ms the persona takes to answer, for the hotel gateway's landing time. */
  getResponseDelayMs(simulationId: string, agentId: string): [number, number] | undefined {
    return this.active.get(simulationId)?.scheduler.getResponseDelayMs(agentId);
  }

  /**
   * Re-submits a held intent (a deferred line, on arrival) through the normal
   * resolver, so the arbiter and the rate gate still apply (ADR-0019, 0021).
   * The simulation is the one that owns the agent.
   */
  resolveDeferred(agentId: string, intent: ActionIntent): Promise<ResolvedIntent> {
    for (const entry of this.active.values()) {
      if (entry.scheduler.hasAgent(agentId)) return entry.scheduler.resolveDeferred(agentId, intent);
    }
    return Promise.reject(new Error(`No active simulation owns agent ${agentId}`));
  }

  /**
   * Appends one human line as an untrusted `message_sent` (ADR-0022). Goes
   * through the event log, not `appendAndProject`: the line is never echoed
   * back to the hotel as actor speech, and the scheduler picks it up on its
   * next read. The adapter owns sanitizing, addressing and hearing.
   */
  async ingest(line: GuestLineInput): Promise<CommittedEvent> {
    const entry = this.active.get(line.simulationId);
    if (!entry) throw new Error(`Simulation not found: ${line.simulationId}`);
    const payload: UntrustedMessagePayload = {
      content: line.content.slice(0, GUEST_LINE_MAX_CHARS),
      untrusted: true,
      senderKind: line.senderKind,
      senderName: line.senderName,
      mentionedAgentIds: line.mentionedAgentIds,
      addresseeIds: line.addresseeIds,
      hearing: line.hearing,
      speakerTile: line.speakerTile,
      mode: line.mode,
    };
    const [committed] = await this.eventLog.append(line.simulationId, [
      {
        simulationId: line.simulationId,
        channelId: line.roomChannelId,
        actorId: line.actorId,
        type: "message_sent",
        payload: payload as EventPayload,
        sourceEventIds: [],
        emotionalSalience: line.salience,
        pulseIndex: entry.scheduler.getPulseIndex(),
        visibility: line.visibility,
      },
    ]);
    return committed!;
  }

  /**
   * Registers a public channel the host names itself (a hotel room channel,
   * `room:<id>`, ADR-0018). Idempotent for an id that already exists.
   */
  async registerRoomChannel(
    simulationId: string,
    room: { id: string; name: string; memberAgentIds?: string[] },
  ): Promise<void> {
    if (!this.active.has(simulationId)) throw new Error(`Simulation not found: ${simulationId}`);
    if (await this.channelRepo.getById(room.id)) return;
    const channel = await this.channelRegistry.createChannel({
      id: room.id,
      simulationId,
      type: "public_channel",
      name: room.name,
      createdBy: "system",
      memberAgentIds: room.memberAgentIds ?? [],
      spectatorVisible: true,
    });
    await this.config.delivery.createChannel(channel.id, channel.type, channel.memberAgentIds);
  }

  /** Room membership follows occupancy (ADR-0018); a change applies at the next pulse. */
  async addChannelMember(channelId: string, agentId: string): Promise<void> {
    await this.channelRegistry.addMember(channelId, agentId);
    await this.config.delivery.addMember(channelId, agentId);
    // Entering a room makes its channel the actor's default one (embodiment.md 6.4).
    if (roomIdOfChannel(channelId) !== undefined) {
      for (const entry of this.active.values()) {
        if (entry.scheduler.hasAgent(agentId)) entry.scheduler.followToChannel(agentId, channelId);
      }
    }
  }

  /** Hotel: stops scheduling an actor the hotel removed. Returns the actors still scheduled. */
  retireAgent(simulationId: string, agentId: string): number {
    const entry = this.active.get(simulationId);
    if (!entry) throw new Error(`Simulation not found: ${simulationId}`);
    entry.scheduler.retireAgent(agentId);
    return entry.scheduler.agentCount;
  }

  /** Hotel: an actor that walks in later is not scheduled until `admitAgent`. Returns the actors still scheduled. */
  deferAgent(simulationId: string, agentId: string): number {
    const entry = this.active.get(simulationId);
    if (!entry) throw new Error(`Simulation not found: ${simulationId}`);
    entry.scheduler.deferAgent(agentId);
    return entry.scheduler.agentCount;
  }

  /** Hotel: the deferred actor has arrived. Returns whether it was waiting. */
  admitAgent(simulationId: string, agentId: string): boolean {
    const entry = this.active.get(simulationId);
    if (!entry) throw new Error(`Simulation not found: ${simulationId}`);
    return entry.scheduler.admitAgent(agentId);
  }

  async removeChannelMember(channelId: string, agentId: string): Promise<void> {
    await this.channelRegistry.removeMember(channelId, agentId);
    await this.config.delivery.removeMember(channelId, agentId);
  }

  getChannelRegistry(): ChannelRegistry {
    return this.channelRegistry;
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

  async stop(
    simulationId: string,
    opts?: { endReason?: EndReason; endingOffer?: EndingOffer },
  ): Promise<void> {
    const entry = this.active.get(simulationId);
    if (!entry) throw new Error(`Simulation not found: ${simulationId}`);
    entry.scheduler.stop();
    await this.simRepo.updateStatus(simulationId, "stopped");
    await this.eventLog.append(simulationId, [{
      simulationId,
      channelId: entry.defaultPublicChannelId,
      actorId: "system",
      type: "simulation_stopped",
      payload: {
        simulationId,
        ...(opts?.endReason !== undefined ? { endReason: opts.endReason } : {}),
        ...(opts?.endingOffer !== undefined ? { endingOffer: opts.endingOffer } : {}),
      },
      sourceEventIds: [],
      emotionalSalience: "low",
      pulseIndex: entry.scheduler.getPulseIndex(),
      visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "lifecycle" },
    }]);
    await this.config.delivery.onSimulationStopped(simulationId, opts?.endReason, opts?.endingOffer);
    this.active.delete(simulationId);
  }

  getEventLog(): EventLog {
    return this.eventLog;
  }
}
