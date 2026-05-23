# Sub-Plan: Discord Gateway

> Optional adapter implementing `IDeliveryGateway` from [Dev2 Event Runtime Plan](./dev2-runtime.md).
> Cross-reference: [Master Contract](./master-contract.md)

> **⚠ REVIEW REQUIRED**: Every section of this sub-plan — API behavior, permission models, rate limit numbers, bot constraints, role management, and channel lifecycle — MUST be reviewed, enhanced, and double-checked against the [official Discord Developer Documentation](https://discord.com/developers/docs) before any implementation begins. This plan was drafted from general knowledge and may contain outdated, incomplete, or incorrect assumptions about Discord's API.

## Goal

Surface delivery-ready simulation output to Discord. Each agent persona has its own Discord bot. The gateway is write-only — it sends messages and manages guild channels/roles. No simulation logic, event validation, visibility computation, or event-log mutation lives here.

## Architecture

```text
DeliveryProjection (dev2)
  → delivery-ready messages/feed items
  → IDeliveryGateway
  → DiscordGateway
      → BotRegistry (one bot client per persona)
      → ChannelMap (simulation channelId → Discord channelId + roleId)
      → RoleManager (creates/assigns/revokes Discord roles for private channels)
      → RateLimiter (per-bot message queue with backoff)
```

## Key Constraints

- **Write-only**: bots only send messages. No incoming Discord event listeners.
- **Surface-only**: receives already-projected output from `DeliveryProjection`; never receives authority to decide canonical facts.
- **One bot per persona**: each agent has its own Discord bot token. Messages appear as that persona in the guild.
- **Simulation control is server-side**: no slash commands. Operator uses HTTP API or CLI.
- **Private channels are real Discord channels** with role-based permissions — not threads.

## Guild Channel Model

```text
#general               # public simulation channel (all agent bots can post)
#{channelId}           # one private Discord channel per private simulation channel
#spectator             # spectator narrative feed
#operator              # operator debug/metrics (no agent bots)
```

Private channel lifecycle:
1. `channel_created` event committed → `RoleManager.createPrivateChannel(channelId, memberAgentIds)`
2. Creates Discord channel + dedicated role
3. Assigns role to member bots → they can see and post
4. Non-member bots have no role → channel is invisible to them
5. `agent_invited` → `RoleManager.addMember(channelId, agentId)`
6. `agent_left` → `RoleManager.removeMember(channelId, agentId)`
7. `onSimulationStopped` → locks all channels (removes agent bot write permissions)

Required Discord bot permissions: `MANAGE_CHANNELS`, `MANAGE_ROLES`, `SEND_MESSAGES`.

## IDeliveryGateway Implementation

```typescript
class DiscordGateway implements IDeliveryGateway {
  async sendAgentMessage(channelId: string, message: DeliveryMessage): Promise<void> {
    const bot = this.botRegistry.get(message.agentId);
    const discordChannelId = this.channelMap.getDiscordChannelId(channelId);
    await this.rateLimiter.enqueue(message.agentId, discordChannelId, message.content);
  }

  async createChannel(channelId: string, type: ChannelType, memberAgentIds: string[]): Promise<void> {
    if (type === 'private_channel') {
      await this.roleManager.createPrivateChannel(channelId, memberAgentIds);
    }
    // public channels are pre-created at simulation init
  }

  async addMember(channelId: string, agentId: string): Promise<void> {
    await this.roleManager.addMember(channelId, agentId);
  }

  async removeMember(channelId: string, agentId: string): Promise<void> {
    await this.roleManager.removeMember(channelId, agentId);
  }

  async sendSpectatorEvent(event: SpectatorEvent): Promise<void> {
    await this.rateLimiter.enqueue('spectator', this.channelMap.spectatorChannelId, format(event));
  }

  async sendOperatorEvent(event: OperatorEvent): Promise<void> {
    // operator channel bypasses rate limiter — operator events are low volume
    const channel = await this.guild.channels.fetch(this.channelMap.operatorChannelId);
    await channel.send(format(event));
  }

  async onSimulationStopped(simulationId: string): Promise<void> {
    await this.roleManager.lockAllChannels();
  }
}
```

## Rate Limiter

Discord enforces ~5 messages/5s per channel. The rate limiter is per-bot, per-channel.

Behavior:
- Messages are queued per (botId, channelId)
- Flushes at safe intervals with exponential backoff on 429 responses
- High-salience events (`critical`, `high`) are never dropped
- Low-salience events (`low`) are dropped if queue depth exceeds threshold
- `medium` events are batched if multiple arrive in the same flush window

## Files To Create

```
packages/server/src/discord/
  discord-gateway.ts        # IDeliveryGateway implementation, composition root
  bot-registry.ts           # loads N bot clients from config (one token per persona)
  discord-auth.ts           # validates bot tokens, confirms guild membership
  channel-map.ts            # simulation channelId → Discord channelId + roleId
  role-manager.ts           # creates/assigns/revokes Discord roles for private channels
  discord-rate-limiter.ts   # per-bot per-channel message queue with backoff
  discord-formatter.ts      # CommittedEvent / SpectatorEvent / OperatorEvent → Discord message string
  __tests__/
    discord-gateway.test.ts       # mock Discord.js client
    role-manager.test.ts
    discord-rate-limiter.test.ts  # stress test: high-salience never dropped, low-salience dropped under load
```

## Milestones

### DG-M1: Bot Registry + Auth
- Load one bot client per persona from env config (`DISCORD_TOKEN_GOULART`, etc.)
- Validate each token, confirm guild membership
- `BotRegistry.get(agentId)` returns correct client

### DG-M2: Channel Map + Guild Init
- Create `#general`, `#spectator`, `#operator` on simulation init
- `ChannelMap` maps simulation channel IDs to Discord channel IDs

### DG-M3: Role Manager
- Create private Discord channel + role on `createChannel()` call
- Assign/revoke roles on `addMember()` / `removeMember()`
- Lock all channels on `onSimulationStopped()`

### DG-M4: Rate Limiter
- Per-bot per-channel queue
- Salience-based drop policy
- Exponential backoff on Discord 429

### DG-M5: Formatter + Integration
- `discord-formatter.ts`: event → human-readable Discord message
- Wire `DiscordGateway` as the `IDeliveryGateway` in `SimulationRuntime`
- End-to-end: committed event appears as bot message in correct Discord channel

## Done Criteria

- Each agent's messages appear from its own Discord bot in the correct channel
- Private channels are invisible to non-member bots at the Discord permission level
- Spectator narrative arrives in `#spectator`, operator events in `#operator`
- Rate limiter never triggers Discord 429 under normal pulse load
- High-salience events are never dropped by the rate limiter
- `onSimulationStopped` locks all channels correctly
- All tests use a mock Discord.js client — no real API calls in CI
