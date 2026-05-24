# Sub-Plan: Discord Gateway

> Optional adapter implementing the delivery gateway boundary from [Dev2 Event Runtime Plan](./dev2-runtime.md).
> Cross-reference: [Master Contract](./master-contract.md)
> Discord.js reference: [Discord notes](../notes/discord/README.md)

## Objective

Implement Discord as a rich delivery surface for Perfectman without letting Discord become simulation authority.

Discord may own bot clients, guild channels, roles, permission overwrites, message sends, rate-limit handling, and reconciliation. The simulation runtime remains canonical for event commits, visibility, membership, emotional salience, memory, and spectator/operator projections.

## Scope

In scope:

- Discord.js v14 gateway implementation in `packages/server/src/discord/`.
- One persona bot per agent for visible message identity.
- Optional manager bot for guild/channel/role mutations.
- Guild text channels for public, private, spectator, and operator surfaces.
- Role-based private-channel access.
- Local `ChannelMap` from simulation channel IDs to Discord snowflakes.
- Application-level send queue above Discord.js.
- Mock/fake Discord ports for CI tests.

Out of scope for this plan:

- Discord message ingestion.
- Slash commands.
- Direct messages.
- Threads as private channels.
- Discord as canonical persistence.
- Real Discord API calls in CI.

## Assumptions

- A configured Discord guild exists.
- Persona bots are installed in the guild.
- If dynamic setup is enabled, a manager bot is installed with `ManageChannels` and `ManageRoles`.
- Write-only MVP uses `GatewayIntentBits.Guilds` only.
- Discord.js details come from [source-map.md](../notes/discord/source-map.md), currently targeting Discord.js v14.26.2.

## Requirements

- FR-001: Project committed agent messages to the mapped Discord text channel using the correct persona bot.
- FR-002: Project spectator and operator outputs to dedicated Discord text channels.
- FR-003: Mirror private simulation channels as Discord guild text channels with role-based access.
- FR-004: Keep Discord state derived from local simulation/channel state; never mutate the event log from Discord delivery.
- FR-005: Reconcile Discord channels, roles, overwrites, and member assignments idempotently.
- FR-006: Queue outbound messages per persona/channel and obey Discord retry/backoff signals.
- FR-007: Disable Discord mentions by default in all projected messages.
- FR-008: Classify Discord API failures into retryable, permission, auth, missing-resource, validation, and unknown outcomes.
- FR-009: Use fake Discord ports in tests; do not call Discord in CI.

## Success Criteria

- SC-001: A public committed message appears in the mapped public Discord channel from the actor's persona bot.
- SC-002: A private committed message appears only in the mapped private Discord channel.
- SC-003: Non-member persona bots cannot view or send in a private Discord channel at the Discord permission level.
- SC-004: Re-running setup does not duplicate channels or roles.
- SC-005: High and critical salience messages are not dropped by local queue policy.
- SC-006: Low salience messages can be dropped only by explicit queue pressure policy.
- SC-007: Missing Discord permissions produce operator warnings instead of repeated blind retries.
- SC-008: All gateway tests run with fakes/mocks and no real tokens.

## Architecture

```text
DeliveryProjection
  -> IDeliveryGateway
  -> DiscordGateway
      -> BotRegistry
      -> DiscordGuildPort / DiscordJsGuildAdapter
      -> ChannelMap
      -> RoleManager
      -> DiscordFormatter
      -> DiscordRateLimiter
      -> DiscordErrorClassifier
```

Boundary rule:

```text
CommittedEvent is cause.
Discord message/channel/role mutation is effect.
```

Discord delivery failure must not rewrite simulation history. It may emit operator warnings and retry/reconcile delivery state.

## Discord Mapping

| Perfectman | Discord | Notes |
| --- | --- | --- |
| Simulation | Configured guild, optionally prefixed/category-isolated resources | Use deterministic names and stored snowflakes. |
| `public_channel` | `ChannelType.GuildText` | Visible/sendable to persona bots. |
| `private_channel` | `ChannelType.GuildText` + private role + overwrites | Deny `ViewChannel` to `@everyone`; allow role. |
| `spectator_channel` | Guild text channel | Human-facing narrative projection. |
| `operator_channel` | Guild text channel | Diagnostics; hidden from persona bots. |
| Agent persona | Discord bot user | One bot token per persona. |
| Channel membership | Discord role assignment | Local membership is truth; Discord is mirror. |

Resource naming:

```text
pm-{simulationId}-general
pm-{simulationId}-spectator
pm-{simulationId}-operator
pm-{simulationId}-priv-{channelId}
pm-{simulationId}-role-{channelId}
```

## Client Configuration

Write-only MVP:

```ts
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});
```

Use `Events.ClientReady` and `Events.Error`. Do not register `MessageCreate`, `InteractionCreate`, `TypingStart`, or reaction ingestion handlers in this plan.

Config shape:

```ts
type DiscordGatewayConfig = {
  guildId: string;
  managerBotToken?: string;
  personaBots: Array<{ agentId: string; token: string }>;
  setupMode: "readonly_existing" | "manage_channels";
};
```

See [client-config-recipes.md](../notes/discord/implementation/client-config-recipes.md) for exact modes and env parsing.

## Permissions

Prefer least privilege:

- Manager bot: `ViewChannel`, `SendMessages`, `ReadMessageHistory`, `ManageChannels`, `ManageRoles`.
- Persona bots: `ViewChannel`, `SendMessages`, `ReadMessageHistory`, optional `AddReactions`.

Avoid granting persona bots `ManageChannels`, `ManageRoles`, or `Administrator`.

Private-channel overwrites:

```text
@everyone: deny ViewChannel
private channel role: allow ViewChannel, SendMessages, ReadMessageHistory
manager bot: allow ViewChannel, SendMessages, ManageChannels
```

Role hierarchy must be validated in a real guild smoke test. `ManageRoles` is not enough if the manager bot's highest role cannot manage the target role.

## SDK Function Map

Core Discord.js calls:

| Task | Discord.js call |
| --- | --- |
| Login | `client.login(token)` |
| Ready | `client.once(Events.ClientReady, cb)` |
| Fetch guild | `client.guilds.fetch(guildId)` |
| Create text channel | `guild.channels.create({ name, type: ChannelType.GuildText })` |
| Fetch channel | `guild.channels.fetch(channelId)` |
| Create role | `guild.roles.create(options)` |
| Fetch member | `guild.members.fetch(userId)` |
| Assign role | `member.roles.add(roleId, reason)` |
| Remove role | `member.roles.remove(roleId, reason)` |
| Replace overwrites | `channel.permissionOverwrites.set(overwrites, reason)` |
| Check permissions | `channel.permissionsFor(memberOrRole)` |
| Send message | `channel.send({ content, allowedMentions: { parse: [] } })` |
| Send typing | `channel.sendTyping()` |

Detailed cookbook: [sdk-cookbook.md](../notes/discord/implementation/sdk-cookbook.md).

## Private Channel Lifecycle

1. Runtime commits `channel_created`.
2. Projection calls `DiscordGateway.createChannel(...)`.
3. `RoleManager` ensures a private Discord role exists.
4. `RoleManager` ensures a guild text channel exists with private overwrites at creation time when possible.
5. `RoleManager` assigns the private role to member persona bot users.
6. `ChannelMap` stores Discord channel and role IDs.
7. Runtime commits `agent_invited` or `agent_left`.
8. Gateway adds/removes private role assignment.
9. `simulation_stopped` locks persona write access while preserving audit visibility as configured.

## Reconciliation

Run reconciliation at startup and after partial Discord failures:

1. Fetch guild.
2. Fetch or create base public/spectator/operator channels.
3. Fetch or create private roles.
4. Fetch or create private text channels.
5. Apply desired permission overwrites.
6. Compare local `memberAgentIds` with role assignments.
7. Add missing role assignments.
8. Remove stale Perfectman private-role assignments.
9. Validate member/non-member permissions.
10. Emit operator warnings for unrecoverable drift.

Do not infer identity from channel names except as a recovery path. Persist Discord snowflake IDs in `ChannelMap`.

## Message Formatting

All sends use:

```ts
allowedMentions: { parse: [] }
```

Persona messages should not be prefixed with metadata if the Discord bot identity already represents the speaker.

Spectator/operator messages may include compact labels such as `[recap]` or `[discord warning]`.

Formatter must bound message length and return `null` for event types not projected to Discord.

## Rate Limiting

Do not hard-code route-specific Discord limits. Discord's documented guidance is to obey rate-limit headers and 429 response data, especially `retry_after`.

Local queue policy:

- Queue key: `(agentId, discordChannelId)`.
- Preserve FIFO order per queue key.
- High and critical salience messages are never dropped by local policy.
- Low salience messages may be dropped only when queue pressure crosses a configured threshold.
- Medium salience messages may be batched only if the projection is informational, not direct persona speech.
- 429 pauses the relevant queue/global state using Discord-provided retry timing.
- 401 disables the bot/config path.
- 403 pauses the target and emits an operator warning.
- 404 triggers reconciliation.

## Files To Create

```text
packages/server/src/discord/
  discord-config.ts          # parse env/config once; never log token values
  discord-errors.ts          # classify Discord.js/API failures
  discord-gateway.ts         # IDeliveryGateway implementation and composition root
  bot-registry.ts            # login N persona clients and optional manager client
  discord-guild-port.ts      # fakeable port for guild/channel/role/member operations
  discord-guild-adapter.ts   # Discord.js implementation of the port
  channel-map.ts             # simulation channelId -> Discord channel/role IDs
  role-manager.ts            # private channel roles, overwrites, member sync, locking
  discord-rate-limiter.ts    # per-persona/channel queues, retry/backoff, salience policy
  discord-formatter.ts       # CommittedEvent/projection -> Discord-safe payload
  __tests__/
    bot-registry.test.ts
    channel-map.test.ts
    discord-formatter.test.ts
    discord-gateway.test.ts
    discord-rate-limiter.test.ts
    role-manager.test.ts
```

Implementation skeleton: [implementation-skeleton.md](../notes/discord/implementation/implementation-skeleton.md).

## Tasks

### US-001: Bot Registry And Config

Independent test: fake clients can be registered and fetched by `agentId`; invalid config fails with specific non-secret errors.

- [ ] T001 [US-001] Add `discord.js` dependency to `packages/server/package.json`.
- [ ] T002 [US-001] Create `discord-config.ts` for guild ID, manager token, and persona bot token parsing.
- [ ] T003 [US-001] Create `bot-registry.ts` with `GatewayIntentBits.Guilds`, ready wait, guild validation, and shutdown.
- [ ] T004 [US-001] Add config/registry tests for duplicate agents, missing env vars, ready success, and startup failure classification.

### US-002: Discord Port And Channel Map

Independent test: fake port can create/fetch text channels, roles, members, and overwrites without Discord.js.

- [ ] T005 [US-002] Create `discord-guild-port.ts`.
- [ ] T006 [US-002] Create `discord-guild-adapter.ts` wrapping Discord.js calls.
- [ ] T007 [US-002] Create `channel-map.ts` with in-memory MVP implementation.
- [ ] T008 [US-002] Test channel map idempotence and fake port behavior.

### US-003: Guild Init And Role Manager

Independent test: private channel creation denies `@everyone`, grants private role access, assigns member bots, and persists snowflake mapping.

- [ ] T009 [US-003] Implement base public/spectator/operator channel setup or reuse.
- [ ] T010 [US-003] Implement private role create/reuse.
- [ ] T011 [US-003] Implement private text channel create/reuse with creation-time overwrites.
- [ ] T012 [US-003] Implement add/remove member through role assignment.
- [ ] T013 [US-003] Implement lock-all-channels behavior for simulation stop.
- [ ] T014 [US-003] Test private visibility, member changes, stale mapping recovery, and locking.

### US-004: Formatter And Delivery Queue

Independent test: formatted messages suppress mentions, obey length policy, and rate limiter preserves salience policy.

- [ ] T015 [US-004] Implement `discord-formatter.ts`.
- [ ] T016 [US-004] Implement `discord-errors.ts`.
- [ ] T017 [US-004] Implement `discord-rate-limiter.ts` with fake-clock tests.
- [ ] T018 [US-004] Test 429 retry timing, 401/403/404 classification, low drop policy, and high/critical preservation.

### US-005: Gateway Composition

Independent test: projected public/private/spectator/operator output calls the expected fake port/queue and never mutates event repositories.

- [ ] T019 [US-005] Implement `discord-gateway.ts`.
- [ ] T020 [US-005] Wire `sendAgentMessage`, `createChannel`, `addMember`, `removeMember`, `sendSpectatorEvent`, `sendOperatorEvent`, and `onSimulationStopped`.
- [ ] T021 [US-005] Add gateway composition tests with fake registry, fake map, fake role manager, fake formatter, and fake limiter.
- [ ] T022 [US-005] Add manual test-guild smoke checklist to implementation notes or operator docs.

## Milestones

- DG-M1: Config and bot registry.
- DG-M2: Discord port, adapter, and channel map.
- DG-M3: Guild setup and private-channel role manager.
- DG-M4: Formatter, error classifier, and rate limiter.
- DG-M5: Gateway composition and fake-based integration tests.
- DG-M6: Manual test-guild smoke pass.

## Eval Gate

Applies because Discord delivery touches production-facing behavior, external API use, and private-channel visibility.

Minimum deterministic tests:

- config parsing never logs tokens,
- private channel overwrites deny `@everyone`,
- member add/remove maps to role add/remove,
- formatter disables mentions,
- rate limiter handles 429 retry timing and 403 stop/warn behavior,
- gateway does not mutate canonical repositories.

Manual smoke:

1. Create a test Discord guild.
2. Install manager bot and at least two persona bots.
3. Start one simulation with public, spectator, and operator channels.
4. Send public message from persona A.
5. Create private channel with persona A and B.
6. Verify a non-member persona bot cannot view private channel.
7. Stop simulation and verify persona bots cannot send.

## Cost Gate

Risk surface: external API calls, retries, multiple bot clients, channel/role reconciliation.

```text
cost impact: medium | quality risk: medium | rollout: canary
```

Main cost driver: Discord REST operations and one gateway client per persona bot.

Metric:

- Discord API requests per simulation minute.
- Queue depth by salience.
- 401/403/429 counts.
- Delivery latency per channel.
- Reconciliation repair count.

## Stability Gate

SLO candidate: 99% of high/critical Discord projections delivered within 30 seconds while Discord is reachable and permissions are valid.

Detection signals:

- `discord_rate_limited`
- `discord_missing_permission`
- `discord_invalid_token`
- `discord_channel_missing`
- `discord_role_missing`
- `discord_reconciliation_failed`

Rollback triggers:

- private-channel visibility leak,
- repeated 403/429 spike,
- invalid token affecting active simulation,
- duplicate critical messages,
- reconciliation creating duplicate channels/roles.

Mitigation:

- pause affected queue,
- lock managed channels if visibility is unsafe,
- emit operator warning,
- keep canonical simulation state unchanged,
- require manual guild inspection for role hierarchy issues.

## Done Criteria

- FR-001 through FR-009 are implemented or explicitly deferred.
- SC-001 through SC-008 pass.
- All tests use fakes/mocks; no real Discord API calls in CI.
- Manual test-guild smoke pass is recorded before real usage.
- `docs/notes/discord/` remains the source for SDK/config/API detail.
