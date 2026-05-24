# Discord.js Client And Intents

Objective: document the Discord.js client lifecycle and Gateway intent choices needed for Perfectman.

## Version Target

Use Discord.js v14.26.2 unless the package version installed in the repo says otherwise. Context7 resolved `/websites/discord_js_packages_discord_js_14_26_2` as the freshest indexed package docs on 2026-05-23.

The repo currently does not list `discord.js` in `package.json`. Add the dependency only when implementing the gateway.

Expected install target:

```bash
pnpm add discord.js --filter @perfectman/server
```

## Core Imports

Typical v14 imports:

```ts
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
} from "discord.js";
```

Use `Events.ClientReady` and `Events.Error` rather than stringly-typed event names where possible.

## Client Construction

Discord.js `Client` is the main object for interacting with Discord. It owns managers for guilds, channels, users, REST, and WebSocket state.

Minimal write-oriented client:

```ts
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});
```

Why `Guilds`:

- channel create/update/delete events are in the guild domain,
- the client needs guild metadata and manager access,
- write-only MVP does not need message content or member/presence event streams.

If the implementation only uses raw REST and never logs in gateway clients, `@discordjs/rest` could be considered, but the current plan is explicitly Discord.js client based and one bot per persona.

## Login And Readiness

`client.login(token)` establishes a Discord WebSocket connection. The token must be treated as a secret.

Operational lifecycle:

1. Construct client with explicit intents.
2. Attach readiness and error listeners.
3. Call `login(token)`.
4. Wait for ready.
5. Fetch the configured guild.
6. Validate required resources and permissions.
7. Mark bot ready in `BotRegistry`.

Skeleton:

```ts
async function loginPersonaBot(agentId: string, token: string): Promise<PersonaBot> {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on(Events.Error, error => {
    // Route to operator feed or logger, never throw inside event handler.
  });

  const ready = new Promise<Client<true>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("discord_client_ready_timeout")), 30_000);

    client.once(Events.ClientReady, readyClient => {
      clearTimeout(timeout);
      resolve(readyClient);
    });
  });

  await client.login(token);
  const readyClient = await ready;

  return {
    agentId,
    client: readyClient,
    userId: readyClient.user.id,
    guildId: "configured-guild-id",
  };
}
```

Implementation note: do not log tokens, and do not include tokens in thrown error messages.

## Shutdown

Use `client.destroy()` during server shutdown or simulation teardown if clients should disconnect. Destroy logs out, terminates the connection, and destroys the client.

`onSimulationStopped` should lock channels but should not necessarily destroy shared clients if another simulation may still use them.

## Guild Fetching

Each client has `client.guilds`, a manager of guilds the bot is in. The target guild should be configured by snowflake ID.

Pattern:

```ts
const guild = await client.guilds.fetch(guildId);
if (!guild.available) {
  throw new Error("discord_guild_unavailable");
}
```

The Discord.js `Guild` docs recommend checking guild availability before operations. Treat unavailable guilds as retryable infrastructure state, not simulation failures.

## Intents In Discord

Gateway intents tell Discord which event families to send to the app. Discord requires intents for API v8+ gateway identifies.

Standard intents do not require approval. Privileged intents must be enabled in the Developer Portal; verified apps also need approval.

Privileged intents currently include:

- `GuildPresences`
- `GuildMembers`
- `MessageContent`

Important: `MessageContent` does not represent a separate event family. It controls whether message fields such as content and attachments are populated in gateway/API data, subject to exceptions.

## Perfectman Intent Profiles

### Profile A: Write-Only MVP

Use:

```ts
[GatewayIntentBits.Guilds]
```

Capabilities:

- login,
- fetch guild,
- create/edit/fetch guild channels,
- create/fetch roles,
- send messages,
- receive basic guild/channel/role lifecycle events if listened to.

Avoid:

- `GuildMessages`,
- `MessageContent`,
- `GuildMembers`,
- `GuildPresences`.

Reason: Discord is output-only; no human or Discord message input becomes simulation truth.

### Profile B: Reaction Surface

Use:

```ts
[
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessageReactions,
]
```

Add only if the gateway ingests reaction events or emits reaction state that needs live reconciliation. Sending reactions does not necessarily require receiving reaction gateway events.

### Profile C: Discord Message Ingestion

Use:

```ts
[
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
]
```

Add only if Discord messages become input to the simulation.

Risk:

- `MessageContent` is privileged.
- Verified apps need approval.
- The runtime must define how human messages become canonical events.

### Profile D: Member/Role Reconciliation By Gateway Events

Use:

```ts
[
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
]
```

Add only if the process needs live member update events or member-list endpoints requiring the privileged intent. For a small controlled guild, fetching known bot members by ID may avoid this.

## Message Content Caveat

Without `MessageContent`, Discord will still allow the bot to see some content in special cases, such as content from its own messages, DMs with the app, messages mentioning the app, or context-menu command targets. Do not build simulation ingestion around those exceptions.

For Perfectman MVP, avoid message ingestion entirely.

## Gateway Limits

Discord's gateway send limit is separate from REST rate limits. The official gateway docs describe a limit of 120 gateway events per connection per 60 seconds. Exceeding it can disconnect the connection.

Perfectman's normal message sends are REST calls through Discord.js, not gateway sends. Gateway limits still matter for operations such as identify, heartbeat, presence updates, and other gateway-sent commands handled by the library.

## Client Events To Handle

Handle for operations:

- `ClientReady`: mark client ready.
- `Error`: log/report client error; do not throw from async event handler.
- `Warn` or debug events if operational logging needs it.
- shard events only if sharding is introduced.

Avoid for MVP simulation input:

- `messageCreate`
- `messageReactionAdd`
- `typingStart`
- `interactionCreate`

Those are not forbidden forever; they are simply outside the write-only gateway scope.

## Token And Config Shape

Do not scatter env names through code. Parse once:

```ts
type DiscordPersonaBotConfig = {
  agentId: string;
  token: string;
};

type DiscordGatewayConfig = {
  guildId: string;
  managerBotToken?: string;
  personaBots: DiscordPersonaBotConfig[];
  baseChannelCategoryId?: string;
};
```

Suggested env pattern:

```text
DISCORD_GUILD_ID=...
DISCORD_MANAGER_TOKEN=...
DISCORD_AGENT_BOTS=goulart:env:DISCORD_TOKEN_GOULART,caio:env:DISCORD_TOKEN_CAIO
```

Do not commit `.env`.

## BotRegistry Requirements

`BotRegistry` should:

- own all Discord clients,
- validate each bot reaches `ClientReady`,
- validate each bot is in the configured guild,
- expose `get(agentId)` for persona sends,
- optionally expose a manager client for channel/role mutation,
- provide shutdown cleanup,
- keep Discord-specific types behind a small interface.

Example interface:

```ts
export type DiscordBotHandle = {
  agentId: string;
  userId: string;
  send(channelId: string, content: string): Promise<string>;
  canSend(channelId: string): Promise<boolean>;
};
```

The concrete implementation can use Discord.js, while tests use fakes.

## Common Startup Failures

| Failure | Likely Cause | Handling |
| --- | --- | --- |
| Invalid token | wrong env/config | fail startup for that bot; never retry indefinitely. |
| Disallowed intents | privileged intent passed but not enabled/approved | fail startup with a specific configuration error. |
| Guild not found | bot not installed in target guild or wrong guild ID | fail startup or mark bot unavailable. |
| Missing permissions | bot lacks guild/channel permissions | produce operator warning; do not keep firing writes. |
| Ready timeout | network/gateway issue | retry with bounded backoff. |

## Verification Notes

- Source: Discord.js `Client` docs for `login`, `destroy`, `isReady`, managers, and events.
- Source: Discord Gateway docs for intent and privileged intent behavior.
- Code evidence: current repo has no Discord package or `packages/server/src/discord/` yet; this is implementation guidance.
