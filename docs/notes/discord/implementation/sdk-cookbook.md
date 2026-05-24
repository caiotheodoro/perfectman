# Discord.js SDK Cookbook

Objective: list the exact Discord.js calls needed for Perfectman's Discord gateway.

Version target: Discord.js v14.26.2.

## Imports

```ts
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type Role,
  type TextChannel,
} from "discord.js";
```

## Install Package

```bash
pnpm add discord.js --filter @perfectman/server
```

## Create A Write-Only Client

```ts
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});
```

Use for MVP projection-only gateway.

## Wait For Ready

```ts
const ready = new Promise<Client<true>>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("discord_client_ready_timeout")), 30_000);

  client.once(Events.ClientReady, readyClient => {
    clearTimeout(timeout);
    resolve(readyClient);
  });
});

await client.login(token);
const readyClient = await ready;
```

Do not log `token`.

## Handle Client Errors

```ts
client.on(Events.Error, error => {
  logger.warn({ reason: "discord_client_error", error });
});
```

Do not throw from an async event handler.

## Destroy Client

```ts
await client.destroy();
```

Use during server shutdown. Do not destroy shared clients when a single simulation stops unless the process only runs one simulation.

## Fetch Guild

```ts
const guild = await client.guilds.fetch(guildId);

if (!guild.available) {
  throw new Error("discord_guild_unavailable");
}
```

Use configured snowflake ID. Do not guess by guild name.

## Fetch Text Channel

```ts
const channel = await guild.channels.fetch(discordChannelId);

if (!channel || channel.type !== ChannelType.GuildText) {
  throw new Error("discord_channel_missing_or_wrong_type");
}

const textChannel = channel as TextChannel;
```

Prefer a local type guard in implementation.

```ts
function assertGuildTextChannel(channel: unknown): asserts channel is TextChannel {
  if (!channel || (channel as { type?: unknown }).type !== ChannelType.GuildText) {
    throw new Error("discord_channel_missing_or_wrong_type");
  }
}
```

## Create Public Text Channel

```ts
const channel = await guild.channels.create({
  name: "pm-sim1-general",
  type: ChannelType.GuildText,
  reason: "Perfectman simulation sim1 public channel",
});
```

Persist `channel.id` in `ChannelMap`.

## Create Private Text Channel With Overwrites

```ts
const channel = await guild.channels.create({
  name: "pm-sim1-priv-ch42",
  type: ChannelType.GuildText,
  permissionOverwrites: [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: privateRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: managerBotUserId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ],
  reason: "Perfectman private channel ch42",
});
```

Create with overwrites to avoid a public visibility window.

## Edit Channel Overwrites

```ts
await channel.permissionOverwrites.edit(privateRole.id, {
  ViewChannel: true,
  SendMessages: true,
  ReadMessageHistory: true,
});
```

Use for targeted updates.

## Replace Channel Overwrites

```ts
await channel.permissionOverwrites.set(
  [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: privateRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ],
  "Perfectman private channel ACL sync",
);
```

Use during reconciliation to remove stale grants.

## Delete Overwrite

```ts
await channel.permissionOverwrites.delete(roleOrUserId, "Perfectman ACL cleanup");
```

Use carefully. Prefer full `set()` when syncing desired state.

## Create Role

```ts
const role = await guild.roles.create({
  name: "pm-sim1-role-ch42",
  mentionable: false,
  reason: "Perfectman private channel ch42 membership",
});
```

Persist `role.id`.

## Fetch Role

```ts
const role = await guild.roles.fetch(discordRoleId);

if (!role) {
  throw new Error("discord_role_missing");
}
```

## Delete Role

```ts
await guild.roles.delete(role.id, "Perfectman private channel cleanup");
```

Do not delete roles during normal stop unless cleanup is explicitly desired. Locking channels is safer for auditability.

## Fetch Member

```ts
const member = await guild.members.fetch(personaBotUserId);
```

For a controlled guild with known bot IDs, this can be enough without broad member-list ingestion.

## Add Role To Member

```ts
await member.roles.add(privateRole.id, "Perfectman private channel membership");
```

## Remove Role From Member

```ts
await member.roles.remove(privateRole.id, "Perfectman private channel membership revoked");
```

## Set Member Roles

```ts
await member.roles.set(roleIds, "Perfectman role reconciliation");
```

Avoid this unless you are intentionally replacing all roles. It can remove unrelated roles if used incorrectly.

## Check Effective Permissions

```ts
const permissions = channel.permissionsFor(member);

const canSend =
  permissions?.has(PermissionFlagsBits.ViewChannel) &&
  permissions.has(PermissionFlagsBits.SendMessages);
```

Use before queueing or executing sends.

## Check Bot Manager Permissions In Channel

```ts
const managerMember = await guild.members.fetch(managerBotUserId);
const permissions = channel.permissionsFor(managerMember);

const canManage =
  permissions?.has(PermissionFlagsBits.ViewChannel) &&
  permissions.has(PermissionFlagsBits.ManageChannels);
```

For role assignment, also check role hierarchy manually through guild role positions.

## Send Message

```ts
const message = await channel.send({
  content: "Oi.",
  allowedMentions: { parse: [] },
});
```

Persist `message.id` only if later reactions/edits need to target it.

## Send Typing Indicator

```ts
await channel.sendTyping();
```

Use only when a message is already scheduled. Do not use typing as a behavioral engine.

## Send Reaction To A Known Message

```ts
const message = await channel.messages.fetch(discordMessageId);
await message.react("👍");
```

This requires message ID mapping from committed event ID to Discord message ID. If there is no map, project reactions as text or defer reaction support.

## Fetch Recent Messages

```ts
const messages = await channel.messages.fetch({ limit: 10 });
```

Avoid using this for simulation context unless Discord ingestion is explicitly in scope. Reading Discord history is not needed for write-only MVP.

## Lock Channel For Persona Role

```ts
await channel.permissionOverwrites.edit(personaRoleOrPrivateRoleId, {
  SendMessages: false,
}, {
  reason: "Perfectman simulation stopped",
});
```

Preserve `ViewChannel` if post-simulation audit is desired.

## Generate Invite Link For Bot

For local setup scripts:

```ts
const invite = client.generateInvite({
  scopes: ["bot"],
  permissions: [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
  ],
});
```

Use least privilege. Persona bots should not need `ManageChannels` or `ManageRoles` if a manager bot exists.

## Common Task Matrix

| Task | SDK Call |
| --- | --- |
| Login bot | `client.login(token)` |
| Wait ready | `client.once(Events.ClientReady, cb)` |
| Disconnect | `client.destroy()` |
| Fetch guild | `client.guilds.fetch(guildId)` |
| Create channel | `guild.channels.create(options)` |
| Fetch channel | `guild.channels.fetch(channelId)` |
| Create role | `guild.roles.create(options)` |
| Fetch role | `guild.roles.fetch(roleId)` |
| Assign role | `member.roles.add(roleId, reason)` |
| Remove role | `member.roles.remove(roleId, reason)` |
| Replace overwrites | `channel.permissionOverwrites.set(overwrites, reason)` |
| Edit overwrite | `channel.permissionOverwrites.edit(id, options, opts)` |
| Check permissions | `channel.permissionsFor(memberOrRole)` |
| Send message | `channel.send({ content, allowedMentions })` |
| Send typing | `channel.sendTyping()` |
| Fetch message | `channel.messages.fetch(messageId)` |
| React | `message.react(emoji)` |

## Error Handling Pattern

```ts
try {
  await channel.send({ content, allowedMentions: { parse: [] } });
} catch (error) {
  const classified = classifyDiscordError(error);

  if (classified.kind === "rate_limited") {
    queue.pauseUntil(classified.retryAt);
    return;
  }

  if (classified.kind === "missing_permission") {
    await operatorWarnings.emit({
      reason: "discord_missing_permission",
      discordChannelId: channel.id,
      agentId,
    });
    return;
  }

  throw error;
}
```

Classification should live in one file. Do not scatter string matching across modules.
