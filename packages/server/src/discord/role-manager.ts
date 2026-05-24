import type { DiscordGuildPort } from "./discord-guild-port.js";
import type { ChannelMap } from "./channel-map.js";

export type RoleManagerDeps = {
  guild: DiscordGuildPort;
  channelMap: ChannelMap;
  botUserIdByAgentId: Map<string, string>;
  discordGuildId: string;
};

export class DiscordRoleManager {
  private readonly guild: DiscordGuildPort;
  private readonly channelMap: ChannelMap;
  private readonly botUserIdByAgentId: Map<string, string>;
  private readonly discordGuildId: string;

  constructor(deps: RoleManagerDeps) {
    this.guild = deps.guild;
    this.channelMap = deps.channelMap;
    this.botUserIdByAgentId = deps.botUserIdByAgentId;
    this.discordGuildId = deps.discordGuildId;
  }

  async ensurePublicChannel(opts: {
    simulationId: string;
    channelId: string;
    channelName: string;
  }): Promise<string> {
    const existing = this.channelMap.get(opts.simulationId, opts.channelId);
    if (existing) return existing.discordChannelId;

    const ch = await this.guild.createTextChannel({
      name: `pm-${opts.simulationId}-${opts.channelName}`,
      reason: `perfectman public channel: ${opts.channelId}`,
    });

    this.channelMap.upsert({
      simulationId: opts.simulationId,
      channelId: opts.channelId,
      channelType: "public_channel",
      discordGuildId: this.discordGuildId,
      discordChannelId: ch.id,
      lastSyncedAt: Date.now(),
    });

    return ch.id;
  }

  async ensureSpectatorChannel(simulationId: string): Promise<string> {
    return this.ensurePublicChannel({
      simulationId,
      channelId: "__spectator",
      channelName: "spectator",
    });
  }

  async ensureOperatorChannel(
    simulationId: string,
    managerBotUserId?: string,
  ): Promise<string> {
    const existing = this.channelMap.get(simulationId, "__operator");
    if (existing) return existing.discordChannelId;

    const overwrites: import("./discord-guild-port.js").PermissionOverwriteInput[] = [
      { id: this.guild.everyoneRoleId(), deny: ["ViewChannel"] },
    ];

    if (managerBotUserId) {
      overwrites.push({
        id: managerBotUserId,
        allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"],
      });
    }

    const ch = await this.guild.createTextChannel({
      name: `pm-${simulationId}-operator`,
      reason: "perfectman operator channel",
      permissionOverwrites: overwrites,
    });

    this.channelMap.upsert({
      simulationId,
      channelId: "__operator",
      channelType: "operator_channel",
      discordGuildId: this.discordGuildId,
      discordChannelId: ch.id,
      lastSyncedAt: Date.now(),
    });

    return ch.id;
  }

  async createPrivateChannel(opts: {
    simulationId: string;
    channelId: string;
    channelName: string;
    memberAgentIds: string[];
    managerBotUserId?: string;
  }): Promise<string> {
    const existing = this.channelMap.get(opts.simulationId, opts.channelId);
    if (existing) return existing.discordChannelId;

    const role = await this.guild.createRole({
      name: `pm-${opts.simulationId}-role-${opts.channelId}`,
      reason: `perfectman private channel role: ${opts.channelId}`,
      mentionable: false,
    });

    const overwrites: import("./discord-guild-port.js").PermissionOverwriteInput[] = [
      { id: this.guild.everyoneRoleId(), deny: ["ViewChannel"] },
      {
        id: role.id,
        allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"],
      },
    ];

    if (opts.managerBotUserId) {
      overwrites.push({
        id: opts.managerBotUserId,
        allow: ["ViewChannel", "SendMessages", "ManageChannels"],
      });
    }

    const ch = await this.guild.createTextChannel({
      name: `pm-${opts.simulationId}-priv-${opts.channelName}`,
      reason: `perfectman private channel: ${opts.channelId}`,
      permissionOverwrites: overwrites,
    });

    for (const agentId of opts.memberAgentIds) {
      const userId = this.botUserIdByAgentId.get(agentId);
      if (!userId) continue;
      const member = await this.guild.fetchMember(userId);
      if (member) await member.addRole(role.id, "perfectman: initial member");
    }

    this.channelMap.upsert({
      simulationId: opts.simulationId,
      channelId: opts.channelId,
      channelType: "private_channel",
      discordGuildId: this.discordGuildId,
      discordChannelId: ch.id,
      discordRoleId: role.id,
      lastSyncedAt: Date.now(),
    });

    return ch.id;
  }

  async addMember(
    simulationId: string,
    channelId: string,
    agentId: string,
  ): Promise<void> {
    const entry = this.channelMap.get(simulationId, channelId);
    if (!entry?.discordRoleId) return;

    const userId = this.botUserIdByAgentId.get(agentId);
    if (!userId) return;

    const member = await this.guild.fetchMember(userId);
    if (member) await member.addRole(entry.discordRoleId, "perfectman: add member");
  }

  async removeMember(
    simulationId: string,
    channelId: string,
    agentId: string,
  ): Promise<void> {
    const entry = this.channelMap.get(simulationId, channelId);
    if (!entry?.discordRoleId) return;

    const userId = this.botUserIdByAgentId.get(agentId);
    if (!userId) return;

    const member = await this.guild.fetchMember(userId);
    if (member) await member.removeRole(entry.discordRoleId, "perfectman: remove member");
  }

  async lockAllChannels(simulationId: string): Promise<void> {
    const entries = this.channelMap.allForSimulation(simulationId);
    for (const entry of entries) {
      if (!entry.discordRoleId) continue;
      const ch = await this.guild.fetchTextChannel(entry.discordChannelId);
      if (!ch) continue;
      await ch.editPermissionOverwrite(
        entry.discordRoleId,
        { SendMessages: false },
        "perfectman: simulation stopped",
      );
    }
  }
}
