/**
 * SQLite implementation of IChannelRepository.
 */

import type {
  Channel,
  ChannelType,
  ChannelMembership,
} from "@perfectman/shared";
import type { IChannelRepository } from "../repositories.js";
import type { DB } from "./database.js";

type ChannelRow = {
  id: string;
  simulation_id: string;
  type: string;
  name: string;
  created_by: string;
  member_agent_ids: string;
  spectator_visible: number;
  operator_visible: number;
  created_for_motives: string;
  status: string;
  created_at: number;
  updated_at: number;
};

type MembershipRow = {
  channel_id: string;
  agent_id: string;
  joined_at: number;
  left_at: number | null;
};

function rowToChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    simulationId: row.simulation_id,
    type: row.type as ChannelType,
    name: row.name,
    createdBy: row.created_by,
    memberAgentIds: JSON.parse(row.member_agent_ids) as string[],
    spectatorVisible: row.spectator_visible === 1,
    operatorVisible: row.operator_visible === 1,
    createdForMotives: JSON.parse(row.created_for_motives) as string[],
    status: row.status as "active" | "archived",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMembership(row: MembershipRow): ChannelMembership {
  return {
    channelId: row.channel_id,
    agentId: row.agent_id,
    joinedAt: row.joined_at,
    leftAt: row.left_at ?? undefined,
  };
}

export class SqliteChannelRepository implements IChannelRepository {
  constructor(private readonly db: DB) {}

  create(channel: Channel): Promise<Channel> {
    this.db
      .prepare(
        `INSERT INTO channels
           (id, simulation_id, type, name, created_by, member_agent_ids,
            spectator_visible, operator_visible, created_for_motives, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        channel.id,
        channel.simulationId,
        channel.type,
        channel.name,
        channel.createdBy,
        JSON.stringify(channel.memberAgentIds),
        channel.spectatorVisible ? 1 : 0,
        channel.operatorVisible ? 1 : 0,
        JSON.stringify(channel.createdForMotives),
        channel.status,
        channel.createdAt,
        channel.updatedAt,
      );

    return Promise.resolve(channel);
  }

  getById(channelId: string): Promise<Channel | null> {
    const row = this.db
      .prepare(`SELECT * FROM channels WHERE id = ?`)
      .get(channelId) as ChannelRow | undefined;

    return Promise.resolve(row ? rowToChannel(row) : null);
  }

  listBySimulation(simulationId: string): Promise<Channel[]> {
    const rows = this.db
      .prepare(`SELECT * FROM channels WHERE simulation_id = ? ORDER BY created_at ASC`)
      .all(simulationId) as ChannelRow[];

    return Promise.resolve(rows.map(rowToChannel));
  }

  updateMembers(channelId: string, memberAgentIds: string[]): Promise<void> {
    this.db
      .prepare(`UPDATE channels SET member_agent_ids = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(memberAgentIds), Date.now(), channelId);

    return Promise.resolve();
  }

  archive(channelId: string): Promise<void> {
    this.db
      .prepare(`UPDATE channels SET status = 'archived', updated_at = ? WHERE id = ?`)
      .run(Date.now(), channelId);

    return Promise.resolve();
  }

  getMembership(channelId: string): Promise<ChannelMembership[]> {
    const rows = this.db
      .prepare(`SELECT * FROM channel_memberships WHERE channel_id = ?`)
      .all(channelId) as MembershipRow[];

    return Promise.resolve(rows.map(rowToMembership));
  }

  addMembership(membership: ChannelMembership): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO channel_memberships (channel_id, agent_id, joined_at, left_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        membership.channelId,
        membership.agentId,
        membership.joinedAt,
        membership.leftAt ?? null,
      );

    return Promise.resolve();
  }

  removeMembership(channelId: string, agentId: string): Promise<void> {
    this.db
      .prepare(
        `UPDATE channel_memberships SET left_at = ? WHERE channel_id = ? AND agent_id = ?`,
      )
      .run(Date.now(), channelId, agentId);

    return Promise.resolve();
  }
}
