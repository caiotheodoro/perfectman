import type { SimulationEvent, CommittedEvent } from "@perfectman/shared";
import type { IEventRepository } from "../persistence/repositories.js";

export class EventLog {
  constructor(private readonly repo: IEventRepository) {}

  append(simulationId: string, events: SimulationEvent[]): Promise<CommittedEvent[]> {
    return this.repo.append(simulationId, events);
  }

  getAfter(simulationId: string, afterEventId?: string): Promise<CommittedEvent[]> {
    return this.repo.getAfter(simulationId, afterEventId);
  }

  getById(simulationId: string, eventId: string): Promise<CommittedEvent | null> {
    return this.repo.getById(simulationId, eventId);
  }

  getCommittedThrough(simulationId: string, pulseIndex: number): Promise<CommittedEvent[]> {
    return this.repo.getCommittedThrough(simulationId, pulseIndex);
  }

  getRecent(simulationId: string, limit: number): Promise<CommittedEvent[]> {
    return this.repo.getRecent(simulationId, limit);
  }
}
