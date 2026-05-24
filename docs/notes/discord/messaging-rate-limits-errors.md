# Messaging, Rate Limits, And Errors

Objective: define how Perfectman should send Discord messages and survive Discord API limits/failures.

## Sending Messages

For a text channel:

```ts
await channel.send("message text");
```

For structured content:

```ts
await channel.send({
  content: "message text",
  allowedMentions: { parse: [] },
});
```

Default recommendation: always set `allowedMentions: { parse: [] }` unless the product deliberately wants Discord mentions. Simulation text should not accidentally ping real humans or roles.

## Message Payload Policy

MVP should send plain content only:

- no embeds unless spectator/operator readability demands it,
- no files unless a feature explicitly needs them,
- no components/buttons unless Discord input is in scope,
- no broad mentions.

Formatter output should be bounded:

```ts
type DiscordFormattedMessage = {
  content: string;
  allowedMentions: { parse: [] };
};
```

Discord messages have API length limits; enforce local max content length in `discord-formatter.ts` and split or summarize if needed. Recheck current Discord limits before implementation.

## Typing Indicators

`channel.sendTyping()` sends a typing indicator.

Use sparingly. It can increase realism, but it is an API operation and should not become a behavioral clock.

Good use:

- send typing only when a message is already scheduled soon,
- suppress typing for low-salience or batched events,
- never use typing as a canonical event unless the runtime commits `typing_started`.

## Reactions

If the gateway later projects `reaction_sent`, use Discord.js reaction APIs on messages. The current shared event model includes `reaction_sent`, but the Discord gateway plan is focused on messages/channels/roles first.

Need a Discord message ID mapping if reactions target prior messages:

```ts
type DiscordMessageMapEntry = {
  simulationId: string;
  eventId: string;
  discordChannelId: string;
  discordMessageId: string;
  agentId: string;
  sentAt: number;
};
```

Without this map, only free-standing reaction narrative can be sent as text.

## REST Rate Limits

Discord's official guidance: do not hard-code route-specific limits. Rate limits vary by endpoint and can change. Use response headers and 429 response bodies.

Important response information:

- `retry_after` says how many seconds to wait,
- `global` indicates a global limit,
- rate limit headers expose bucket, remaining, reset, and scope details,
- global bot API limit is separate from individual route limits.

Discord.js has internal REST handling, but Perfectman still needs application-level queues to shape outgoing simulation traffic.

## Gateway Rate Limits

Gateway limits are separate from REST limits. Discord documents a gateway send limit of 120 gateway events per connection per 60 seconds. Exceeding it can disconnect the gateway connection.

Most Perfectman sends are REST calls. Gateway limits matter for:

- identifying/logging in,
- presence updates,
- other gateway operations Discord.js handles internally.

Avoid frequent presence changes for personas in MVP.

## Invalid Request Limit

Discord tracks invalid HTTP requests. Too many 401, 403, or 429 responses can temporarily restrict the IP.

Avoid invalid requests by:

- validating tokens during startup,
- stopping requests after a token is known invalid,
- checking permissions before writes,
- obeying `retry_after`,
- disabling sends to missing/deleted Discord channels until reconciliation fixes them,
- not retrying 404 webhooks/resources forever.

This matters more than a simple "catch and retry" strategy. Blind retries can create a platform-level ban condition.

## RateLimiter Design

Current plan says "per-bot, per-channel queue." Keep that, but base it on Discord behavior:

```ts
type QueueKey = `${agentId}:${discordChannelId}`;
```

Queue entry:

```ts
type DiscordOutboundMessage = {
  id: string;
  agentId: string;
  simulationId: string;
  channelId: string;
  discordChannelId: string;
  eventId: string;
  salience: "low" | "medium" | "high" | "critical";
  content: string;
  attempts: number;
  notBefore: number;
  createdAt: number;
};
```

Behavior:

- FIFO per queue key for same bot/channel,
- global scheduler also respects any global backoff,
- high and critical messages are never dropped by local policy,
- low messages may be dropped when queue is deep,
- medium messages may be collapsed into a summary only if projection marks them collapsible,
- retries use Discord-provided `retry_after` when available,
- permanent failures become operator events.

## Drop And Batch Policy

Do not drop canonical events. Only drop Discord delivery attempts for low-salience projections.

Local policy:

- `critical`: never drop; retry until success, cancellation, or manual operator intervention.
- `high`: never drop; retry with backoff and raise operator warning after threshold.
- `medium`: retry; may batch if multiple messages are informational and not direct persona speech.
- `low`: drop if queue is beyond threshold or event is stale.

Direct persona speech should almost never be batched because timing and identity matter socially.

Good batching candidates:

- operator metrics,
- spectator low-salience recaps,
- repeated warnings with same cause.

Bad batching candidates:

- agent messages,
- private-channel invitations,
- relationship-turning high-salience events.

## Idempotency

Discord send is not naturally idempotent. If a request times out, the message may or may not have been created.

Mitigation:

- keep a local `eventId -> discordMessageId` map after success,
- before retrying after unknown timeout, optionally inspect recent channel messages only if the bot has permission and the message carries a deterministic marker,
- for MVP, accept rare duplicate low/medium messages but avoid duplicate critical messages by operator review after ambiguous failures.

Do not edit local event history to compensate for Discord duplicates.

## Error Classification

Classify errors by operational meaning:

| Class | Examples | Action |
| --- | --- | --- |
| transient | network reset, guild unavailable, 5xx | retry with backoff. |
| rate_limited | 429, Discord REST rate-limit signal | wait for `retry_after`; pause relevant bucket/global. |
| missing_permission | 403, Discord missing permissions code | stop queue for that target; emit operator warning; run reconciliation. |
| invalid_auth | 401 or token login failure | disable bot; alert operator; no retry loop. |
| not_found | channel/role/member deleted or wrong ID | run reconciliation; if unrecoverable, operator warning. |
| validation | message too long, invalid channel type | formatter or mapping bug; fail fast in tests. |

## Operator Warning Shape

Discord gateway errors should become structured operator events:

```ts
type DiscordGatewayWarning = {
  type: "discord_gateway_warning";
  simulationId: string;
  severity: "info" | "warning" | "critical";
  reason:
    | "discord_rate_limited"
    | "discord_missing_permission"
    | "discord_invalid_token"
    | "discord_channel_missing"
    | "discord_role_missing"
    | "discord_send_failed"
    | "discord_reconciliation_failed";
  discordGuildId?: string;
  discordChannelId?: string;
  discordRoleId?: string;
  agentId?: string;
  retryAt?: number;
};
```

Never include token values.

## Formatting For Social Presence

Persona message projection:

```text
{content}
```

Avoid prefixing every persona message with metadata if the bot identity already indicates speaker.

Spectator projection:

```text
[recap] Mariana noticed the silence after Caio moved private.
```

Operator projection:

```text
[discord warning] private channel ch42 is missing SendMessages for agent caio.
```

Operator format can be denser. Spectator format should remain product-facing.

## Queue Shutdown

On `simulation_stopped`:

1. Stop accepting new persona messages for the simulation.
2. Flush or cancel queued low/medium messages according to policy.
3. Preserve critical operator warnings.
4. Lock Discord channels.
5. Mark queues closed.

Do not destroy shared clients unless the server is shutting down.

## Testing Strategy

Test rate limiter with fake clock:

- respects `notBefore`,
- retries after 429 using `retry_after`,
- drops low-salience stale messages under threshold pressure,
- never drops high/critical messages,
- stops a target queue on missing permission,
- emits operator warnings after repeated failures,
- does not reorder messages for the same bot/channel.

Test formatter:

- disables mentions,
- truncates/splits long content,
- preserves persona speech without internal metadata,
- escapes or removes dangerous/control content if needed.

## Verification Notes

- Source: Discord.js `TextChannel` docs for `send` and `sendTyping`.
- Source: Discord rate limit docs for response shape, global limit, and invalid request limit guidance.
- Source: Discord Gateway docs for gateway send limits.
- Code evidence: Perfectman events include `emotionalSalience`, which maps directly to local queue priority/drop policy.
