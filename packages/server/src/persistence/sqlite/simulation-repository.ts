/**
 * SQLite implementation of ISimulationRepository.
 */

import type { Simulation, SimulationStatus, SimulationSettings } from "@perfectman/shared";
import type { ISimulationRepository, CreateSimulationInput } from "../repositories.js";
import type { DB } from "./database.js";

type SimulationRow = {
  id: string;
  name: string;
  status: string;
  agent_ids: string;
  channel_ids: string;
  settings: string;
  seed: number;
  created_at: number;
  updated_at: number;
};

function rowToSimulation(row: SimulationRow): Simulation {
  return {
    id: row.id,
    name: row.name,
    status: row.status as SimulationStatus,
    agentIds: JSON.parse(row.agent_ids) as string[],
    channelIds: JSON.parse(row.channel_ids) as string[],
    settings: JSON.parse(row.settings) as SimulationSettings,
    seed: row.seed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteSimulationRepository implements ISimulationRepository {
  constructor(private readonly db: DB) {}

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

    this.db
      .prepare(
        `INSERT INTO simulations
           (id, name, status, agent_ids, channel_ids, settings, seed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        simulation.id,
        simulation.name,
        simulation.status,
        JSON.stringify(simulation.agentIds),
        JSON.stringify(simulation.channelIds),
        JSON.stringify(simulation.settings),
        simulation.seed,
        simulation.createdAt,
        simulation.updatedAt,
      );

    return Promise.resolve(simulation);
  }

  get(simulationId: string): Promise<Simulation | null> {
    const row = this.db
      .prepare(`SELECT * FROM simulations WHERE id = ?`)
      .get(simulationId) as SimulationRow | undefined;

    return Promise.resolve(row ? rowToSimulation(row) : null);
  }

  updateStatus(simulationId: string, status: SimulationStatus): Promise<void> {
    this.db
      .prepare(`UPDATE simulations SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, Date.now(), simulationId);

    return Promise.resolve();
  }

  updateSettings(
    simulationId: string,
    settings: Partial<SimulationSettings>,
  ): Promise<void> {
    const existing = this.db
      .prepare(`SELECT settings FROM simulations WHERE id = ?`)
      .get(simulationId) as { settings: string } | undefined;

    if (!existing) return Promise.resolve();

    const merged = {
      ...(JSON.parse(existing.settings) as SimulationSettings),
      ...settings,
    };

    this.db
      .prepare(`UPDATE simulations SET settings = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(merged), Date.now(), simulationId);

    return Promise.resolve();
  }

  list(): Promise<Simulation[]> {
    const rows = this.db
      .prepare(`SELECT * FROM simulations ORDER BY created_at ASC`)
      .all() as SimulationRow[];

    return Promise.resolve(rows.map(rowToSimulation));
  }
}
