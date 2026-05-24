# Discord Client Config Recipes

Objective: define concrete Discord.js client configurations for each Perfectman Discord mode.

## Shared Config Shape

```ts
export type DiscordPersonaBotConfig = {
  agentId: string;
  token: string;
};

export type DiscordGatewayConfig = {
  guildId: string;
  managerBotToken?: string;
  personaBots: DiscordPersonaBotConfig[];
  baseCategoryId?: string;
  setupMode: "readonly_existing" | "manage_channels";
};
```

## Environment Shape

Recommended:

```text
DISCORD_GUILD_ID=123
DISCORD_MANAGER_TOKEN=...
DISCORD_AGENT_BOTS=goulart:DISCORD_TOKEN_GOULART,caio:DISCORD_TOKEN_CAIO
DISCORD_TOKEN_GOULART=...
DISCORD_TOKEN_CAIO=...
```

Parsing rule:

- `DISCORD_AGENT_BOTS` maps `agentId` to env var name.
- Token values live only in the referenced env vars.
- Error messages may mention missing env var names, never token values.

## Recipe A: Write-Only MVP

Use when Discord only receives projected simulation output.

```ts
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});
```

Events to handle:

- `Events.ClientReady`
- `Events.Error`

Do not handle:

- `Events.MessageCreate`
- `Events.MessageReactionAdd`
- `Events.TypingStart`
- `Events.InteractionCreate`

Permissions:

- manager bot: `ViewChannel`, `SendMessages`, `ManageChannels`, `ManageRoles`, optionally `ReadMessageHistory`.
- persona bots: `ViewChannel`, `SendMessages`, optionally `AddReactions`, `ReadMessageHistory`.

Use cases:

- create/reuse channels,
- create/reuse roles,
- assign roles to persona bot members,
- send persona/spectator/operator messages.

## Recipe B: Existing Channels Only

Use when an operator manually creates all Discord channels/roles and the gateway only sends messages.

```ts
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});
```

Config must provide all channel IDs:

```ts
type ExistingDiscordChannelsConfig = {
  publicChannelId: string;
  spectatorChannelId: string;
  operatorChannelId: string;
  privateChannelIdsBySimulationChannelId: Record<string, string>;
};
```

Permissions:

- persona bots only need send access to their channels.
- no `ManageChannels` or `ManageRoles` required if memberships are static.

Trade-off:

- lower Discord permission risk,
- less automation,
- cannot dynamically mirror private channels unless operator updates config.

## Recipe C: Reaction Projection

Use when simulation `reaction_sent` events should become real Discord reactions.

```ts
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});
```

Sending reactions does not require receiving reaction gateway events. The gateway needs:

- `AddReactions` permission,
- message ID mapping,
- emoji validation.

Only add `GatewayIntentBits.GuildMessageReactions` if Discord reactions are ingested as events.

## Recipe D: Discord Message Ingestion

Use only after a separate ingestion spec exists.

```ts
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
```

Event handlers:

- `Events.MessageCreate`

Risks:

- `MessageContent` is privileged.
- Human Discord messages become a new command/input surface.
- The runtime must validate and commit imported messages as canonical events.

Required design before enabling:

- Which Discord users are allowed to speak into the simulation?
- Which channels are ingested?
- How are Discord users mapped to agents/operators/humans?
- How are deleted/edited Discord messages represented?
- How are duplicate events prevented after reconnect?

## Recipe E: Member Reconciliation By Events

Use only if passive member/role updates must be observed in real time.

```ts
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});
```

Event handlers:

- `Events.GuildMemberUpdate`
- optionally guild member add/remove events if bots/users are joining dynamically.

Risk:

- `GuildMembers` is privileged.

MVP alternative:

- fetch known bot members by ID during reconciliation,
- avoid broad member-list ingestion.

## Recipe F: Slash Commands Or Interactions

Out of scope for current gateway, but future config:

```ts
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});
```

Interactions are received through:

- `Events.InteractionCreate`

Also requires command registration through Discord REST/application commands. Keep separate from persona simulation output.

## Client Options To Consider Later

```ts
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  rest: {
    retries: 3,
    timeout: 15_000,
  },
});
```

Only add options when there is a concrete operational need. Discord.js already handles many REST details internally.

## Multi-Bot Startup Policy

Startup should classify each bot:

```ts
type BotStartupStatus =
  | { status: "ready"; agentId: string; userId: string }
  | { status: "failed"; agentId: string; reason: DiscordStartupFailureReason };
```

For MVP:

- manager bot failure is fatal if setup mode is `manage_channels`.
- persona bot failure is fatal if the simulation includes that agent.
- unrelated configured persona bot failure can be non-fatal only if no active simulation needs it.

## Config Validation Checklist

- `guildId` is present.
- every `agentId` is unique.
- every token env var exists.
- no raw token is printed.
- manager token exists when `setupMode === "manage_channels"`.
- at least one persona bot is configured.
- no persona bot token is reused under multiple agent IDs unless explicitly allowed.

## Least Privilege Profiles

### Manager Bot

Use for setup/reconciliation:

- `ViewChannel`
- `SendMessages`
- `ReadMessageHistory`
- `ManageChannels`
- `ManageRoles`

### Persona Bot

Use for agent identity:

- `ViewChannel`
- `SendMessages`
- `ReadMessageHistory`
- `AddReactions` if needed

### Spectator Bot

Optional:

- `ViewChannel`
- `SendMessages`
- `EmbedLinks` if recaps use embeds

## Configuration Anti-Patterns

- Granting every persona bot `Administrator`.
- Requesting `MessageContent` before ingestion exists.
- Relying on channel names instead of IDs after setup.
- Loading tokens inside many modules.
- Treating missing permissions as retryable without operator intervention.
