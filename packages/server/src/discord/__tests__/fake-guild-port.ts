import type {
  CreateTextChannelInput,
  DiscordGuildPort,
  DiscordMemberPort,
  DiscordRolePort,
  DiscordTextChannelPort,
  PermissionName,
  PermissionOverwriteInput,
} from "../discord-guild-port.js";

let nextId = 1;
function snowflake(): string {
  return `fake-${nextId++}`;
}

export type FakeChannelRecord = {
  port: DiscordTextChannelPort;
  name: string;
  overwrites: PermissionOverwriteInput[];
  sentMessages: Array<{ content: string; allowedMentions: { parse: [] } }>;
};

export type FakeRoleRecord = { id: string; name: string };

export type FakeMemberRecord = {
  userId: string;
  roles: Set<string>;
};

export class FakeGuildPort implements DiscordGuildPort {
  readonly channels = new Map<string, FakeChannelRecord>();
  readonly roles = new Map<string, FakeRoleRecord>();
  readonly members = new Map<string, FakeMemberRecord>();
  private readonly guildEveryoneRoleId: string;

  constructor(everyoneId = "everyone-role") {
    this.guildEveryoneRoleId = everyoneId;
  }

  everyoneRoleId(): string {
    return this.guildEveryoneRoleId;
  }

  addMemberRecord(userId: string): FakeMemberRecord {
    const rec: FakeMemberRecord = { userId, roles: new Set() };
    this.members.set(userId, rec);
    return rec;
  }

  async fetchTextChannel(id: string): Promise<DiscordTextChannelPort | null> {
    return this.channels.get(id)?.port ?? null;
  }

  async createTextChannel(input: CreateTextChannelInput): Promise<DiscordTextChannelPort> {
    const id = snowflake();
    const overwrites = input.permissionOverwrites ?? [];
    const sentMessages: FakeChannelRecord["sentMessages"] = [];

    const port: DiscordTextChannelPort = {
      id,
      async send(msg) {
        sentMessages.push(msg);
        return { id: snowflake() };
      },
      async sendTyping() {},
      async setPermissionOverwrites(ow, _reason) {
        rec.overwrites = ow;
      },
      async editPermissionOverwrite(targetId, permissions, _reason) {
        let existing = rec.overwrites.find((o) => o.id === targetId);
        if (!existing) {
          existing = { id: targetId };
          rec.overwrites.push(existing);
        }
        for (const [name, value] of Object.entries(permissions)) {
          const perm = name as PermissionName;
          if (value) {
            existing.allow = [...(existing.allow ?? []), perm];
            existing.deny = (existing.deny ?? []).filter((d) => d !== perm);
          } else {
            existing.deny = [...(existing.deny ?? []), perm];
            existing.allow = (existing.allow ?? []).filter((a) => a !== perm);
          }
        }
      },
      async permissionsForMember(_userId) {
        return new Set<PermissionName>();
      },
    };

    const rec: FakeChannelRecord = { port, name: input.name, overwrites, sentMessages };
    this.channels.set(id, rec);
    return port;
  }

  async fetchRole(id: string): Promise<DiscordRolePort | null> {
    return this.roles.get(id) ?? null;
  }

  async createRole(input: {
    name: string;
    reason: string;
    mentionable: boolean;
  }): Promise<DiscordRolePort> {
    const id = snowflake();
    const role: FakeRoleRecord = { id, name: input.name };
    this.roles.set(id, role);
    return role;
  }

  async fetchMember(userId: string): Promise<DiscordMemberPort | null> {
    const rec = this.members.get(userId);
    if (!rec) return null;
    return {
      userId,
      async addRole(roleId, _reason) {
        rec.roles.add(roleId);
      },
      async removeRole(roleId, _reason) {
        rec.roles.delete(roleId);
      },
    };
  }

  getChannelOverwrites(channelId: string): PermissionOverwriteInput[] {
    return this.channels.get(channelId)?.overwrites ?? [];
  }

  getMemberRoles(userId: string): Set<string> {
    return this.members.get(userId)?.roles ?? new Set();
  }

  getSentMessages(channelId: string): FakeChannelRecord["sentMessages"] {
    return this.channels.get(channelId)?.sentMessages ?? [];
  }
}
