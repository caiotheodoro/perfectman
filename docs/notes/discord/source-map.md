# Discord Source Map

Objective: preserve traceability from online Discord/Discord.js docs to local Perfectman implementation notes.

## Primary Sources

| Topic | Source | Local Use |
| --- | --- | --- |
| Context7 CLI lookup workflow | https://context7.com/docs/clients/cli#query-library-documentation | Use `ctx7 library` then `ctx7 docs` for targeted fresh lookups. Approved network run resolved current Discord.js package docs. |
| Context7 Discord.js package ID | `/websites/discord_js_packages_discord_js_14_26_2` | Freshest indexed package docs found on 2026-05-23; last update 2026-05-16; trust score 8.1. |
| Context7 Discord.js guide ID | `/discordjs/guide` | Fresh indexed guide docs found on 2026-05-23; trust score 9.3. |
| Discord.js `Client` | https://discord.js.org/docs/packages/discord.js/14.26.2/Client%3AClass | Client lifecycle, managers, `login`, `destroy`, `isReady`, ready/error events. |
| Discord.js `Guild` | https://discord.js.org/docs/packages/discord.js/14.26.2/Guild%3AClass | Guild managers for channels, roles, members; availability concerns. |
| Discord.js `GuildChannelManager` | https://discord.js.org/docs/packages/discord.js/14.26.2/GuildChannelManager%3AClass | Creating, fetching, editing, deleting guild channels. |
| Discord.js `TextChannel` | https://discord.js.org/docs/packages/discord.js/14.26.2/TextChannel%3AClass | Sendable text channel methods, permission checks, typing, channel metadata. |
| Discord.js `RoleManager` | https://discord.js.org/docs/packages/discord.js/14.26.2/RoleManager%3AClass | Role creation, fetching, deletion, role position concerns. |
| Discord.js `GuildMemberRoleManager` | https://discord.js.org/docs/packages/discord.js/14.26.2/GuildMemberRoleManager%3AClass | Assigning and removing roles from bot/persona members. |
| Discord.js `PermissionOverwriteManager` | https://discord.js.org/docs/packages/discord.js/14.26.2/PermissionOverwriteManager%3AClass | Channel-level role/member overwrites. |
| Discord.js permission flags | https://discord.js.org/docs/packages/discord.js/14.26.2/PermissionFlagsBits%3AVariable | Permission flag names used by channel/role operations. If this page path changes, query Context7 package docs for `PermissionFlagsBits` or use `PermissionsBitField.Flags` from the guide. |
| Discord Gateway docs | https://docs.discord.com/developers/events/gateway | Gateway lifecycle, intents, privileged intent rules, gateway send limits. |
| Discord rate limits | https://docs.discord.com/developers/topics/rate-limits | REST route/global limits, response shape, invalid request limits. |
| Discord permissions | https://docs.discord.com/developers/topics/permissions | Permission model, bot permissions, overwrites. |
| Discord getting started | https://docs.discord.com/developers/quick-start/getting-started | Bot token, installation, scopes, and bot permissions. |
| Discord.js guide: intents | https://discordjs.guide/popular-topics/intents.html | Practical mapping from v14 `GatewayIntentBits` to events and privileged data. |
| Discord.js guide: permissions | https://discordjs.guide/popular-topics/permissions | Practical v14 permission and overwrite patterns. |

## Local Sources Checked

| Local Source | Code Verification Status | Evidence |
| --- | --- | --- |
| [../../plans/discord-gateway.md](../../plans/discord-gateway.md) | verified as planning source | Defines `DiscordGateway`, `BotRegistry`, `ChannelMap`, `RoleManager`, rate limiter, milestones DG-M1..DG-M5. |
| [../../architecture/application.md](../../architecture/application.md) | verified as architecture source | Delivery gateway is an adapter boundary; runtime owns event commits, projection, scheduling, visibility. |
| [../../architecture/social-presence.md](../../architecture/social-presence.md) | verified as architecture source | Public/private channels, visibility masks, private-channel drama, permissions as simulation primitives. |
| [../../../packages/shared/src/channel/channel.types.ts](../../../packages/shared/src/channel/channel.types.ts) | verified | `ChannelType` includes `public_channel`, `private_channel`, `spectator_channel`, `operator_channel`; `Channel` owns `memberAgentIds` and visibility booleans. |
| [../../../packages/shared/src/event/event.types.ts](../../../packages/shared/src/event/event.types.ts) | verified | `CommittedEvent` has `channelId`, `actorId`, `emotionalSalience`, and `visibility`; event types include messages, reactions, channel lifecycle, operator/spectator events. |
| [../../../packages/server/src/persistence/repositories.ts](../../../packages/server/src/persistence/repositories.ts) | verified | Persistence contracts are platform-agnostic repositories for events, simulations, channels, memberships, memories, and agent state. |

## Freshness Notes

- Discord.js web pages were initially read at v14.22.0, then Context7 resolved fresher v14.26.2 package docs on 2026-05-23.
- Before implementation, query Context7 for the exact installed package version if `package.json` pins a different Discord.js release.
- Discord's official rate limit docs explicitly warn not to hard-code route limits because they can change.
- Privileged intent policy can change; recheck before requesting `GuildMembers`, `GuildPresences`, or `MessageContent`.

## Research Gaps

- Context7 CLI required approved network access. The approved run returned the package and guide IDs listed above.
- These notes do not enumerate every Discord.js class. They cover the subset needed for Perfectman's gateway and plausible future Discord-native surface.
