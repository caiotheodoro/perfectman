# Discord Implementation Notes

Objective: provide the practical "how do I code this" layer for the Discord.js gateway.

Read this folder after the higher-level notes in `docs/notes/discord/`.

## Files

- [sdk-cookbook.md](sdk-cookbook.md) - exact Discord.js calls by common task.
- [client-config-recipes.md](client-config-recipes.md) - client options, intents, and environment shape by gateway mode.
- [api-endpoint-map.md](api-endpoint-map.md) - SDK call to Discord REST/Gateway concept map.
- [implementation-skeleton.md](implementation-skeleton.md) - TypeScript skeletons for the modules planned under `packages/server/src/discord/`.

## Implementation Posture

Keep Discord behind ports. Do not let Discord.js types leak through the simulation runtime.

The runtime owns:

- events,
- channels,
- visibility,
- intent resolution,
- memory,
- spectator/operator projections.

The Discord implementation owns:

- clients,
- guild fetches,
- text channels,
- roles,
- permission overwrites,
- message sends,
- rate-limit handling,
- Discord error classification.

## Minimum Build Order

1. Add `discord.js` dependency to `packages/server`.
2. Build config parsing and bot registry.
3. Build Discord guild port and fake test port.
4. Build channel map.
5. Build role/private-channel manager.
6. Build formatter.
7. Build rate limiter.
8. Compose `DiscordGateway`.

## Non-Negotiables

- Use `allowedMentions: { parse: [] }` by default.
- Use `GatewayIntentBits.Guilds` for write-only MVP.
- Create private channels with overwrites at creation time when possible.
- Store Discord snowflakes; do not rely on names as identifiers.
- Preflight permissions before write operations.
- Treat 401/403/429 as operationally significant; do not blind-retry them.
