# Developer 2 Plan: Event Runtime / WebSocket Adapter

> Cross-reference: [Master Contract](./master-contract.md) for all shared types, ownership boundaries, and integration flow.

## Goal

Build the event-oriented simulation runtime: host simulations, manage channels/membership, commit accepted facts to the canonical event log, derive projections for engine/spectator/operator/socket consumers, and expose WebSocket as the realtime adapter over those projections.

## Architecture

```text
SimulationRuntime
  → EventLog (canonical source of truth)
  → ChannelRegistry
  → CommandHandlers
  → IntentResolver
      → validates ActionIntent
      → converts accepted intents into CommittedEvents
      → appends only committed facts to EventLog
  → PulseScheduler
      → reads committed events
      → builds EngineSnapshotProjection
      → calls dev3 RunEngineStep (pure)
      → builds AgentRuntimeInput
      → calls dev1 AgentRuntime.generateIntent
      → sends returned ActionIntent to IntentResolver
  → Projections
      → SocketProjection (Socket.IO rooms, replay, client delivery)
      → SpectatorProjection (MVP rule-based narrative)
      → OperatorProjection (debug, metrics, failures)
      → EngineSnapshotProjection (event-log view for dev3 engine)
```

**Core rule:** WebSocket is an adapter, not the architecture. The event log is the simulation's durable social reality. Every consumer sees a projection of committed events.

```text
Command | Agent Intent
  → IntentResolver
  → CommittedEvent[]
  → EventLog.append()
  → Projections
  → Socket.IO / spectator / operator / engine snapshots
```

## Ownership Boundary

**Own:**
- `packages/server/src/simulation/` — event-oriented runtime, lifecycle, channel registry, event log, command handlers, pulse scheduler, intent resolver, projections, rate limit gate, runtime input builder, in-memory stores
- `packages/server/src/socket/` — Socket.IO gateway only: rooms, client commands, subscriptions, replay cursor, projection delivery

**Import from dev3 (do not duplicate):**
- `Simulation`, `SimulationStatus`, `SimulationSettings` — simulation types
- `Channel`, `ChannelType`, `ChannelMembership` — channel types
- `SimulationEvent`, `CommittedEvent`, `EventVisibility` — event types
- `AgentState`, `PersonaConfig` — agent state and Dev3 engine calibration types
- `EngineSnapshot`, `EngineStepResult` — engine contract types
- `AgentRuntimeInput` — runtime input type (dev2 builds instances)
- `ActionIntent` — intent type
- `SpectatorEvent`, `OperatorEvent` — feed types
- `AvailableAction`, `RateLimitStatus` — action types
- `WorldSignals`, `SeededRng` — engine input helpers
- `validateIntentPure()` — from `@perfectman/engine`
- `computeAvailableActions()` — from `@perfectman/engine`
- `filterVisibleEvents()` — from `@perfectman/engine`
- Repository interfaces — from `packages/server/src/persistence/repositories.ts` (dev3)

**Consume from dev1 (at runtime):**
- `AgentRuntime.generateIntent(input: AgentRuntimeInput): Promise<AgentRuntimeOutput>`
- `LlmBudget.canCall()`, `.recordUsage()`, `.getStatus()`, `.getPriority()`
- Mock provider for scheduler integration tests

**Provide to dev1:**
- Event runtime scheduler invocation point calling `AgentRuntime.generateIntent`
- Operator event sink
- Simulation settings / budget config
- `RateLimitStatus` per agent (for available action computation)

**Provide to dev3:**
- Event log append/replay behavior (implementing dev3 repository interfaces)
- Channel membership runtime state
- Event projection behavior for engine snapshots
- `RateLimitStatus` computation
- `WorldSignals` computation
- `dt` computation
- Seeded RNG creation per pulse

## Files To Create

```
packages/server/src/socket/
  socket-gateway.ts             # WebSocket adapter over event projections
  socket-events.ts              # client↔server event name constants
  socket-auth.ts
  room-names.ts                 # room name helpers
  replay-cursor.ts
  __tests__/
    socket-gateway.test.ts
    replay-cursor.test.ts

packages/server/src/simulation/
  simulation-runtime.ts         # event-oriented composition root
  simulation-manager.ts
  simulation-lifecycle.ts
  channel-registry.ts
  event-log.ts                  # implements dev3 IEventRepository interface
  command-handlers.ts           # converts client/operator commands into resolver inputs
  pulse-scheduler.ts
  runtime-input-builder.ts      # assembles AgentRuntimeInput from EngineStepResult
  intent-resolver.ts            # stateful resolver, calls dev3 validateIntentPure
  rate-limit-gate.ts            # stateful tracking, provides RateLimitStatus
  world-signals-builder.ts      # computes WorldSignals from event log + agent states
  projections/
    socket-projection.ts        # committed events → socket room payloads
    spectator-projection.ts     # committed events → spectator narrative events
    operator-projection.ts      # committed events + metrics → operator events
    engine-snapshot-projection.ts # event log + state → EngineSnapshot
  in-memory-stores.ts           # implements dev3 repository interfaces for MVP
  scheduler-contracts.ts        # injected adapters for engine/runtime/resolver
  __tests__/
    channel-registry.test.ts
    event-log.test.ts
    command-handlers.test.ts
    simulation-lifecycle.test.ts
    pulse-scheduler.test.ts
    intent-resolver.test.ts
    runtime-input-builder.test.ts
    world-signals-builder.test.ts
    socket-projection.test.ts
    spectator-projection.test.ts
    operator-projection.test.ts
    engine-snapshot-projection.test.ts
```

**NOT created by dev2 (resolved overlap):**
- ~~`visibility-router.ts`~~ → use `filterVisibleEvents` from `@perfectman/engine`
- ~~`broadcast-router.ts` as architecture center~~ → use event projections; Socket.IO subscribes to `SocketProjection`
- ~~persistence store interfaces~~ → import from dev3 `packages/server/src/persistence/repositories.ts`

## Event-Oriented Runtime Rules

Use three different concepts clearly:

- **Command**: a request to do something, usually from a human/operator/socket client. Examples: `simulation:start`, `operator:inject_event`, `channel:join`.
- **Intent**: an agent's proposed action. Examples: `send_message`, `create_channel`, `delay_response`, `no_op`.
- **Event**: an accepted fact that happened in the simulation. Examples: `message_sent`, `channel_created`, `intent_blocked`, `no_op_recorded`.

Only events are appended to the event log.

Commands and intents may be rejected, delayed, transformed, or committed. Once committed, events are immutable facts and all views derive from them.

## Projection Model

The event log is the write model. Every reader receives a projection:

- `EngineSnapshotProjection`: builds `EngineSnapshot` from committed events, channel membership, agent state, rate limits, `dt`, and seeded RNG.
- `SocketProjection`: converts committed events into role-filtered Socket.IO payloads and room emissions.
- `SpectatorProjection`: converts committed events into public/narrative spectator-safe events.
- `OperatorProjection`: converts committed events, blocked intents, failures, rate limits, and scheduler metrics into operator events.

Projection invariants:
- Projections never create canonical facts by themselves.
- Projections may suppress, sanitize, or reshape fields for their audience.
- Projection bugs must not mutate the event log.
- Reconnect/replay uses the event log plus the same projection rules.

## Pulse Scheduler Detail

```typescript
async function runPulse(ctx: PulseContext): Promise<PulseResult> {
  const dt = (Date.now() - ctx.lastPulseTimestamp) / 1000;
  const rng = createSeededRng(ctx.simulationSeed + ctx.pulseIndex);

  // 1. Read new committed events since last pulse
  const newEvents = await ctx.eventRepo.getAfter(ctx.simulationId, ctx.lastEventId);

  // 2. Per agent: build EngineSnapshot projection, run engine step
  for (const agent of ctx.agents) {
    const rateLimitStatus = ctx.rateLimitGate.getStatus(agent.id);
    const worldSignals = buildWorldSignals(ctx.eventLog, ctx.agentStates, agent.id);

    const snapshot = ctx.engineSnapshotProjection.build({
      pulseIndex: ctx.pulseIndex,
      simulation: ctx.simulation,
      committedEvents: newEvents,
      agent,
      channels: ctx.channels,
      membership: ctx.membership,
      worldSignals,
      rateLimitStatus,
      dt,
      rng,
    });

    const stepResult = runEngineStep(snapshot);  // dev3 pure function

    // 3. If needsLLM or initiative.proceed → call agent runtime
    if (stepResult.decision.needsLLM || stepResult.decision.initiativeProceed) {
      const budgetPriority = ctx.llmBudget.getPriority(ctx.simulationId, agent.id);
      const runtimeInput = buildAgentRuntimeInput(stepResult, agent.persona, budgetPriority);
      const runtimeOutput = await ctx.agentRuntime.generateIntent(runtimeInput);

      // 4. Resolve intent
      const resolved = ctx.intentResolver.resolve(runtimeOutput.intent, agent, ctx);

      // 5. Commit accepted facts to the canonical event log
      if (resolved.committedEvents.length > 0) {
        await ctx.eventRepo.append(ctx.simulationId, resolved.committedEvents);
      }

      // 6. Project committed events to socket/spectator/operator consumers
      for (const event of resolved.committedEvents) {
        ctx.socketProjection.project(event, ctx.channels, ctx.membership, ctx.settings);
        ctx.spectatorProjection.project(event, ctx.settings);
        ctx.operatorProjection.project(event, ctx.settings);
      }

      // Emit operator events
      for (const opEvent of [...resolved.operatorEvents, ...runtimeOutput.operatorEvents]) {
        ctx.operatorProjection.emit(opEvent);
      }
    }

    // Update agent state from engine
    await ctx.agentStateRepo.update(agent.id, stepResult.updatedAgentState);
  }

  // 7. Every 10 pulses: stagnation detection (dev3 engine function)
  // 8. Check recap triggers (post-MVP)

  return { pulseIndex: ctx.pulseIndex, eventsCommitted, agentsCalled };
}
```

## RuntimeInputBuilder Detail

```typescript
function buildAgentRuntimeInput(
  stepResult: EngineStepResult,
  persona: PersonaConfig,
  budgetPriority: BudgetPriority
): AgentRuntimeInput {
  return {
    simulationId: stepResult.updatedAgentState.simulationId,
    agentId: stepResult.updatedAgentState.agentId,
    personaConfig: persona, // Dev3 engine calibration; Dev1 resolves prompt profile/config
    perceptionPacket: stepResult.perceptionPacket,
    emotionalState: {
      coreMood: stepResult.updatedAgentState.coreMood,
      socialEmotions: stepResult.updatedAgentState.socialEmotions,
      relationalStates: stepResult.updatedAgentState.relationalStates,
    },
    activeMotivations: stepResult.motivations,
    activePressures: stepResult.pressures,
    activeInhibitions: stepResult.inhibitions,
    relevantMemories: stepResult.perceptionPacket.relevantMemories,
    availableActions: stepResult.availableActions,
    budgetPriority,
    triggeringReason: stepResult.attentionResults.triggeringReason,
  };
}
```

## IntentResolver Detail

```typescript
class IntentResolver {
  resolve(intent: ActionIntent, agent: AgentContext, ctx: PulseContext): ResolvedIntent {
    // 1. Pure validation (dev3 engine)
    const validation = validateIntentPure(intent, ctx.availableActions, agent.state, ctx.settings);
    if (!validation.valid) {
      return this.block(intent, validation.violations);
    }

    // 2. Channel membership check (dev2 state)
    if (intent.channelTarget && !ctx.channelRegistry.isMember(agent.id, intent.channelTarget)) {
      if (intent.intentType !== 'create_channel') {
        return this.block(intent, [{ type: 'not_member' }]);
      }
    }

    // 3. Rate limit check (dev2 state)
    if (!ctx.rateLimitGate.allowAction(agent.id, intent.intentType)) {
      return this.block(intent, [{ type: 'rate_limited' }]);
    }

    // 4. Handle delay preference
    if (intent.preferredDelay && intent.preferredDelay > 0) {
      return this.delay(intent, ctx.pulseIndex + Math.ceil(intent.preferredDelay / ctx.pulseIntervalMs));
    }

    // 5. Commit: convert intent → SimulationEvent[]
    const events = this.intentToEvents(intent, ctx);
    return { outcome: 'committed', committedEvents: events, operatorEvents: [] };
  }
}
```

## WorldSignalsBuilder Detail

```typescript
function buildWorldSignals(
  recentEvents: CommittedEvent[],
  agentStates: Map<string, AgentState>,
  currentAgentId: string,
  channelId: string
): WorldSignals {
  const channelAgents = /* agents in same channel */;
  return {
    highArousalNearby: channelAgents.some(a => a.coreMood.arousal > 0.7),
    averageChannelArousal: mean(channelAgents.map(a => a.coreMood.arousal)),
    activeAgentCount: [...agentStates.values()].filter(a => a.presence !== 'offline').length,
    timeSinceLastPublicMessage: /* seconds since last message_sent in public channel */,
    channelMessageRatePerMinute: /* count of message events in last 60s */,
    recentTopicShift: false, // MVP: always false, post-MVP: LLM detection
  };
}
```

## SpectatorProjection (MVP)

MVP rule-based event projection — no LLM:

```typescript
function buildSpectatorEvent(event: CommittedEvent, context: SpectatorContext): SpectatorEvent | null {
  switch (event.type) {
    case 'message_sent':
    case 'reply_sent':
    case 'reaction_sent':
      return { ...sanitize(event), narrativeHint: null };
    case 'no_op_recorded':
      return { type: 'spectator_hint', hint: sanitizeMotiveSummary(event.payload.privateMotiveSummary) };
    case 'channel_created':
      return { ...sanitize(event), narrativeHint: `New private space created` };
    case 'private_motive_summary':
      return { type: 'motive_reveal', summary: event.payload.summary, agentId: event.actorId };
    default:
      return context.settings.omniscientSpectatorMode ? sanitize(event) : null;
  }
}
```

Post-MVP: Opus-based narrative generation becomes dev1 scope.

## SocketGateway API

Client commands entering the event runtime: `simulation:create`, `simulation:start`, `simulation:pause`, `simulation:resume`, `simulation:stop`, `simulation:join_as_spectator`, `simulation:join_as_operator`, `channel:join`, `channel:leave`, `operator:inject_event`, `operator:set_setting`, `client:resume_from_cursor`

Server projections leaving through Socket.IO: `simulation:created`, `simulation:status_changed`, `channel:created`, `channel:membership_changed`, `event:committed`, `spectator:event`, `operator:event`, `operator:metrics`, `error`

## Room Model

```text
simulation:{simulationId}:public:{channelId}
simulation:{simulationId}:private:{channelId}
simulation:{simulationId}:spectator
simulation:{simulationId}:operator
```

## SocketProjection

Uses dev3 `filterVisibleEvents()` for agent visibility, then emits through `SocketGateway` rooms:

- **Agent**: public channels + private channels where member + own events. Never: other agents' motive summaries, spectator narration, operator events, raw scores
- **Spectator**: public chat + narrative events + recaps + motive summaries + private channels only if policy allows
- **Operator**: full event stream + visibility decisions + blocked intents + rate limits + LLM failures + scheduler health + budget metrics

## Simulation Lifecycle

Statuses: `initializing` → `running` → `paused` ↔ `running` → `stopped`

- **initializing**: create sim, socket namespace, default #geral, register 5 agents, init event log, accept spectator/operator subscriptions, no scheduler yet
- **running**: start scheduler, accept commits, append events, project events to subscribers, allow operator pause/stop
- **paused**: stop scheduler, keep sockets, allow operator inspection, reject/queue commits, commit/project pause event
- **stopped**: stop scheduler, close namespace, persist final status, commit/project final event, prevent commits

## In-Memory Stores

Implement dev3 repository interfaces (`IEventRepository`, `IAgentStateRepository`, `IMemoryRepository`, `ISimulationRepository`, `IChannelRepository`) with in-memory Maps/arrays for MVP. SQLite implementations (dev3) replace them behind same interface.

## Rate Limit Gate

Stateful tracking per agent:

```typescript
class RateLimitGate {
  getStatus(agentId: string): RateLimitStatus;
  allowAction(agentId: string, intentType: IntentType): boolean;
  recordAction(agentId: string, intentType: IntentType): void;
}
```

Provides `RateLimitStatus` to dev3 engine via `EngineSnapshot.rateLimitStatus`.

## Implementation Milestones

### M1: Simulation + Channel Stores
- Implement dev3 `ISimulationRepository` and `IChannelRepository` in-memory
- Channel registry: public/private creation, membership, archive

### M2: Event Log
- Implement dev3 `IEventRepository` in-memory
- Append-only, monotonic IDs, `getAfter`, `getCommittedThrough`, replay

### M3: Event Runtime + Command Handlers
- `SimulationRuntime` composition root
- Command handlers for simulation lifecycle, operator injection, channel subscription, and replay requests
- Commands produce resolver inputs or lifecycle transitions; commands do not directly mutate the event log except through the runtime's commit path

### M4: SocketGateway + Rooms
- Socket.IO wrapper, room name helpers, namespace mapping
- Spectator/operator/agent subscriptions
- Channel join/leave as subscription commands
- SocketGateway receives commands and emits projections only

### M5: Projections
- `EngineSnapshotProjection` builds `EngineSnapshot`
- `SocketProjection` uses `filterVisibleEvents` from `@perfectman/engine`
- `SpectatorProjection` produces MVP narrative events
- `OperatorProjection` produces debug/metrics/failure events
- P0 tests: private events to members only, motive summaries never to other agents

### M6: Simulation Lifecycle
- Create, start, pause, resume, stop
- Status events broadcast

### M7: Intent Resolver + Rate Limit Gate
- Stateful resolver calling dev3 `validateIntentPure`
- Rate limit tracking providing `RateLimitStatus`
- Intent → CommittedEvent conversion

### M8: RuntimeInputBuilder + WorldSignalsBuilder
- Assembly of `AgentRuntimeInput` from `EngineStepResult`
- Computation of `WorldSignals` from event log + agent states

### M9: Pulse Scheduler
- Interval runner with injected clock
- Build `EngineSnapshot` (compute dt, create rng, gather state, compute WorldSignals, get RateLimitStatus)
- Call dev3 engine → dev2 runtime-input-builder → dev1 agent runtime → dev2 intent resolver
- Append committed events → run projections → emit operator metrics

### M10: Reconnect/Replay
- Client cursor tracking, replay visible events only

## Verification

```bash
pnpm --filter @perfectman/server test -- --grep "socket|simulation"
pnpm build
```

## MVP Done Criteria

- Simulation can be created, started, paused, resumed, stopped
- Default public channel exists
- Private channels can be created with membership
- Event log is the canonical append-only source of truth
- Commands and intents only affect the world through committed events
- Public event projections reach all allowed agents and spectators
- Private event projections reach only member agents and allowed spectators
- Operator projection receives full debug stream
- WebSocket stays an adapter over projections, not the simulation core
- Scheduler lives in server, not engine
- Scheduler can run with mock engine, mock runtime, and mock resolver
- Intent resolver calls dev3 pure validation + dev2 stateful checks
- RuntimeInputBuilder correctly maps EngineStepResult → AgentRuntimeInput
- WorldSignals computed and passed to engine
- EngineSnapshotProjection derives snapshots from committed events and state
- Visibility invariants have automated tests
