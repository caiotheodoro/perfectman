/**
 * Repository interfaces — owned by Dev3.
 * Dev2 implements in-memory versions for MVP.
 * Dev3 implements SQLite versions.
 *
 * All methods are platform-agnostic — no Socket.IO or HTTP concepts here.
 * These are event-oriented persistence contracts.
 */

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

// ── Event Repository ──────────────────────────────────────────────────────────

export type IEventRepository = {
  /**
   * Append events to the log. Assigns id, createdAt, pulseIndex.
   * Returns the committed events with assigned fields.
   */
  append(simulationId: string, events: SimulationEvent[]): Promise<CommittedEvent[]>;

  /** Get a single event by id */
  getById(simulationId: string, eventId: string): Promise<CommittedEvent | null>;

  /**
   * Get events after a given event id (exclusive), ordered by createdAt asc.
   * If afterEventId is undefined, returns all events for the simulation.
   */
  getAfter(simulationId: string, afterEventId?: string): Promise<CommittedEvent[]>;

  /**
   * Get all committed events up through a given pulseIndex (inclusive).
   */
  getCommittedThrough(simulationId: string, pulseIndex: number): Promise<CommittedEvent[]>;

  /**
   * Get the N most recent events for a simulation (for context window).
   */
  getRecent(simulationId: string, limit: number): Promise<CommittedEvent[]>;
};

// ── Agent State Repository ────────────────────────────────────────────────────

export type IAgentStateRepository = {
  /** Get agent state for a specific agent in a simulation. Returns null if not found. */
  get(simulationId: string, agentId: string): Promise<AgentState | null>;

  /** Create or update agent state. */
  upsert(agentState: AgentState): Promise<void>;

  /** List all agent states for a simulation. */
  listBySimulation(simulationId: string): Promise<AgentState[]>;
};

// ── Memory Repository ─────────────────────────────────────────────────────────

export type IMemoryRepository = {
  /** Get all memories written by an agent in a simulation. */
  getByAgent(simulationId: string, agentId: string): Promise<Memory[]>;

  /** Create or update a memory. */
  upsert(memory: Memory): Promise<void>;

  /** Get memories where a specific agent is a subject. */
  getBySubject(simulationId: string, subjectAgentId: string): Promise<Memory[]>;
};

// ── Simulation Repository ─────────────────────────────────────────────────────

export type CreateSimulationInput = {
  id: string;
  name: string;
  agentIds: string[];
  channelIds: string[];
  settings: SimulationSettings;
  seed: number;
};

export type ISimulationRepository = {
  create(input: CreateSimulationInput): Promise<Simulation>;
  get(simulationId: string): Promise<Simulation | null>;
  updateStatus(simulationId: string, status: SimulationStatus): Promise<void>;
  updateSettings(simulationId: string, settings: Partial<SimulationSettings>): Promise<void>;
  list(): Promise<Simulation[]>;
};

// ── Channel Repository ────────────────────────────────────────────────────────

export type IChannelRepository = {
  create(channel: Channel): Promise<Channel>;
  getById(channelId: string): Promise<Channel | null>;
  listBySimulation(simulationId: string): Promise<Channel[]>;
  updateMembers(channelId: string, memberAgentIds: string[]): Promise<void>;
  archive(channelId: string): Promise<void>;
  getMembership(channelId: string): Promise<ChannelMembership[]>;
  addMembership(membership: ChannelMembership): Promise<void>;
  removeMembership(channelId: string, agentId: string): Promise<void>;
};
