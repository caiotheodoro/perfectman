# Discord Gateway Implementation Skeleton

Objective: provide code-shaped TypeScript skeletons for the planned Discord gateway modules.

These are not final code. They define module boundaries and show where Discord.js calls belong.

## Package Dependency

`packages/server/package.json` should get:

```json
{
  "dependencies": {
    "discord.js": "^14.26.2"
  }
}
```

Use the latest compatible v14 version at implementation time.

## `discord-config.ts`

```ts
export type DiscordPersonaBotConfig = {
  agentId: string;
  token: string;
};

export type DiscordGatewayConfig = {
  guildId: string;
  managerBotToken?: string;
  personaBots: DiscordPersonaBotConfig[];
  setupMode: "readonly_existing" | "manage_channels";
};

export function parseDiscordGatewayConfig(env: NodeJS.ProcessEnv): DiscordGatewayConfig {
  const guildId = env.DISCORD_GUILD_ID;
  if (!guildId) throw new Error("discord_config_missing_guild_id");

  const personaBots = parsePersonaBots(env);
  if (personaBots.length === 0) throw new Error("discord_config_missing_persona_bots");

  return {
    guildId,
    managerBotToken: env.DISCORD_MANAGER_TOKEN,
    personaBots,
    setupMode: env.DISCORD_MANAGER_TOKEN ? "manage_channels" : "readonly_existing",
  };
}

function parsePersonaBots(env: NodeJS.ProcessEnv): DiscordPersonaBotConfig[] {
  const raw = env.DISCORD_AGENT_BOTS;
  if (!raw) return [];

  return raw.split(",").map(entry => {
    const [agentId, tokenEnvName] = entry.split(":");
    if (!agentId || !tokenEnvName) throw new Error("discord_config_invalid_agent_bot_entry");

    const token = env[tokenEnvName];
    if (!token) throw new Error(`discord_config_missing_token_env:${tokenEnvName}`);

    return { agentId, token };
  });
}
```

## `discord-errors.ts`

```ts
export type DiscordErrorKind =
  | "rate_limited"
  | "missing_permission"
  | "invalid_auth"
  | "not_found"
  | "transient"
  | "validation"
  | "unknown";

export type ClassifiedDiscordError = {
  kind: DiscordErrorKind;
  retryAt?: number;
  status?: number;
  code?: string | number;
};

export function classifyDiscordError(error: unknown): ClassifiedDiscordError {
  const maybe = error as { status?: number; code?: string | number; retry_after?: number };

  if (maybe.status === 429) {
    const retryAfterMs = typeof maybe.retry_after === "number" ? maybe.retry_after * 1000 : 1000;
    return { kind: "rate_limited", retryAt: Date.now() + retryAfterMs, status: maybe.status, code: maybe.code };
  }

  if (maybe.status === 401) return { kind: "invalid_auth", status: maybe.status, code: maybe.code };
  if (maybe.status === 403) return { kind: "missing_permission", status: maybe.status, code: maybe.code };
  if (maybe.status === 404) return { kind: "not_found", status: maybe.status, code: maybe.code };
  if (typeof maybe.status === "number" && maybe.status >= 500) {
    return { kind: "transient", status: maybe.status, code: maybe.code };
  }

  return { kind: "unknown" };
}
```

Refine this against real Discord.js error shapes during implementation.

## `bot-registry.ts`

```ts
import { Client, Events, GatewayIntentBits, type Guild } from "discord.js";

export type PersonaBotHandle = {
  agentId: string;
  userId: string;
  client: Client<true>;
  guild: Guild;
};

export class BotRegistry {
  private readonly bots = new Map<string, PersonaBotHandle>();

  constructor(private readonly guildId: string) {}

  async startPersonaBot(agentId: string, token: string): Promise<void> {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    client.on(Events.Error, error => {
      // route to operator warning/logging port
    });

    const ready = new Promise<Client<true>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("discord_client_ready_timeout")), 30_000);
      client.once(Events.ClientReady, readyClient => {
        clearTimeout(timeout);
        resolve(readyClient);
      });
    });

    await client.login(token);
    const readyClient = await ready;
    const guild = await readyClient.guilds.fetch(this.guildId);

    if (!guild.available) throw new Error("discord_guild_unavailable");

    this.bots.set(agentId, {
      agentId,
      userId: readyClient.user.id,
      client: readyClient,
      guild,
    });
  }

  get(agentId: string): PersonaBotHandle {
    const bot = this.bots.get(agentId);
    if (!bot) throw new Error(`discord_bot_missing:${agentId}`);
    return bot;
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.bots.values()].map(bot => bot.client.destroy()));
    this.bots.clear();
  }
}
```

## `discord-guild-port.ts`

```ts
export type PermissionName =
  | "ViewChannel"
  | "SendMessages"
  | "ReadMessageHistory"
  | "ManageChannels"
  | "ManageRoles"
  | "AddReactions";

export type PermissionOverwriteInput = {
  id: string;
  allow?: PermissionName[];
  deny?: PermissionName[];
};

export type CreateTextChannelInput = {
  name: string;
  reason: string;
  permissionOverwrites?: PermissionOverwriteInput[];
};

export type DiscordTextChannelPort = {
  id: string;
  send(input: { content: string; allowedMentions: { parse: [] } }): Promise<{ id: string }>;
  sendTyping(): Promise<void>;
  setPermissionOverwrites(overwrites: PermissionOverwriteInput[], reason: string): Promise<void>;
  editPermissionOverwrite(id: string, permissions: Partial<Record<PermissionName, boolean>>, reason: string): Promise<void>;
  permissionsForMember(userId: string): Promise<Set<PermissionName>>;
  permissionsForRole(roleId: string): Promise<Set<PermissionName>>;
};

export type DiscordRolePort = {
  id: string;
  name: string;
};

export type DiscordMemberPort = {
  userId: string;
  addRole(roleId: string, reason: string): Promise<void>;
  removeRole(roleId: string, reason: string): Promise<void>;
};

export type DiscordGuildPort = {
  everyoneRoleId(): string;
  fetchTextChannel(id: string): Promise<DiscordTextChannelPort | null>;
  createTextChannel(input: CreateTextChannelInput): Promise<DiscordTextChannelPort>;
  fetchRole(id: string): Promise<DiscordRolePort | null>;
  createRole(input: { name: string; reason: string; mentionable: boolean }): Promise<DiscordRolePort>;
  fetchMember(userId: string): Promise<DiscordMemberPort | null>;
};
```

## `discord-guild-adapter.ts`

```ts
import { ChannelType, PermissionFlagsBits, type Guild, type TextChannel } from "discord.js";

const permissionFlagByName = {
  ViewChannel: PermissionFlagsBits.ViewChannel,
  SendMessages: PermissionFlagsBits.SendMessages,
  ReadMessageHistory: PermissionFlagsBits.ReadMessageHistory,
  ManageChannels: PermissionFlagsBits.ManageChannels,
  ManageRoles: PermissionFlagsBits.ManageRoles,
  AddReactions: PermissionFlagsBits.AddReactions,
} as const;

export class DiscordJsGuildAdapter implements DiscordGuildPort {
  constructor(private readonly guild: Guild) {}

  everyoneRoleId(): string {
    return this.guild.roles.everyone.id;
  }

  async fetchTextChannel(id: string): Promise<DiscordTextChannelPort | null> {
    const channel = await this.guild.channels.fetch(id);
    if (!channel) return null;
    if (channel.type !== ChannelType.GuildText) throw new Error("discord_channel_wrong_type");
    return wrapTextChannel(channel);
  }

  async createTextChannel(input: CreateTextChannelInput): Promise<DiscordTextChannelPort> {
    const channel = await this.guild.channels.create({
      name: input.name,
      type: ChannelType.GuildText,
      reason: input.reason,
      permissionOverwrites: input.permissionOverwrites?.map(toDiscordOverwrite),
    });

    return wrapTextChannel(channel);
  }

  async fetchRole(id: string): Promise<DiscordRolePort | null> {
    const role = await this.guild.roles.fetch(id);
    return role ? { id: role.id, name: role.name } : null;
  }

  async createRole(input: { name: string; reason: string; mentionable: boolean }): Promise<DiscordRolePort> {
    const role = await this.guild.roles.create(input);
    return { id: role.id, name: role.name };
  }

  async fetchMember(userId: string): Promise<DiscordMemberPort | null> {
    const member = await this.guild.members.fetch(userId).catch(() => null);
    if (!member) return null;

    return {
      userId,
      addRole: (roleId, reason) => member.roles.add(roleId, reason).then(() => undefined),
      removeRole: (roleId, reason) => member.roles.remove(roleId, reason).then(() => undefined),
    };
  }
}

function toDiscordOverwrite(input: PermissionOverwriteInput) {
  return {
    id: input.id,
    allow: input.allow?.map(permission => permissionFlagByName[permission]),
    deny: input.deny?.map(permission => permissionFlagByName[permission]),
  };
}

function wrapTextChannel(channel: TextChannel): DiscordTextChannelPort {
  return {
    id: channel.id,
    send: input => channel.send(input).then(message => ({ id: message.id })),
    sendTyping: () => channel.sendTyping(),
    setPermissionOverwrites: (overwrites, reason) =>
      channel.permissionOverwrites.set(overwrites.map(toDiscordOverwrite), reason).then(() => undefined),
    editPermissionOverwrite: (id, permissions, reason) =>
      channel.permissionOverwrites.edit(id, permissions, { reason }).then(() => undefined),
    permissionsForMember: async userId => {
      const permissions = channel.permissionsFor(userId);
      return fromDiscordPermissions(permissions);
    },
    permissionsForRole: async roleId => {
      const permissions = channel.permissionsFor(roleId);
      return fromDiscordPermissions(permissions);
    },
  };
}

function fromDiscordPermissions(permissions: ReturnType<TextChannel["permissionsFor"]>): Set<PermissionName> {
  const result = new Set<PermissionName>();
  if (!permissions) return result;

  for (const [name, flag] of Object.entries(permissionFlagByName) as [PermissionName, bigint][]) {
    if (permissions.has(flag)) result.add(name);
  }

  return result;
}
```

## `channel-map.ts`

```ts
import type { ChannelType } from "@perfectman/shared";

export type DiscordChannelMapEntry = {
  simulationId: string;
  channelId: string;
  channelType: ChannelType;
  discordGuildId: string;
  discordChannelId: string;
  discordRoleId?: string;
  lastSyncedAt: number;
};

export class InMemoryDiscordChannelMap {
  private readonly bySimulationChannel = new Map<string, DiscordChannelMapEntry>();

  get(simulationId: string, channelId: string): DiscordChannelMapEntry | null {
    return this.bySimulationChannel.get(`${simulationId}:${channelId}`) ?? null;
  }

  upsert(entry: DiscordChannelMapEntry): void {
    this.bySimulationChannel.set(`${entry.simulationId}:${entry.channelId}`, entry);
  }
}
```

## `role-manager.ts`

```ts
export class DiscordRoleManager {
  constructor(
    private readonly guild: DiscordGuildPort,
    private readonly channelMap: InMemoryDiscordChannelMap,
    private readonly botUserIdByAgentId: Map<string, string>,
    private readonly discordGuildId: string,
  ) {}

  async createPrivateChannel(input: {
    simulationId: string;
    channelId: string;
    channelName: string;
    memberAgentIds: string[];
    managerBotUserId: string;
  }): Promise<void> {
    const role = await this.ensurePrivateRole(input.simulationId, input.channelId);
    const channel = await this.ensurePrivateTextChannel(input, role.id);

    await this.reconcileMembers(role.id, input.memberAgentIds);

    this.channelMap.upsert({
      simulationId: input.simulationId,
      channelId: input.channelId,
      channelType: "private_channel",
      discordGuildId: this.discordGuildId,
      discordChannelId: channel.id,
      discordRoleId: role.id,
      lastSyncedAt: Date.now(),
    });
  }

  async addMember(roleId: string, agentId: string): Promise<void> {
    const userId = this.botUserIdByAgentId.get(agentId);
    if (!userId) throw new Error(`discord_bot_user_missing:${agentId}`);

    const member = await this.guild.fetchMember(userId);
    if (!member) throw new Error(`discord_member_missing:${agentId}`);

    await member.addRole(roleId, "Perfectman private channel membership");
  }

  async removeMember(roleId: string, agentId: string): Promise<void> {
    const userId = this.botUserIdByAgentId.get(agentId);
    if (!userId) throw new Error(`discord_bot_user_missing:${agentId}`);

    const member = await this.guild.fetchMember(userId);
    if (!member) return;

    await member.removeRole(roleId, "Perfectman private channel membership revoked");
  }

  private async ensurePrivateRole(simulationId: string, channelId: string): Promise<DiscordRolePort> {
    const mapped = this.channelMap.get(simulationId, channelId);
    if (mapped?.discordRoleId) {
      const existing = await this.guild.fetchRole(mapped.discordRoleId);
      if (existing) return existing;
    }

    return this.guild.createRole({
      name: `pm-${simulationId}-role-${channelId}`,
      mentionable: false,
      reason: `Perfectman private channel ${channelId}`,
    });
  }

  private async ensurePrivateTextChannel(
    input: { simulationId: string; channelId: string; channelName: string; managerBotUserId: string },
    roleId: string,
  ): Promise<DiscordTextChannelPort> {
    const mapped = this.channelMap.get(input.simulationId, input.channelId);
    if (mapped?.discordChannelId) {
      const existing = await this.guild.fetchTextChannel(mapped.discordChannelId);
      if (existing) return existing;
    }

    return this.guild.createTextChannel({
      name: `pm-${input.simulationId}-priv-${input.channelName}`,
      reason: `Perfectman private channel ${input.channelId}`,
      permissionOverwrites: [
        { id: this.guild.everyoneRoleId(), deny: ["ViewChannel"] },
        { id: roleId, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        { id: input.managerBotUserId, allow: ["ViewChannel", "SendMessages", "ManageChannels"] },
      ],
    });
  }

  private async reconcileMembers(roleId: string, memberAgentIds: string[]): Promise<void> {
    for (const agentId of memberAgentIds) {
      await this.addMember(roleId, agentId);
    }
  }
}
```

## `discord-formatter.ts`

```ts
import type { CommittedEvent } from "@perfectman/shared";

export type DiscordFormattedMessage = {
  content: string;
  allowedMentions: { parse: [] };
};

export function formatCommittedEventForDiscord(event: CommittedEvent): DiscordFormattedMessage | null {
  switch (event.type) {
    case "message_sent":
    case "reply_sent":
      return safeContent(String(event.payload.content ?? ""));

    case "reaction_sent":
      return safeContent(String(event.payload.emoji ?? ""));

    case "private_motive_summary":
      return safeContent(`[recap] ${String(event.payload.summary ?? "")}`);

    case "operator_warning":
      return safeContent(`[discord warning] ${String(event.payload.reason ?? "operator_warning")}`);

    default:
      return null;
  }
}

function safeContent(content: string): DiscordFormattedMessage {
  return {
    content: content.slice(0, 1900),
    allowedMentions: { parse: [] },
  };
}
```

Replace the `payload` field names with actual event payload schemas when they become typed.

## `discord-rate-limiter.ts`

```ts
import type { EmotionalSalience } from "@perfectman/shared";

export type OutboundDiscordMessage = {
  id: string;
  agentId: string;
  discordChannelId: string;
  content: string;
  salience: EmotionalSalience;
  attempts: number;
  notBefore: number;
  createdAt: number;
};

export type DiscordSendPort = {
  send(discordChannelId: string, message: { content: string; allowedMentions: { parse: [] } }): Promise<{ id: string }>;
};

export class DiscordRateLimiter {
  private readonly queues = new Map<string, OutboundDiscordMessage[]>();

  enqueue(message: OutboundDiscordMessage): void {
    const key = `${message.agentId}:${message.discordChannelId}`;
    const queue = this.queues.get(key) ?? [];

    if (message.salience === "low" && queue.length > 50) return;

    queue.push(message);
    this.queues.set(key, queue);
  }

  async flushOne(key: string, sendPort: DiscordSendPort): Promise<void> {
    const queue = this.queues.get(key);
    if (!queue?.length) return;

    const next = queue[0];
    if (Date.now() < next.notBefore) return;

    try {
      await sendPort.send(next.discordChannelId, {
        content: next.content,
        allowedMentions: { parse: [] },
      });
      queue.shift();
    } catch (error) {
      const classified = classifyDiscordError(error);
      next.attempts += 1;

      if (classified.kind === "rate_limited" && classified.retryAt) {
        next.notBefore = classified.retryAt;
        return;
      }

      if (classified.kind === "missing_permission" || classified.kind === "invalid_auth") {
        queue.shift();
        // emit operator warning
        return;
      }

      next.notBefore = Date.now() + Math.min(30_000, 1000 * 2 ** next.attempts);
    }
  }
}
```

Use fake timers in tests. Do not use real Discord calls in CI.

## `discord-gateway.ts`

```ts
import type { ChannelType, CommittedEvent, EmotionalSalience } from "@perfectman/shared";

export type DeliveryMessage = {
  eventId: string;
  agentId: string;
  content: string;
  salience: EmotionalSalience;
};

export class DiscordGateway {
  constructor(
    private readonly botRegistry: BotRegistry,
    private readonly channelMap: InMemoryDiscordChannelMap,
    private readonly roleManager: DiscordRoleManager,
    private readonly rateLimiter: DiscordRateLimiter,
  ) {}

  async sendAgentMessage(simulationId: string, channelId: string, message: DeliveryMessage): Promise<void> {
    const bot = this.botRegistry.get(message.agentId);
    const mapped = this.channelMap.get(simulationId, channelId);
    if (!mapped) throw new Error(`discord_channel_mapping_missing:${channelId}`);

    this.rateLimiter.enqueue({
      id: message.eventId,
      agentId: message.agentId,
      discordChannelId: mapped.discordChannelId,
      content: message.content,
      salience: message.salience,
      attempts: 0,
      notBefore: Date.now(),
      createdAt: Date.now(),
    });
  }

  async createChannel(input: {
    simulationId: string;
    channelId: string;
    channelName: string;
    type: ChannelType;
    memberAgentIds: string[];
    managerBotUserId: string;
  }): Promise<void> {
    if (input.type === "private_channel") {
      await this.roleManager.createPrivateChannel(input);
    }
  }

  async projectCommittedEvent(event: CommittedEvent): Promise<void> {
    const formatted = formatCommittedEventForDiscord(event);
    if (!formatted) return;

    // choose bot/channel by event actor/channel mapping
  }
}
```

## Test Shape

Keep tests fake:

```ts
class FakeDiscordGuildPort implements DiscordGuildPort {
  // in-memory channels, roles, members, overwrites
}
```

Required tests:

- private channel creates deny `ViewChannel` for everyone,
- private role assignment adds only intended members,
- `allowedMentions` is always disabled,
- rate limiter preserves high/critical messages,
- missing permission emits operator warning,
- gateway never writes to event repositories.
