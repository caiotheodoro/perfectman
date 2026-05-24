# Discord Project Fit

Objective: define how Discord should fit Perfectman's architecture without letting Discord become the product model.

## Perfectman Boundary

Perfectman's source of truth is the simulation runtime:

- committed event log,
- channel registry and memberships,
- visibility filters,
- attention and interpretation,
- emotion, motivation, pressure, inhibition,
- intent resolver,
- memory and spectator feed.

Discord is an adapter. Discord may display channels, roles, bot identities, and messages, but Discord should not decide canonical simulation facts.

## Discord Surface Responsibilities

The Discord adapter may own:

- logging one Discord.js `Client` per persona bot token,
- fetching the target guild for each client,
- creating or reusing guild text channels,
- creating or reusing Discord roles for private-channel membership,
- applying permission overwrites that match simulation channel membership,
- sending projected messages to text channels,
- sending spectator and operator events to dedicated channels,
- handling Discord API failures, rate limits, retries, and idempotent recovery.

The Discord adapter must not own:

- agent motivations,
- visibility rules,
- event validation,
- event ordering,
- memory writes,
- "who should speak" decisions,
- private-channel social meaning,
- simulation membership as canonical state.

## Mapping Table

| Perfectman Concept | Discord Concept | Notes |
| --- | --- | --- |
| Simulation instance | One configured Discord guild or a guild namespace/category | Use a single guild for MVP. If multiple simulations run in one guild, prefix/category-isolate all created resources. |
| `public_channel` | Guild text channel visible to participating bots | `#general` can be pre-created or managed by the gateway. |
| `private_channel` | Guild text channel with role/member permission overwrites | Prefer one Discord role per simulation private channel; assign persona bot members to that role. |
| `spectator_channel` | Guild text channel for human-visible narrative | Do not expose hidden facts unless `omniscientSpectatorMode` or projection says so. |
| `operator_channel` | Guild text channel for diagnostics/admin | Should be hidden from agent bots. |
| Agent persona | Bot application/user | Current plan uses one bot token per persona so messages appear as that persona. |
| `CommittedEvent` | Message or resource mutation projection | Discord messages are effects of events, not events themselves. |
| `ChannelMembership` | Discord role assignment or channel overwrite | Discord state mirrors local state; local state wins in reconciliation. |

## One Bot Per Persona

Current plan: each persona has its own Discord bot token.

Benefits:

- messages appear as distinct Discord users,
- no need for webhook impersonation,
- permission visibility can be tested per bot,
- Discord's own member list reinforces social presence.

Costs:

- each bot has its own token and lifecycle,
- role/channel permission setup must include every bot,
- rate limiting is per authorization identity plus route,
- startup and reconnect behavior is more complex,
- adding personas requires app/bot provisioning.

Implementation implication: `BotRegistry` should treat each bot as an independent client record:

```ts
type PersonaBot = {
  agentId: string;
  client: Client<true>;
  userId: string;
  guildId: string;
};
```

Do not pass raw Discord.js clients through the whole server. Wrap only the methods needed by the gateway so unit tests can use fakes.

## Write-Only First Pass

The plan says no incoming Discord event listeners for the first implementation. That is compatible with Discord.js:

- login with minimal intents,
- fetch guild and target resources through REST-backed managers,
- send messages and mutate roles/channels from local events,
- listen only to process-level client readiness/errors needed for health.

Even in write-only mode, a Gateway connection exists because `Client#login` establishes one. The important constraint is that incoming Discord events are operational signals, not simulation input.

## Future Rich Discord Surface

If Discord becomes the actual first-class live surface, add these capabilities deliberately:

- listen to human/operator interactions with `interactionCreate`,
- optionally ingest Discord messages into the local event log with `messageCreate`,
- map Discord reactions to `reaction_sent`,
- map typing events to `typing_started` only if the product needs them,
- reconcile external channel/role edits into operator warnings rather than silently changing simulation truth,
- require explicit decisions around privileged intents.

Do not partially ingest Discord messages without a full authority model. The moment Discord input can become canonical, the runtime must validate and commit it through the same intent/event path as every other input.

## Resource Naming

Use deterministic names to support idempotent setup:

```text
pm-{simulationId}-general
pm-{simulationId}-spectator
pm-{simulationId}-operator
pm-{simulationId}-priv-{channelId}
pm-{simulationId}-role-{channelId}
```

Store Discord snowflakes in a local `ChannelMap` persistence layer:

```ts
type DiscordChannelMapEntry = {
  simulationId: string;
  channelId: string;
  discordChannelId: string;
  discordRoleId?: string;
  type: ChannelType;
  createdAt: number;
};
```

Do not depend on channel names as the only mapping. Names can be edited by users and are not stable identifiers.

## Reconciliation Model

Discord API writes can partially succeed. The gateway needs a reconciliation pass:

1. Fetch guild.
2. Fetch or create base channels.
3. Fetch or create private-channel roles.
4. Fetch or create private-channel text channels.
5. Compare local `memberAgentIds` to Discord role assignments.
6. Add missing assignments and remove stale assignments.
7. Validate bot permissions in each mapped channel.
8. Emit operator warnings for drift that cannot be repaired.

Use the local event/channel repositories as truth. Discord is eventually consistent output state.

## Security Model

Minimum practical bot permissions for the manager bot/client depend on architecture:

- `ViewChannel`
- `SendMessages`
- `ReadMessageHistory` if messages are fetched or context is inspected
- `ManageChannels` for channel create/edit/overwrites
- `ManageRoles` for private-channel role creation and assignment
- `AddReactions` if the gateway sends reactions

With one bot per persona, avoid granting every persona bot full management powers if possible. A safer split is:

- one operator/manager bot handles channel and role management,
- persona bots only receive `ViewChannel`, `SendMessages`, and optional `AddReactions` in their allowed channels.

The existing plan says each agent bot can post and role management exists. It does not require every persona bot to manage channels. Prefer least privilege.

## Decisions

- D-001: Treat Discord as mirrored surface state; local simulation remains canonical.
- D-002: Use guild text channels, not DMs, for private simulation spaces.
- D-003: Use role-based access for private channels; avoid per-bot member overwrites unless role assignment is impossible.
- D-004: Use one persona bot per agent for visible identity, but use a separate manager bot for resource mutation if credentials allow it.
- D-005: Keep incoming Discord events outside simulation truth until a separate ingestion spec exists.

## Success Criteria

- SC-001: A committed public message projects to the mapped public Discord text channel.
- SC-002: A committed private message projects only to the mapped private Discord text channel.
- SC-003: A non-member persona bot cannot view or send in a private Discord channel.
- SC-004: Discord setup can be rerun without duplicating channels/roles.
- SC-005: Discord failures produce retryable gateway outcomes or operator warnings without mutating local canonical state.
