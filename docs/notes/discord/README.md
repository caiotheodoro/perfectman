# Discord.js Local Reference

Objective: make Discord.js usable from local project notes without treating Discord as a thin or limiting gateway.

Scope: Discord.js v14.26.2, the Discord.js guide, and the Discord Developer documentation, interpreted for Perfectman's delivery-agnostic social simulation architecture.

Assumption: the first implementation remains a Discord surface adapter for projected simulation output, but these notes also cover the richer Discord primitives needed if Discord becomes the primary live surface later.

## Read Order

1. [source-map.md](source-map.md) - source list, verification status, and local architecture links.
2. [project-fit.md](project-fit.md) - how Discord maps onto Perfectman's channel runtime.
3. [client-and-intents.md](client-and-intents.md) - clients, lifecycle, gateway events, intents, token handling.
4. [guild-channels-roles-permissions.md](guild-channels-roles-permissions.md) - guild objects, text channels, roles, permission overwrites, private channel modeling.
5. [messaging-rate-limits-errors.md](messaging-rate-limits-errors.md) - sending, typing, REST limits, gateway limits, invalid request limits, retry policy.
6. [implementation-checklist.md](implementation-checklist.md) - concrete implementation decisions, tests, and residual risks for `packages/server/src/discord/`.

## Implementation Notes

Use these when writing code:

- [implementation/README.md](implementation/README.md) - practical implementation index.
- [implementation/sdk-cookbook.md](implementation/sdk-cookbook.md) - exact Discord.js calls by task.
- [implementation/client-config-recipes.md](implementation/client-config-recipes.md) - client options and intents by mode.
- [implementation/api-endpoint-map.md](implementation/api-endpoint-map.md) - Discord.js function to Discord REST/Gateway concept mapping.
- [implementation/implementation-skeleton.md](implementation/implementation-skeleton.md) - code-shaped module skeletons for `packages/server/src/discord/`.

## Local Architecture Summary

Perfectman's canonical runtime is:

```text
event -> visibility -> attention -> interpretation -> motivation -> emotion -> pressure -> inhibition -> intent -> resolver -> memory + spectator story
```

Discord must not own that loop. Discord is an external surface for channels, bot identities, messages, roles, and permissions. The simulation event stream remains canonical.

The existing plan in [../../plans/discord-gateway.md](../../plans/discord-gateway.md) describes:

- one Discord bot token per persona,
- guild channels that mirror simulation channels,
- roles and permission overwrites for private channels,
- a per-bot/per-channel rate limiter,
- no incoming Discord command or message listeners for the first gateway implementation.

This note pack expands that plan with Discord.js-specific API behavior and guardrails.

## Key Conclusions

- Use Discord.js v14 imports from `discord.js`: `Client`, `GatewayIntentBits`, `ChannelType`, `PermissionFlagsBits`, `Events`, and Discord-specific error classes when needed.
- Start with the smallest Gateway intents possible. For a write-heavy surface, `GatewayIntentBits.Guilds` is the core requirement. Add `GuildMessages`, `GuildMessageReactions`, `GuildMembers`, or `MessageContent` only if the implementation actually listens to those event families or needs their data.
- Do not hard-code Discord rate limit numbers except as local scheduling safety margins. Discord's official guidance is to obey response headers and `retry_after`.
- Model private simulation channels as guild text channels plus role/channel overwrites, not Discord DMs and not threads.
- Check permissions before writing or mutating roles/channels. Discord counts many 401, 403, and 429 responses toward an invalid request threshold.
- Build an interface wrapper around Discord.js clients/managers so unit tests never require live API calls.

## Not An Imported Copy

These files intentionally paraphrase and organize the docs instead of copying them verbatim. They are a local engineering reference for this codebase, with links back to the source pages for freshness checks.
