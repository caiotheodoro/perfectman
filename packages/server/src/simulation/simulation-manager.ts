import type {
  Simulation,
  SimulationSettings,
  Channel,
} from "@perfectman/shared";
import { createId } from "@perfectman/shared";
import type { ISimulationRepository, CreateSimulationInput } from "../persistence/repositories.js";
import type { ChannelRegistry } from "./channel-registry.js";
import type { EventLog } from "./event-log.js";
import type { IDeliveryGateway } from "./scheduler-contracts.js";
import { SimulationLifecycle } from "./simulation-lifecycle.js";

export type CreateSimulationParams = {
  name: string;
  agentIds: string[];
  settings: SimulationSettings;
  seed: number;
};

export class SimulationManager {
  private readonly lifecycle: SimulationLifecycle;

  constructor(
    private readonly simRepo: ISimulationRepository,
    private readonly channelRegistry: ChannelRegistry,
    private readonly eventLog: EventLog,
    private readonly gateway: IDeliveryGateway,
  ) {
    this.lifecycle = new SimulationLifecycle(simRepo, eventLog);
  }

  async create(params: CreateSimulationParams): Promise<{ simulation: Simulation; defaultChannel: Channel }> {
    if (!Number.isFinite(params.settings.pulseIntervalMs) || params.settings.pulseIntervalMs <= 0) {
      throw new Error("pulseIntervalMs must be greater than 0");
    }

    const simId = createId();
    const input: CreateSimulationInput = {
      id: simId,
      name: params.name,
      agentIds: params.agentIds,
      channelIds: [],
      settings: params.settings,
      seed: params.seed,
    };

    const simulation = await this.simRepo.create(input);

    const defaultChannel = await this.channelRegistry.createChannel({
      simulationId: simId,
      type: "public_channel",
      name: "general",
      createdBy: "system",
      memberAgentIds: params.agentIds,
      spectatorVisible: true,
    });

    await this.simRepo.updateSettings(simId, {});
    // Store channelId reference by updating — simRepo doesn't have addChannel but we track via channelRegistry
    await this.gateway.createChannel(defaultChannel.id, "public_channel", params.agentIds);

    return { simulation, defaultChannel };
  }

  async start(simulationId: string): Promise<void> {
    const sim = await this.getOrThrow(simulationId);
    await this.lifecycle.start(sim, 0);
  }

  async pause(simulationId: string, pulseIndex: number): Promise<void> {
    const sim = await this.getOrThrow(simulationId);
    await this.lifecycle.pause(sim, pulseIndex);
  }

  async resume(simulationId: string, pulseIndex: number): Promise<void> {
    const sim = await this.getOrThrow(simulationId);
    await this.lifecycle.resume(sim, pulseIndex);
  }

  async stop(simulationId: string, pulseIndex: number): Promise<void> {
    const sim = await this.getOrThrow(simulationId);
    await this.lifecycle.stop(sim, pulseIndex);
    await this.gateway.onSimulationStopped(simulationId);
  }

  async get(simulationId: string): Promise<Simulation | null> {
    return this.simRepo.get(simulationId);
  }

  private async getOrThrow(simulationId: string): Promise<Simulation> {
    const sim = await this.simRepo.get(simulationId);
    if (!sim) throw new Error(`Simulation not found: ${simulationId}`);
    return sim;
  }
}
