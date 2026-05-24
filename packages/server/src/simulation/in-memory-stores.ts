import type {
  CommittedEvent,
  SimulationEvent,
  AgentState,
  Memory,
  Simulation,
  SimulationStatus,
  SimulationSettings,
  Channel,
  ChannelMembership,
} from "@perfectman/shared";
import type {
  IEventRepository,
  IAgentStateRepository,
  IMemoryRepository,
  ISimulationRepository,
  IChannelRepository,
  CreateSimulationInput,
} from "../persistence/repositories.js";

let _counter = 0;
function generateEventId(): string {
  return `evt_${Date.now()}_${(++_counter).toString(36)}`;
}

export class InMemoryEventRepository implements IEventRepository {
  private readonly events = new Map<string, CommittedEvent[]>();

  append(simulationId: string, events: SimulationEvent[]): Promise<CommittedEvent[]> {
    if (events.length === 0) return Promise.resolve([]);
    const log = this.events.get(simulationId) ?? [];
    const now = Date.now();
    const committed: CommittedEvent[] = events.map((evt) => {
      const committedEvent: CommittedEvent = {
        ...evt,
        id: evt.id ?? generateEventId(),
        createdAt: evt.createdAt ?? now,
        pulseIndex: evt.pulseIndex ?? 0,
        simulationId,
      };
      return committedEvent;
    });
    this.events.set(simulationId, [...log, ...committed]);
    return Promise.resolve(committed);
  }

  getById(simulationId: string, eventId: string): Promise<CommittedEvent | null> {
    const log = this.events.get(simulationId) ?? [];
    return Promise.resolve(log.find(e => e.id === eventId) ?? null);
  }

  getAfter(simulationId: string, afterEventId?: string): Promise<CommittedEvent[]> {
    const log = this.events.get(simulationId) ?? [];
    if (!afterEventId) return Promise.resolve([...log]);
    const idx = log.findIndex(e => e.id === afterEventId);
    if (idx === -1) {
      return Promise.reject(new Error(`Event not found in simulation ${simulationId}: ${afterEventId}`));
    }
    return Promise.resolve(log.slice(idx + 1));
  }

  getCommittedThrough(simulationId: string, pulseIndex: number): Promise<CommittedEvent[]> {
    const log = this.events.get(simulationId) ?? [];
    return Promise.resolve(log.filter(e => e.pulseIndex <= pulseIndex));
  }

  getRecent(simulationId: string, limit: number): Promise<CommittedEvent[]> {
    const log = this.events.get(simulationId) ?? [];
    return Promise.resolve(log.slice(-limit));
  }
}

export class InMemoryAgentStateRepository implements IAgentStateRepository {
  private readonly states = new Map<string, AgentState>();

  private key(simulationId: string, agentId: string): string {
    return `${simulationId}:${agentId}`;
  }

  get(simulationId: string, agentId: string): Promise<AgentState | null> {
    return Promise.resolve(this.states.get(this.key(simulationId, agentId)) ?? null);
  }

  upsert(agentState: AgentState): Promise<void> {
    this.states.set(this.key(agentState.simulationId, agentState.agentId), agentState);
    return Promise.resolve();
  }

  listBySimulation(simulationId: string): Promise<AgentState[]> {
    const result: AgentState[] = [];
    for (const [key, state] of this.states) {
      if (key.startsWith(`${simulationId}:`)) result.push(state);
    }
    return Promise.resolve(result);
  }
}

export class InMemoryMemoryRepository implements IMemoryRepository {
  private readonly memories = new Map<string, Memory[]>();

  private simKey(simulationId: string, agentId: string): string {
    return `${simulationId}:${agentId}`;
  }

  getByAgent(simulationId: string, agentId: string): Promise<Memory[]> {
    return Promise.resolve([...(this.memories.get(this.simKey(simulationId, agentId)) ?? [])]);
  }

  upsert(memory: Memory): Promise<void> {
    const key = this.simKey(memory.simulationId, memory.agentId);
    const list = this.memories.get(key) ?? [];
    const idx = list.findIndex(m => m.id === memory.id);
    if (idx === -1) {
      this.memories.set(key, [...list, memory]);
    } else {
      const updated = [...list];
      updated[idx] = memory;
      this.memories.set(key, updated);
    }
    return Promise.resolve();
  }

  getBySubject(simulationId: string, subjectAgentId: string): Promise<Memory[]> {
    const result: Memory[] = [];
    for (const [key, mems] of this.memories) {
      if (key.startsWith(`${simulationId}:`)) {
        result.push(...mems.filter(m => m.subjectAgentIds.includes(subjectAgentId)));
      }
    }
    return Promise.resolve(result);
  }
}

export class InMemorySimulationRepository implements ISimulationRepository {
  private readonly simulations = new Map<string, Simulation>();

  create(input: CreateSimulationInput): Promise<Simulation> {
    const now = Date.now();
    const simulation: Simulation = {
      id: input.id,
      name: input.name,
      status: "initializing",
      agentIds: input.agentIds,
      channelIds: input.channelIds,
      settings: input.settings,
      seed: input.seed,
      createdAt: now,
      updatedAt: now,
    };
    this.simulations.set(simulation.id, simulation);
    return Promise.resolve(simulation);
  }

  get(simulationId: string): Promise<Simulation | null> {
    return Promise.resolve(this.simulations.get(simulationId) ?? null);
  }

  updateStatus(simulationId: string, status: SimulationStatus): Promise<void> {
    const sim = this.simulations.get(simulationId);
    if (sim) this.simulations.set(simulationId, { ...sim, status, updatedAt: Date.now() });
    return Promise.resolve();
  }

  updateSettings(simulationId: string, settings: Partial<SimulationSettings>): Promise<void> {
    const sim = this.simulations.get(simulationId);
    if (sim) {
      this.simulations.set(simulationId, {
        ...sim,
        settings: { ...sim.settings, ...settings },
        updatedAt: Date.now(),
      });
    }
    return Promise.resolve();
  }

  list(): Promise<Simulation[]> {
    return Promise.resolve([...this.simulations.values()]);
  }
}

export class InMemoryChannelRepository implements IChannelRepository {
  private readonly channels = new Map<string, Channel>();
  private readonly memberships = new Map<string, ChannelMembership[]>();

  create(channel: Channel): Promise<Channel> {
    this.channels.set(channel.id, channel);
    return Promise.resolve(channel);
  }

  getById(channelId: string): Promise<Channel | null> {
    return Promise.resolve(this.channels.get(channelId) ?? null);
  }

  listBySimulation(simulationId: string): Promise<Channel[]> {
    return Promise.resolve(
      [...this.channels.values()].filter(c => c.simulationId === simulationId),
    );
  }

  updateMembers(channelId: string, memberAgentIds: string[]): Promise<void> {
    const ch = this.channels.get(channelId);
    if (ch) this.channels.set(channelId, { ...ch, memberAgentIds, updatedAt: Date.now() });
    return Promise.resolve();
  }

  archive(channelId: string): Promise<void> {
    const ch = this.channels.get(channelId);
    if (ch) this.channels.set(channelId, { ...ch, status: "archived", updatedAt: Date.now() });
    return Promise.resolve();
  }

  getMembership(channelId: string): Promise<ChannelMembership[]> {
    return Promise.resolve([...(this.memberships.get(channelId) ?? [])]);
  }

  addMembership(membership: ChannelMembership): Promise<void> {
    const list = this.memberships.get(membership.channelId) ?? [];
    const existing = list.findIndex(
      m => m.agentId === membership.agentId && !m.leftAt,
    );
    if (existing === -1) {
      this.memberships.set(membership.channelId, [...list, membership]);
    }
    return Promise.resolve();
  }

  removeMembership(channelId: string, agentId: string): Promise<void> {
    const list = this.memberships.get(channelId) ?? [];
    const updated = list.map(m =>
      m.agentId === agentId && !m.leftAt ? { ...m, leftAt: Date.now() } : m,
    );
    this.memberships.set(channelId, updated);
    const ch = this.channels.get(channelId);
    if (ch) {
      this.channels.set(channelId, {
        ...ch,
        memberAgentIds: ch.memberAgentIds.filter(id => id !== agentId),
        updatedAt: Date.now(),
      });
    }
    return Promise.resolve();
  }
}
