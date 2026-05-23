import type {
  Simulation,
  SimulationStatus,
  SimulationEvent,
} from "@perfectman/shared";
import type { ISimulationRepository } from "../persistence/repositories.js";
import type { EventLog } from "./event-log.js";

const LIFECYCLE_VISIBILITY = {
  visibleToAgents: [] as string[],
  visibleToSpectators: true,
  visibleToOperators: true,
  visibilityReason: "lifecycle",
} as const;

export class SimulationLifecycle {
  constructor(
    private readonly simRepo: ISimulationRepository,
    private readonly eventLog: EventLog,
  ) {}

  async start(simulation: Simulation, pulseIndex: number): Promise<void> {
    this.assertStatus(simulation, "initializing");
    await this.simRepo.updateStatus(simulation.id, "running");
    const event: SimulationEvent = {
      simulationId: simulation.id,
      channelId: simulation.channelIds[0] ?? "default",
      actorId: "system",
      type: "simulation_started",
      payload: { simulationId: simulation.id },
      sourceEventIds: [],
      emotionalSalience: "low",
      pulseIndex,
      visibility: LIFECYCLE_VISIBILITY,
    };
    await this.eventLog.append(simulation.id, [event]);
  }

  async pause(simulation: Simulation, pulseIndex: number): Promise<void> {
    this.assertStatus(simulation, "running");
    await this.simRepo.updateStatus(simulation.id, "paused");
    const event: SimulationEvent = {
      simulationId: simulation.id,
      channelId: simulation.channelIds[0] ?? "default",
      actorId: "system",
      type: "simulation_paused",
      payload: { simulationId: simulation.id },
      sourceEventIds: [],
      emotionalSalience: "low",
      pulseIndex,
      visibility: LIFECYCLE_VISIBILITY,
    };
    await this.eventLog.append(simulation.id, [event]);
  }

  async resume(simulation: Simulation, pulseIndex: number): Promise<void> {
    this.assertStatus(simulation, "paused");
    await this.simRepo.updateStatus(simulation.id, "running");
    const event: SimulationEvent = {
      simulationId: simulation.id,
      channelId: simulation.channelIds[0] ?? "default",
      actorId: "system",
      type: "simulation_resumed",
      payload: { simulationId: simulation.id },
      sourceEventIds: [],
      emotionalSalience: "low",
      pulseIndex,
      visibility: LIFECYCLE_VISIBILITY,
    };
    await this.eventLog.append(simulation.id, [event]);
  }

  async stop(simulation: Simulation, pulseIndex: number): Promise<void> {
    if (simulation.status === "stopped") return;
    await this.simRepo.updateStatus(simulation.id, "stopped");
    const event: SimulationEvent = {
      simulationId: simulation.id,
      channelId: simulation.channelIds[0] ?? "default",
      actorId: "system",
      type: "simulation_stopped",
      payload: { simulationId: simulation.id },
      sourceEventIds: [],
      emotionalSalience: "low",
      pulseIndex,
      visibility: LIFECYCLE_VISIBILITY,
    };
    await this.eventLog.append(simulation.id, [event]);
  }

  private assertStatus(sim: Simulation, expected: SimulationStatus): void {
    if (sim.status !== expected) {
      throw new Error(`Expected simulation status '${expected}', got '${sim.status}'`);
    }
  }
}
