import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type TextChannel,
  type OverwriteResolvable,
} from "discord.js";
import type {
  CreateTextChannelInput,
  DiscordGuildPort,
  DiscordMemberPort,
  DiscordRolePort,
  DiscordTextChannelPort,
  PermissionName,
  PermissionOverwriteInput,
} from "./discord-guild-port.js";

const PERM_MAP: Record<PermissionName, bigint> = {
  ViewChannel: PermissionFlagsBits.ViewChannel,
  SendMessages: PermissionFlagsBits.SendMessages,
  ReadMessageHistory: PermissionFlagsBits.ReadMessageHistory,
  ManageChannels: PermissionFlagsBits.ManageChannels,
  ManageRoles: PermissionFlagsBits.ManageRoles,
  AddReactions: PermissionFlagsBits.AddReactions,
};

function toOverwriteResolvable(input: PermissionOverwriteInput): OverwriteResolvable {
  let allow = BigInt(0);
  let deny = BigInt(0);
  for (const p of input.allow ?? []) allow |= PERM_MAP[p];
  for (const p of input.deny ?? []) deny |= PERM_MAP[p];
  return { id: input.id, allow, deny };
}

function wrapTextChannel(channel: TextChannel): DiscordTextChannelPort {
  return {
    id: channel.id,
    async send(input) {
      const msg = await channel.send(input);
      return { id: msg.id };
    },
    async sendTyping() {
      await channel.sendTyping();
    },
    async setPermissionOverwrites(overwrites, reason) {
      await channel.permissionOverwrites.set(
        overwrites.map(toOverwriteResolvable),
        reason,
      );
    },
    async editPermissionOverwrite(id, permissions, reason) {
      await channel.permissionOverwrites.edit(id, permissions, { reason });
    },
    async permissionsForMember(userId) {
      const member = await channel.guild.members.fetch(userId);
      const perms = channel.permissionsFor(member);
      const result = new Set<PermissionName>();
      for (const [name, bit] of Object.entries(PERM_MAP)) {
        if (perms?.has(bit)) result.add(name as PermissionName);
      }
      return result;
    },
  };
}

function wrapMember(member: GuildMember): DiscordMemberPort {
  return {
    userId: member.id,
    async addRole(roleId, reason) {
      await member.roles.add(roleId, reason);
    },
    async removeRole(roleId, reason) {
      await member.roles.remove(roleId, reason);
    },
  };
}

export class DiscordJsGuildAdapter implements DiscordGuildPort {
  constructor(private readonly guild: Guild) {}

  everyoneRoleId(): string {
    return this.guild.id;
  }

  async fetchTextChannel(id: string): Promise<DiscordTextChannelPort | null> {
    const channel = await this.guild.channels.fetch(id).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return null;
    return wrapTextChannel(channel as TextChannel);
  }

  async createTextChannel(input: CreateTextChannelInput): Promise<DiscordTextChannelPort> {
    const channel = await this.guild.channels.create({
      name: input.name,
      type: ChannelType.GuildText,
      reason: input.reason,
      permissionOverwrites: input.permissionOverwrites?.map(toOverwriteResolvable),
    });
    return wrapTextChannel(channel);
  }

  async fetchRole(id: string): Promise<DiscordRolePort | null> {
    const role = await this.guild.roles.fetch(id).catch(() => null);
    if (!role) return null;
    return { id: role.id, name: role.name };
  }

  async createRole(input: {
    name: string;
    reason: string;
    mentionable: boolean;
  }): Promise<DiscordRolePort> {
    const role = await this.guild.roles.create({
      name: input.name,
      reason: input.reason,
      mentionable: input.mentionable,
    });
    return { id: role.id, name: role.name };
  }

  async fetchMember(userId: string): Promise<DiscordMemberPort | null> {
    const member = await this.guild.members.fetch(userId).catch(() => null);
    if (!member) return null;
    return wrapMember(member);
  }
}
