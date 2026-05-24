# Discord.js API And Endpoint Map

Objective: map Discord.js calls to the underlying Discord API concepts so implementers know what is being consumed.

This is not a raw REST implementation guide. Prefer Discord.js SDK calls in application code.

## Client And Gateway

| Perfectman Task | Discord.js Call | Discord API Concept |
| --- | --- | --- |
| Start bot client | `client.login(token)` | Gateway connection identify plus REST auth setup. |
| Ready signal | `Events.ClientReady` | Gateway ready dispatch after successful session start. |
| Disconnect bot | `client.destroy()` | Close gateway connection and cleanup client state. |
| Receive Discord message | `Events.MessageCreate` | Gateway `MESSAGE_CREATE`; out of MVP scope. |
| Receive interaction | `Events.InteractionCreate` | Gateway interaction dispatch; out of MVP scope. |

## Guilds

| Perfectman Task | Discord.js Call | Discord API Concept |
| --- | --- | --- |
| Resolve configured guild | `client.guilds.fetch(guildId)` | Fetch guild / guild cache lookup. |
| Inspect guild channels | `guild.channels.fetch()` | List/fetch guild channels. |
| Inspect guild roles | `guild.roles.fetch()` | List/fetch guild roles. |
| Inspect known member | `guild.members.fetch(userId)` | Fetch guild member. |

## Channels

| Perfectman Task | Discord.js Call | Discord API Concept |
| --- | --- | --- |
| Create text channel | `guild.channels.create({ name, type: ChannelType.GuildText })` | Create guild channel. |
| Create private text channel | `guild.channels.create({ permissionOverwrites })` | Create guild channel with channel overwrite payload. |
| Fetch channel by ID | `guild.channels.fetch(channelId)` | Get channel. |
| Edit channel | `guild.channels.edit(channelId, options)` or `channel.edit(options)` | Modify channel. |
| Delete channel | `guild.channels.delete(channelId, reason)` or `channel.delete(reason)` | Delete channel. |
| Move channel position | `guild.channels.setPosition(channelId, position)` | Modify guild channel positions. |

Perfectman should rarely delete channels automatically. Archive/lock is safer than deletion for a social simulation audit trail.

## Permission Overwrites

| Perfectman Task | Discord.js Call | Discord API Concept |
| --- | --- | --- |
| Add/replace one overwrite | `channel.permissionOverwrites.create(roleOrUser, options)` | Edit channel permissions for overwrite target. |
| Edit one overwrite | `channel.permissionOverwrites.edit(roleOrUser, options)` | Edit channel permissions. |
| Delete one overwrite | `channel.permissionOverwrites.delete(roleOrUser)` | Delete channel permission overwrite. |
| Replace all overwrites | `channel.permissionOverwrites.set(overwrites)` | Modify channel overwrites to desired set. |
| Compute effective permission | `channel.permissionsFor(memberOrRole)` | SDK-side permission resolution from roles plus overwrites. |

Use `set()` for reconciliation because it can remove stale grants.

## Roles

| Perfectman Task | Discord.js Call | Discord API Concept |
| --- | --- | --- |
| Create private-channel role | `guild.roles.create(options)` | Create guild role. |
| Fetch role | `guild.roles.fetch(roleId)` | Get/list guild role. |
| Edit role | `guild.roles.edit(roleId, options)` | Modify guild role. |
| Delete role | `guild.roles.delete(roleId, reason)` | Delete guild role. |
| Move role position | `guild.roles.setPosition(roleId, position)` | Modify guild role positions. |

Role hierarchy is enforced by Discord. The manager bot must have a high enough role to manage created roles.

## Member Roles

| Perfectman Task | Discord.js Call | Discord API Concept |
| --- | --- | --- |
| Assign member to private channel | `member.roles.add(roleId, reason)` | Add guild member role. |
| Remove member from private channel | `member.roles.remove(roleId, reason)` | Remove guild member role. |
| Replace member role set | `member.roles.set(roleIds, reason)` | Modify guild member roles. |

Avoid `roles.set()` unless the gateway owns the whole role set. For Perfectman private channels, `add`/`remove` is safer.

## Messages

| Perfectman Task | Discord.js Call | Discord API Concept |
| --- | --- | --- |
| Send persona message | `channel.send({ content, allowedMentions })` | Create message. |
| Send typing indicator | `channel.sendTyping()` | Trigger typing indicator. |
| Fetch message for reaction | `channel.messages.fetch(messageId)` | Get channel message. |
| React to message | `message.react(emoji)` | Create reaction. |
| Fetch recent messages | `channel.messages.fetch({ limit })` | Get channel messages. |

For write-only MVP, only `send` and maybe `sendTyping` are required.

## Application Commands

Out of scope for current gateway.

| Future Task | SDK/REST Concept |
| --- | --- |
| Register slash command | REST application command create/update. |
| Receive command | `Events.InteractionCreate`. |
| Reply to command | interaction response API. |

Do not mix command registration into persona output gateway unless a control surface spec requires it.

## Rate Limits

Discord.js SDK calls above consume REST or Gateway budgets.

REST rate-limit concepts:

- route-specific bucket,
- global bot limit,
- `retry_after` in 429 responses,
- invalid request limit for repeated 401/403/429.

Gateway rate-limit concepts:

- identify concurrency,
- gateway events sent per connection,
- reconnect/resume behavior,
- session start limit.

Perfectman application queues should sit above Discord.js:

```text
CommittedEvent projection
  -> Discord formatter
  -> Perfectman DiscordRateLimiter
  -> Discord.js SDK call
  -> Discord REST/Gateway handling
```

## Function To Module Placement

| SDK Call | Module |
| --- | --- |
| `new Client`, `client.login`, `client.destroy` | `bot-registry.ts` |
| `client.guilds.fetch` | `bot-registry.ts` or `discord-guild-adapter.ts` |
| `guild.channels.create/fetch/edit/delete` | `discord-guild-adapter.ts`, used by `role-manager.ts` |
| `guild.roles.create/fetch/delete` | `discord-guild-adapter.ts`, used by `role-manager.ts` |
| `guild.members.fetch` | `discord-guild-adapter.ts`, used by `role-manager.ts` |
| `member.roles.add/remove` | `discord-guild-adapter.ts`, used by `role-manager.ts` |
| `channel.permissionOverwrites.*` | `discord-guild-adapter.ts`, used by `role-manager.ts` |
| `channel.permissionsFor` | `discord-guild-adapter.ts`, used by preflight checks |
| `channel.send` | bot/channel send port, used by `discord-rate-limiter.ts` |
| `channel.sendTyping` | optional send port, used by future typing projection |

## Endpoint Risk Notes

- Channel/role creation can partially succeed. Always reconcile after failure.
- Permission overwrites can create visibility leaks if applied after public channel creation. Prefer create-with-overwrites.
- Role assignment can fail because of hierarchy even when `ManageRoles` is present.
- Message sends can fail due to missing `SendMessages`, missing `ViewChannel`, slowmode, rate limits, or deleted channel.
- Message content ingestion requires privileged intent; avoid for MVP.
