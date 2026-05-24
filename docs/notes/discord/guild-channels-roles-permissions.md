# Guilds, Channels, Roles, And Permissions

Objective: document the Discord.js primitives needed to mirror Perfectman channels and memberships.

## Discord Guild

In Discord.js, `Guild` represents a Discord server. Important managers:

- `guild.channels` - `GuildChannelManager`
- `guild.roles` - `RoleManager`
- `guild.members` - `GuildMemberManager`

Always operate against a configured guild ID. Do not scan all guilds and guess.

## Channel Types

For Perfectman MVP, use `ChannelType.GuildText`.

Do not use:

- DMs: not guild-scoped, bad for spectator/operator visibility, hard to model shared private rooms.
- Threads: useful later, but current plan says private channels are real Discord channels, not threads.
- Forum/media channels: not needed for chat simulation.
- Voice/stage channels: not needed for V1.

## Creating Channels

Discord.js uses `guild.channels.create(options)`.

Minimal text channel:

```ts
const channel = await guild.channels.create({
  name: "pm-sim1-general",
  type: ChannelType.GuildText,
  reason: "Perfectman simulation sim1 public channel",
});
```

Private channel with overwrites at creation time:

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

Creating with the desired overwrites is better than creating publicly and patching later, because it avoids a visibility race.

## Fetching Channels

Use stable snowflake IDs from `ChannelMap`:

```ts
const channel = await guild.channels.fetch(discordChannelId);
if (!channel || channel.type !== ChannelType.GuildText) {
  throw new Error("discord_channel_missing_or_wrong_type");
}
```

Discord.js managers can return cached objects or fetch from Discord depending on method/options. For reconciliation, prefer fetches that confirm current remote state.

## Text Channel Sending

`TextChannel` is sendable and has:

- `send(options)`
- `sendTyping()`
- `permissionsFor(memberOrRole)`
- `permissionOverwrites`
- `rateLimitPerUser` for slowmode
- `viewable`, `manageable`, `deletable`

Before sending:

```ts
if (!channel.isTextBased() || !channel.isSendable()) {
  throw new Error("discord_channel_not_sendable");
}
```

For guild text channels fetched as generic `GuildBasedChannel`, narrow by type or methods before using `send`.

## Roles

Use one role per private simulation channel:

```ts
const role = await guild.roles.create({
  name: "pm-sim1-role-ch42",
  mentionable: false,
  reason: "Perfectman private channel ch42 membership",
});
```

Store the role snowflake in `ChannelMap`.

Role benefits:

- one channel overwrite grants access to all current/future members with the role,
- add/remove membership is a role assignment operation,
- easier to inspect and repair than many member-specific overwrites.

Role risks:

- the bot assigning roles needs `ManageRoles`,
- Discord role hierarchy matters; a bot cannot manage roles at or above its highest manageable role,
- accidental role grant exposes the private channel.

## Assigning Roles To Persona Bots

Fetch the persona bot's guild member and use `member.roles.add(roleId)`:

```ts
const member = await guild.members.fetch(personaBotUserId);
await member.roles.add(privateRole.id, "Perfectman private channel membership");
```

Remove:

```ts
await member.roles.remove(privateRole.id, "Perfectman private channel membership revoked");
```

Discord.js uses idempotent routes for singular add/remove operations. Still treat failures as API outcomes and reconcile later.

## Permission Flags Needed

Core flags:

- `ViewChannel` - can see the channel.
- `SendMessages` - can send normal messages.
- `ReadMessageHistory` - can read prior messages.
- `AddReactions` - can add emoji reactions.
- `ManageChannels` - can create/edit channels and overwrites.
- `ManageRoles` - can create/manage roles and assign manageable roles.

Optional:

- `AttachFiles` and `EmbedLinks` if spectator/operator outputs use rich media.
- `ManageMessages` only if the gateway deletes/moderates messages, which V1 should avoid.
- `UseApplicationCommands` only for slash commands, which current plan excludes.

Avoid:

- `Administrator` unless absolutely required for a controlled local experiment. It bypasses normal permission reasoning and masks bugs.
- `ManageGuild`, `KickMembers`, `BanMembers`, `MentionEveryone`, or moderation permissions for persona bots.

## Permission Overwrites

Discord channel permissions combine guild roles and channel-specific overwrites. In Discord.js, channel overwrites are managed through `channel.permissionOverwrites`.

Methods:

- `create(userOrRole, options)`
- `edit(userOrRole, options)`
- `delete(userOrRole)`
- `set(overwrites)`

For a private channel:

```ts
await channel.permissionOverwrites.set([
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
], "Perfectman private channel ACL sync");
```

Prefer setting the whole desired overwrite set during reconciliation to remove stale grants.

## Checking Effective Permissions

Use `channel.permissionsFor(memberOrRole)` to compute effective permissions after overwrites.

```ts
const permissions = channel.permissionsFor(member);
const canSend =
  permissions?.has(PermissionFlagsBits.ViewChannel) &&
  permissions.has(PermissionFlagsBits.SendMessages);
```

Use this before queueing sends. A 403 response is both a user-visible failure and a contributor to Discord's invalid request count.

## Private Channel Algorithm

`RoleManager.createPrivateChannel(channelId, memberAgentIds)`:

1. Read local `Channel` and ensure `type === "private_channel"`.
2. Ensure a private role exists for the simulation channel.
3. Ensure a guild text channel exists for the simulation channel.
4. Apply private overwrites at creation or reconciliation.
5. Fetch each member bot as a guild member.
6. Add the private role to each member bot.
7. Remove the private role from bots not in `memberAgentIds`.
8. Validate `permissionsFor` for each member and non-member sample.
9. Persist Discord channel and role IDs in `ChannelMap`.

## Public Channel Algorithm

Public channel:

- should be visible to all persona bots,
- should allow persona bots to send,
- may deny operator-only details,
- may be pre-created by an operator or managed by the gateway.

Recommended overwrites:

- avoid broad public server visibility if using a test guild with humans,
- grant a simulation role to all persona bots,
- optionally grant spectator humans view-only access.

## Spectator Channel Algorithm

Spectator channel:

- visible to humans/operators,
- not visible to persona bots unless product explicitly wants them to observe recap narration,
- receives `recap_generated`, `private_motive_summary`, and narrative summaries after projection.

If `omniscientSpectatorMode` is false, the projection layer must filter facts before the Discord gateway sees them.

## Operator Channel Algorithm

Operator channel:

- visible to operators only,
- hidden from persona bots,
- receives gateway setup warnings, blocked intents, rate limit issues, and simulation control logs.

Never leak raw tokens, full prompts, or secret config into operator messages.

## Locking Channels On Stop

`onSimulationStopped` should remove `SendMessages` while preserving `ViewChannel` where desired:

```ts
await channel.permissionOverwrites.edit(privateRole, {
  SendMessages: false,
}, { reason: "Perfectman simulation stopped" });
```

For public channels, lock the role used by persona bots. For spectator/operator channels, decide separately whether human/operator posting remains allowed.

## Channel Map Persistence

Needed fields:

```ts
type DiscordChannelMapEntry = {
  simulationId: string;
  channelId: string;
  channelType: ChannelType;
  discordGuildId: string;
  discordChannelId: string;
  discordRoleId?: string;
  lastSyncedAt: number;
};
```

Do not infer role IDs from names after initial creation except as a recovery path.

## Common Permission Failures

| Error Shape | Cause | Mitigation |
| --- | --- | --- |
| 403 Missing Permissions | bot lacks channel/role permission or role hierarchy is too low | preflight `permissionsFor`; check bot highest role; alert operator. |
| Channel visible to non-member | stale role assignment or overwrite allows `@everyone` | reconcile whole overwrite set; audit roles. |
| Bot cannot assign private role | manager bot's highest role is below/equal target role | place manager bot role above managed roles. |
| Persona cannot send | missing `SendMessages`, channel slowmode, channel locked | validate and route to operator feed. |
| Created channel then failed overwrite | partial setup | retry reconciliation; create private channels with overwrites when possible. |

## Testing Strategy

Unit tests should not import live Discord.js clients directly. Test against interfaces:

```ts
type DiscordGuildPort = {
  fetchTextChannel(id: string): Promise<DiscordTextChannelPort | null>;
  createTextChannel(input: CreateTextChannelInput): Promise<DiscordTextChannelPort>;
  createRole(input: CreateRoleInput): Promise<DiscordRolePort>;
  fetchMember(userId: string): Promise<DiscordMemberPort | null>;
};
```

Test cases:

- private channel create applies deny `ViewChannel` to `@everyone`,
- private channel create grants role `ViewChannel` and `SendMessages`,
- adding member assigns role,
- removing member removes role,
- lock channel removes send permission,
- reconciliation removes stale extra role assignments,
- missing permission becomes operator warning, not uncaught exception.

## Verification Notes

- Source: Discord.js `GuildChannelManager` docs for channel creation/fetch/edit/delete.
- Source: Discord.js `TextChannel` docs for sendability, `send`, `sendTyping`, `permissionsFor`, and permission overwrite manager.
- Source: Discord.js `RoleManager` and `GuildMemberRoleManager` docs for role creation and member role add/remove.
- Source: Discord.js `PermissionOverwriteManager` docs for create/edit/delete/set overwrite APIs.
- Code evidence: Perfectman `ChannelType` and `Channel.memberAgentIds` support this mapping.
