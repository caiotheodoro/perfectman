# Developer 2 Plan: Event Runtime

> Cross-reference: [Master Contract](./master-contract.md) for all shared types, ownership boundaries, and integration flow.
> Delivery contract: agnostic `IDeliveryGateway`; concrete delivery implementations only surface projected information.

## Goal

Build the event-oriented simulation runtime: host simulations, manage channels/membership, commit accepted facts to the canonical event log, and derive projections for engine/spectator/operator/delivery consumers. Delivery is a separate output boundary: an injected `IDeliveryGateway` surfaces already-projected information to an external or test-facing surface.

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
      → DeliveryProjection (committed events → surface-ready delivery output)
      → SpectatorProjection (MVP rule-based narrative)
      → OperatorProjection (debug, metrics, failures)
      → EngineSnapshotProjection (event-log view for dev3 engine)
```

**Core rule:** The event runtime and delivery gateway have different jobs. The event runtime owns canonical state changes; the delivery gateway only surfaces projected information. The event log is the simulation's durable social reality. Every consumer sees a projection of committed events.

```text
Command | Agent Intent
  → IntentResolver
  → CommittedEvent[]
  → EventLog.append()
  → Projections
  → EngineSnapshotProjection / SpectatorProjection / OperatorProjection / DeliveryProjection
  → IDeliveryGateway surfaces delivery projection output
```

## Runtime vs Delivery Gateway

Use these responsibilities consistently:

- **Event runtime**: owns simulation lifecycle, channel registry, event log, command handling, intent resolution, pulse scheduling, state updates, and projection execution.
- **Projection layer**: derives audience-specific views from committed events. It may filter, sanitize, reshape, or suppress information, but it never creates canonical facts.
- **Delivery gateway**: surfaces projected information to a concrete interface such as Discord, WebSocket, stdout, or `MockDeliveryGateway`. It does not validate intents, mutate simulation state, compute visibility, run engine logic, or decide what is true.

Delivery adapters may have platform-specific concerns such as rate limits, formatting, channel IDs, reconnect cursors, bot identity, or test capture. Those concerns stay behind `IDeliveryGateway` and must not leak back into event runtime contracts.

## Ownership Boundary

**Own:**
- `packages/server/src/simulation/` — event-oriented runtime, lifecycle, channel registry, event log, command handlers, pulse scheduler, intent resolver, projections, rate limit gate, runtime input builder, in-memory stores
- `IDeliveryGateway` interface — defined in `scheduler-contracts.ts`; MVP runtime tests use `MockDeliveryGateway`, and concrete surface adapters may be added independently

**Import from dev3 (do not duplicate):**
- `Simulation`, `SimulationStatus`, `SimulationSettings` — simulation types
- `Channel`, `ChannelType`, `ChannelMembership` — channel types
- `SimulationEvent`, `CommittedEvent`, `EventVisibility` — event types
- `AgentState`, `PersonaConfig` — agent types
- `EngineSnapshot`, `EngineStepResult` — engine contract types
- `AgentRuntimeInput` — runtime input type (dev2 builds instances)
- `ActionIntent` — intent type
- `SpectatorEvent`, `OperatorEvent` — feed types
- `AvailableAction`, `RateLimitStatus` — action types
- `WorldSignals`, `SeededRng` — engine input helpers
- `validateIntentPure()` — from `@perfectman/engine`
- `computeAvailableActions()` — from `@perfectman/engine`
- `computeStagnationMetrics()` — from `@perfectman/engine`
- `filterVisibleEventsForAgent()` — from `@perfectman/engine`
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
packages/server/src/simulation/
  simulation-runtime.ts         # event-oriented composition root
  simulation-manager.ts
  simulation-lifecycle.ts
  channel-registry.ts
  event-log.ts                  # implements dev3 IEventRepository interface
  command-handlers.ts           # converts operator commands into resolver inputs
  pulse-scheduler.ts
  runtime-input-builder.ts      # assembles AgentRuntimeInput from EngineStepResult
  engine-event-builder.ts       # EngineStepResult memory/no-op/stagnation outputs → committed events
  intent-resolver.ts            # stateful resolver, calls dev3 validateIntentPure
  rate-limit-gate.ts            # stateful tracking, provides RateLimitStatus
  world-signals-builder.ts      # computes WorldSignals from event log + agent states
  projections/
    delivery-projection.ts      # committed events → IDeliveryGateway calls (role-filtered)
    spectator-projection.ts     # committed events → spectator narrative events
    operator-projection.ts      # committed events + metrics → operator events
    engine-snapshot-projection.ts # event log + state → EngineSnapshot
  in-memory-stores.ts           # implements dev3 repository interfaces for MVP
  scheduler-contracts.ts        # IDeliveryGateway + injected engine/runtime/resolver dependencies
  __tests__/
    channel-registry.test.ts
    event-log.test.ts
    command-handlers.test.ts
    simulation-lifecycle.test.ts
    pulse-scheduler.test.ts
    intent-resolver.test.ts
    runtime-input-builder.test.ts
    world-signals-builder.test.ts
    delivery-projection.test.ts
    spectator-projection.test.ts
    operator-projection.test.ts
    engine-snapshot-projection.test.ts
```

**NOT created by dev2 (resolved overlap):**
- ~~`visibility-router.ts`~~ → use `filterVisibleEventsForAgent` from `@perfectman/engine`
- ~~`broadcast-router.ts` as architecture center~~ → use event projections; delivery gateway receives only `DeliveryProjection` output
- ~~persistence store interfaces~~ → import from dev3 `packages/server/src/persistence/repositories.ts`
- ~~`replay-cursor.ts`~~ → delivery surface concern; not part of the runtime core
- ~~any delivery-specific adapter files~~ → adapter concern; not part of the runtime core

## IDeliveryGateway Interface

Defined in `scheduler-contracts.ts`. All surfaced-output adapters implement this interface.

```typescript
type DeliveryMessage =
  | { kind: 'message'; agentId: string; content: string; salience: EmotionalSalience }
  | { kind: 'reply'; agentId: string; content: string; replyToEventId: string; salience: EmotionalSalience }
  | { kind: 'reaction'; agentId: string; emoji: string; targetEventId: string; salience: EmotionalSalience };

type IDeliveryGateway = {
  sendAgentMessage(channelId: string, message: DeliveryMessage): Promise<void>;
  createChannel(channelId: string, type: ChannelType, memberAgentIds: string[]): Promise<void>;
  addMember(channelId: string, agentId: string): Promise<void>;
  removeMember(channelId: string, agentId: string): Promise<void>;
  sendSpectatorEvent(event: SpectatorEvent): Promise<void>;
  sendOperatorEvent(event: OperatorEvent): Promise<void>;
  onSimulationStopped(simulationId: string): Promise<void>;
};
```

`DeliveryProjection` calls `IDeliveryGateway` methods after applying `filterVisibleEventsForAgent` and reshaping events into delivery messages or feed items. The gateway receives surface-ready information; it does not receive authority to mutate the event log or re-run visibility decisions. The runtime never knows whether the backing implementation is Discord, WebSocket, stdout, a test mock, or another adapter.

Delivery fan-out:
- `message_sent` → `sendAgentMessage(channelId, { kind: 'message', ... })`
- `reply_sent` → `sendAgentMessage(channelId, { kind: 'reply', replyToEventId, ... })`
- `reaction_sent` → `sendAgentMessage(channelId, { kind: 'reaction', emoji, targetEventId, ... })`
- `channel_created`, `agent_invited`, `agent_left` → `createChannel`, `addMember`, `removeMember`
- spectator/operator events → `sendSpectatorEvent`, `sendOperatorEvent`

## Event-Oriented Runtime Rules

Use three different concepts clearly:

- **Command**: a request to do something, from an operator or external control surface. Examples: `simulation:start`, `operator:inject_event`, `channel:join`.
- **Intent**: an agent's proposed action. Examples: `send_message`, `create_channel`, `delay_response`, `no_op`.
- **Event**: an accepted fact committed by the resolver/runtime. Examples: `message_sent`, `channel_created`, `intent_blocked`, `no_op_recorded`.

Only events are appended to the event log.

Commands and intents may be rejected, delayed, transformed, or committed. Once committed, events are immutable facts and all views derive from them.

## Projection Model

The event log is the write model. Every reader receives a projection:

- `EngineSnapshotProjection`: builds `EngineSnapshot` from committed events, channel membership, agent state, rate limits, `dt`, and seeded RNG.
- `DeliveryProjection`: applies `filterVisibleEventsForAgent`, reshapes committed events into surface-ready messages/feed items, then calls `IDeliveryGateway`. Delivery surface is fully swappable.
- `SpectatorProjection`: converts committed events into public/narrative spectator-safe events.
- `OperatorProjection`: converts committed events, blocked intents, failures, rate limits, and scheduler metrics into operator events.

Projection invariants:
- Projections never create canonical facts by themselves.
- Projections may suppress, sanitize, or reshape fields for their audience.
- Projection bugs must not mutate the event log.
- Replay uses the event log plus the same projection rules.

## Engine-Emitted Event Builder

`runEngineStep()` returns deterministic outputs even when `decision.needsLLM === false`. Dev2 must commit those outputs, when present, before deciding whether to call the LLM:

- `memoryProposals[]` → one `memory_written` event per proposal when present; current dev3 engine returns `[]` and dev1/parser work may populate proposals later
- `noOpRecord` → one `no_op_recorded` event when present
- `stagnation_detected` → committed from periodic `computeStagnationMetrics()` when thresholds trip

These events are not resolver-emitted intents. `intent_delayed` and `intent_blocked` remain on the LLM/IntentResolver path.

### Emotional Salience Sources

- Engine-emitted events: salience comes from emotion delta magnitude or stagnation severity.
- Resolver-emitted events: MVP resolver derives salience locally from `actionEmotions` + intent type.
- Lifecycle events: fixed `low` salience unless an operator explicitly overrides it.

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
    const agentState = ctx.agentStates.get(agent.id) ?? agent.state;
    const visibleEvents = filterVisibleEventsForAgent(newEvents, agentState.agentId, ctx.channels, ctx.membership);
    const channelAnchorId = ctx.currentChannelIdByAgent.get(agent.id) ?? ctx.defaultPublicChannelId;
    const worldSignals = buildWorldSignals(visibleEvents, ctx.agentStates, agent.id, channelAnchorId);

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

    // 3. Commit deterministic engine-emitted facts before any LLM decision.
    // no_op_recorded is produced when noOpRecord is present; memory_written is produced when proposals exist.
    const engineEvents = ctx.engineEventBuilder.fromStepResult(stepResult, {
      simulationId: ctx.simulationId,
      agentId: agent.id,
      channelId: channelAnchorId,
    });
    if (engineEvents.length > 0) {
      await ctx.eventRepo.append(ctx.simulationId, engineEvents);
      projectAll(engineEvents, ctx);
    }

    // 4. If needsLLM or initiative.proceed → call agent runtime
    if (stepResult.decision.needsLLM || stepResult.decision.initiativeProceed) {
      const budgetPriority = ctx.llmBudget.getPriority(ctx.simulationId, agent.id);
      const runtimeInput = buildAgentRuntimeInput(stepResult, agent.persona, budgetPriority);
      const runtimeOutput = await ctx.agentRuntime.generateIntent(runtimeInput);

      // 5. Resolve intent
      const resolved = ctx.intentResolver.resolve(runtimeOutput.intent, agent, ctx);

      // 6. Commit accepted facts to the canonical event log
      if (resolved.committedEvents.length > 0) {
        await ctx.eventRepo.append(ctx.simulationId, resolved.committedEvents);
      }

      // 7. Project committed events to delivery/spectator/operator consumers
      for (const event of resolved.committedEvents) {
        ctx.deliveryProjection.project(event, ctx.channels, ctx.membership, ctx.settings);
        ctx.spectatorProjection.project(event, ctx.settings);
        ctx.operatorProjection.project(event, ctx.settings);
      }

      // Emit operator events
      for (const opEvent of [...resolved.operatorEvents, ...runtimeOutput.operatorEvents]) {
        ctx.operatorProjection.emit(opEvent);
      }
    }

    // Update agent state from engine; runEngineStep already advances lastProcessedEventId.
    await ctx.agentStateRepo.update(agent.id, stepResult.updatedAgentState);
  }

  // 8. Every 10 pulses: computeStagnationMetrics(event slice) and commit stagnation_detected when thresholds trip.
  // 9. Check recap triggers (post-MVP)

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
    personaConfig: persona,
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
      return this.delay(intent, ctx.pulseIndex + Math.ceil(intent.preferredDelay / ctx.settings.pulseIntervalMs));
    }

    // 5. Commit: convert intent → SimulationEvent[]
    // Resolver-emitted events derive emotionalSalience from actionEmotions + intent type.
    // Current MVP uses a local resolver helper.
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
  const channelAgents = /* agents in focus channel */;
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

`WorldSignals` intentionally mixes global fields (`activeAgentCount`, `timeSinceLastPublicMessage`) and channel-scoped fields (`averageChannelArousal`, `channelMessageRatePerMinute`). Dev2 passes an explicit channel anchor from scheduler context, falling back to `defaultPublicChannelId`.

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
    case 'intent_delayed':
      return { type: 'spectator_hint', hint: summarizeDelay(event) };
    case 'intent_blocked':
      return { type: 'spectator_hint', hint: summarizeBlockedIntent(event) };
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

## Concrete Gateway APIs

Concrete surface APIs belong behind `IDeliveryGateway`, not inside the event runtime. Discord-specific gateway details live in [Discord Gateway Plan](./discord-gateway.md). A future WebSocket adapter should follow the same rule: client commands enter as runtime commands, and server output leaves only as already-filtered delivery, spectator, or operator projections.

## Simulation Lifecycle

Statuses: `initializing` → `running` → `paused` ↔ `running` → `stopped`

- **initializing**: create sim, init channel registry, init event log, call `IDeliveryGateway.createChannel` for default public channel, no scheduler yet
- **running**: start scheduler, accept commits, append events, project events through `DeliveryProjection`
- **paused**: stop scheduler, reject/queue commits, commit/project pause event
- **stopped**: stop scheduler, call `IDeliveryGateway.onSimulationStopped`, persist final status, commit/project final event, prevent commits

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
- Command handlers for simulation lifecycle, operator injection, channel subscription
- Commands produce resolver inputs or lifecycle transitions; never mutate event log directly

### M4: Delivery Gateway Interface + Mock
- Define `IDeliveryGateway` in `scheduler-contracts.ts`
- `MockDeliveryGateway`: in-memory record of all calls, used for all runtime tests
- `DeliveryProjection`: applies `filterVisibleEventsForAgent`, calls `IDeliveryGateway` methods
- P0 tests: private channel events never reach non-member agents, motive summaries suppressed

### M5: Projections
- `EngineSnapshotProjection` builds `EngineSnapshot`
- `SpectatorProjection` produces MVP narrative events
- `OperatorProjection` produces debug/metrics/failure events
- All projections tested against `MockDeliveryGateway`
- Spectator projection includes `no_op_recorded`, `intent_delayed`, and `intent_blocked`

### M6: Simulation Lifecycle
- Create, start, pause, resume, stop
- Status events committed and projected

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
- Commit engine-emitted `memory_written` when proposals are present and `no_op_recorded` when `noOpRecord` is present before the LLM path
- Call dev3 engine → dev2 runtime-input-builder → dev1 agent runtime → dev2 intent resolver
- Persist `stepResult.updatedAgentState`; dev3 `runEngineStep()` already advances `lastProcessedEventId`
- Every 10 pulses, call `computeStagnationMetrics()` on the event-log slice and commit `stagnation_detected` when thresholds trip
- Append committed events → run projections → emit operator metrics

## Verification

```bash
pnpm --filter @perfectman/server test -- --grep "simulation"
pnpm build
```

## MVP Done Criteria

- Simulation can be created, started, paused, resumed, stopped
- Default public channel exists; all agents can commit events to it
- Private channels can be created with membership enforced at the resolver level
- Event log is the canonical append-only source of truth
- Commands and intents only affect the world through committed events
- `DeliveryProjection` routes events through `IDeliveryGateway` — delivery surface is fully swappable
- Private event projections are filtered to member agents only before reaching `IDeliveryGateway`
- Spectator projection produces correct narrative events
- Operator projection produces full debug stream
- Scheduler lives in server, not engine
- Scheduler runs correctly with mock engine, mock runtime, mock resolver, and `MockDeliveryGateway`
- Scheduler commits memory/no-op/stagnation events when emitted even when no LLM call is made
- Intent resolver calls dev3 pure validation + dev2 stateful checks
- Intent resolver reads delay timing from `SimulationSettings.pulseIntervalMs`
- RuntimeInputBuilder correctly maps EngineStepResult → AgentRuntimeInput
- WorldSignals computed and passed to engine
- WorldSignals channel-scoped fields use scheduler-provided channel anchor, falling back to `defaultPublicChannelId`
- Agent anti-drift cursor from `stepResult.updatedAgentState.lastProcessedEventId` is persisted
- EngineSnapshotProjection derives snapshots from committed events and state
- Visibility invariants have automated tests
