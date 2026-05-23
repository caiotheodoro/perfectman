import type { Channel, ChannelMembership, ChannelType } from "@perfectman/shared";
import { createId } from "@perfectman/shared";
import type { IChannelRepository } from "../persistence/repositories.js";

export class ChannelRegistry {
  constructor(private readonly repo: IChannelRepository) {}

  async createChannel(params: {
    simulationId: string;
    type: ChannelType;
    name: string;
    createdBy: string;
    memberAgentIds: string[];
    spectatorVisible: boolean;
    createdForMotives?: string[];
  }): Promise<Channel> {
    const now = Date.now();
    const channel: Channel = {
      id: createId(),
      simulationId: params.simulationId,
      type: params.type,
      name: params.name,
      createdBy: params.createdBy,
      memberAgentIds: params.memberAgentIds,
      spectatorVisible: params.spectatorVisible,
      operatorVisible: true,
      createdForMotives: params.createdForMotives ?? [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.create(channel);
    for (const agentId of params.memberAgentIds) {
      await this.repo.addMembership({ channelId: channel.id, agentId, joinedAt: now });
    }
    return channel;
  }

  async addMember(channelId: string, agentId: string): Promise<void> {
    const ch = await this.repo.getById(channelId);
    if (!ch) throw new Error(`Channel not found: ${channelId}`);
    const newMembers = ch.memberAgentIds.includes(agentId)
      ? ch.memberAgentIds
      : [...ch.memberAgentIds, agentId];
    await this.repo.updateMembers(channelId, newMembers);
    await this.repo.addMembership({ channelId, agentId, joinedAt: Date.now() });
  }

  async removeMember(channelId: string, agentId: string): Promise<void> {
    await this.repo.removeMembership(channelId, agentId);
  }

  async isMember(agentId: string, channelId: string): Promise<boolean> {
    const memberships = await this.repo.getMembership(channelId);
    return memberships.some(m => m.agentId === agentId && !m.leftAt);
  }

  async getMembershipsForSimulation(simulationId: string): Promise<ChannelMembership[]> {
    const channels = await this.repo.listBySimulation(simulationId);
    const results: ChannelMembership[] = [];
    for (const ch of channels) {
      const ms = await this.repo.getMembership(ch.id);
      results.push(...ms);
    }
    return results;
  }

  async getChannels(simulationId: string): Promise<Channel[]> {
    return this.repo.listBySimulation(simulationId);
  }

  async archiveChannel(channelId: string): Promise<void> {
    await this.repo.archive(channelId);
  }
}
