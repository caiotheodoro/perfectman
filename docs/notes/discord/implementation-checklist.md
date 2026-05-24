# Discord Gateway Implementation Checklist

Objective: turn the Discord.js notes into buildable tasks for Perfectman's future `packages/server/src/discord/` implementation.

## Scope

Implement Discord as a rich delivery surface, not a simulation authority.

In scope:

- bot registry,
- guild/channel/role setup,
- channel map persistence or in-memory MVP map,
- role manager,
- message formatter,
- rate limiter,
- gateway composition,
- mock-based tests.

Out of scope for first implementation:

- slash commands,
- ingesting Discord messages as events,
- using Discord as canonical persistence,
- webhooks as persona identity,
- sharding,
- multiple production guild rollout.

## Required Decisions

- D-001: Use Discord.js v14 in `packages/server`.
- D-002: Use one persona bot per agent for sends.
- D-003: Prefer a separate manager bot for channel/role mutation when config provides one.
- D-004: Use `GatewayIntentBits.Guilds` only for write-only MVP.
- D-005: Map private simulation channels to guild text channels plus one Discord role per private channel.
- D-006: Disable mentions in all formatter output by default.
- D-007: Make Discord state reconciled from local state; local state remains canonical.

## Task Plan

### US-001: Bot Registry

Independent test: fake clients can be registered and fetched by `agentId`; invalid/missing bot fails startup with a specific error.

- [ ] T001 [US-001] Add `discord.js` dependency to `packages/server/package.json`.
- [ ] T002 [US-001] Create `packages/server/src/discord/discord-config.ts` to parse guild ID, manager token, and persona bot token config.
- [ ] T003 [US-001] Create `packages/server/src/discord/bot-registry.ts` with login, ready wait, guild validation, `get(agentId)`, and shutdown.
- [ ] T004 [US-001] Add mock tests for successful registry startup, missing bot, invalid token classification, and shutdown.

### US-002: Channel Map

Independent test: local channel IDs resolve to Discord channel/role IDs; rerun does not duplicate mappings.

- [ ] T005 [US-002] Create `packages/server/src/discord/channel-map.ts` with an interface for map entries.
- [ ] T006 [US-002] Implement in-memory `ChannelMap` for MVP.
- [ ] T007 [US-002] Add persistence hooks or TODO boundary for later SQLite mapping.
- [ ] T008 [US-002] Test idempotent set/get/list behavior.

### US-003: Guild Setup

Independent test: fake guild creates missing base channels and reuses existing mapped channels.

- [ ] T009 [US-003] Create `packages/server/src/discord/discord-guild-port.ts` interfaces wrapping Discord.js guild/channel/role/member operations.
- [ ] T010 [US-003] Create `packages/server/src/discord/discord-guild-adapter.ts` concrete Discord.js adapter.
- [ ] T011 [US-003] Implement base channel setup for public, spectator, and operator channels.
- [ ] T012 [US-003] Test create/reuse behavior and wrong-type channel warnings.

### US-004: Private Channel Role Manager

Independent test: creating a private channel denies `@everyone`, grants private role, assigns member bots, removes stale members, and locks on stop.

- [ ] T013 [US-004] Create `packages/server/src/discord/role-manager.ts`.
- [ ] T014 [US-004] Implement private role create/reuse.
- [ ] T015 [US-004] Implement private text channel create/reuse with overwrites.
- [ ] T016 [US-004] Implement `addMember`, `removeMember`, and full membership reconciliation.
- [ ] T017 [US-004] Implement `lockAllChannels`.
- [ ] T018 [US-004] Test role assignment, stale role removal, permission overwrite shape, and lock behavior.

### US-005: Formatter

Independent test: committed events become Discord-safe message payloads with mentions disabled and bounded length.

- [ ] T019 [US-005] Create `packages/server/src/discord/discord-formatter.ts`.
- [ ] T020 [US-005] Format `message_sent`, `reply_sent`, `reaction_sent`, `private_motive_summary`, `recap_generated`, and `operator_warning`.
- [ ] T021 [US-005] Disable `allowedMentions` by default.
- [ ] T022 [US-005] Add tests for mention suppression, long text handling, and event-type coverage.

### US-006: Rate Limiter

Independent test: fake clock proves per-bot/per-channel ordering, retry-after handling, and salience policy.

- [ ] T023 [US-006] Create `packages/server/src/discord/discord-rate-limiter.ts`.
- [ ] T024 [US-006] Implement queue key `(agentId, discordChannelId)`.
- [ ] T025 [US-006] Implement retry/backoff and `retry_after` support.
- [ ] T026 [US-006] Implement salience drop/batch policy.
- [ ] T027 [US-006] Test 429, 403, transient errors, high/critical preservation, low drop, and ordering.

### US-007: DiscordGateway Composition

Independent test: a projected public/private/spectator/operator event calls the expected port method and never mutates local event repositories.

- [ ] T028 [US-007] Create `packages/server/src/discord/discord-gateway.ts`.
- [ ] T029 [US-007] Implement `sendAgentMessage`.
- [ ] T030 [US-007] Implement `createChannel`, `addMember`, `removeMember`.
- [ ] T031 [US-007] Implement `sendSpectatorEvent`, `sendOperatorEvent`, and `onSimulationStopped`.
- [ ] T032 [US-007] Test composition with fake bot registry, channel map, role manager, formatter, and rate limiter.

## Implementation Notes By File

### `discord-config.ts`

Responsibilities:

- parse environment/config once,
- validate duplicate `agentId`,
- validate missing token references,
- keep token values out of logs/errors.

### `bot-registry.ts`

Responsibilities:

- create clients with explicit intents,
- wait for `ClientReady`,
- fetch and validate guild membership,
- expose handles by `agentId`,
- route client errors to operator warnings/logging.

Do not:

- register `messageCreate` handlers in MVP,
- expose raw tokens,
- let every module call `client.login`.

### `discord-guild-port.ts`

Reason: tests should not mock the entire Discord.js object graph.

Port should expose high-level operations:

```ts
type DiscordGuildPort = {
  fetchTextChannel(id: string): Promise<DiscordTextChannelPort | null>;
  createTextChannel(input: CreateTextChannelInput): Promise<DiscordTextChannelPort>;
  fetchRole(id: string): Promise<DiscordRolePort | null>;
  createRole(input: CreateRoleInput): Promise<DiscordRolePort>;
  fetchMember(userId: string): Promise<DiscordMemberPort | null>;
  everyoneRoleId(): string;
};
```

### `role-manager.ts`

Responsibilities:

- make local channel membership real in Discord,
- use role-based private channel access,
- preflight permissions,
- classify missing permission and hierarchy failures,
- reconcile drift.

### `discord-rate-limiter.ts`

Responsibilities:

- shape traffic before Discord.js REST layer sees it,
- handle known backoff,
- preserve social ordering per persona/channel,
- expose metrics for operator feed.

### `discord-gateway.ts`

Responsibilities:

- orchestrate components,
- keep Discord errors out of simulation truth,
- convert delivery events to Discord operations,
- emit operator warnings.

## Eval Gate

Applies because this changes production-facing delivery behavior and tests.

Minimum deterministic tests:

- Bot registry config parsing and duplicate detection.
- Private channel overwrite construction.
- Role assignment add/remove idempotence.
- Rate limiter retry/drop ordering with fake clock.
- Formatter mention suppression.
- Gateway sends through fake ports and does not call local repository mutation.

Manual smoke test after implementation:

1. Create a test Discord guild.
2. Install manager bot and two persona bots.
3. Start one simulation with a public channel.
4. Send a projected message as persona A.
5. Create private channel with persona A and B.
6. Verify a non-member bot cannot view it.
7. Stop simulation and verify persona bots cannot send.

## Cost Gate

Risk surface: external API calls, retries, queue fan-out, one client per persona.

Release format:

```text
cost impact: medium | quality risk: medium | rollout: canary
```

Main cost driver: Discord API calls for multiple bot clients, channel/role reconciliation, and message send queues.

Expected direction: more runtime/network cost than mock/stdout delivery, but bounded if MVP avoids message ingestion and privileged member scans.

Metric:

- Discord API requests per simulation minute,
- queued messages by salience,
- 401/403/429 counts,
- average delivery latency per channel.

## Stability Gate

Use for production readiness:

- SLO: 99% of high/critical projected messages delivered to Discord within 30 seconds while Discord is reachable.
- Detection signal: operator warnings for failed sends, missing permissions, rate limit pause, invalid token, reconciliation failure.
- Rollback trigger: sustained 403/429 spike, invalid request count trend, private-channel visibility leak, duplicate critical messages.
- Mitigation: pause affected queue, lock managed channels, alert operator, keep simulation canonical state intact.
- Recurrence guardrail: tests for permission preflight and rate limiter backoff; startup validation for tokens/guild membership.

## Residual Risks

- Discord rate limits and policy can change.
- Role hierarchy mistakes are easy to miss in local mocks; manual smoke testing in a real test guild is required.
- One bot per persona increases operational complexity.
- Message duplication after ambiguous network timeouts cannot be perfectly solved without richer idempotency/reconciliation.
- Privileged intents should remain out of MVP unless a separate ingestion spec is approved.

## Verification Notes

- Source: [source-map.md](source-map.md)
- Local code checked: shared channel/event types and server repository boundaries.
- Current state: implementation files do not exist yet; this checklist is preparation for future implementation.
