# Perfectman — Master Contract Reference

All three developer plans reference this document as the single source of truth for cross-boundary contracts, type ownership, and integration flow.

## Ownership Map

| Area | Owner | Package/Path |
|------|-------|-------------|
| All shared types, schemas, constants | Dev3 | `packages/shared/` |
| Pure social engine (no I/O) | Dev3 | `packages/engine/` |
| Repository interfaces + SQLite | Dev3 | `packages/server/src/persistence/` |
| Emotional state → natural language | Dev3 | `packages/engine/src/prompt/translate-emotional-state.ts` |
| Intent validation (pure rules) | Dev3 | `packages/engine/src/intent/validate-intent.ts` |
| Available action computation (pure) | Dev3 | `packages/engine/src/action/compute-available-actions.ts` |
| Rate limit rules (pure) | Dev3 | `packages/engine/src/intent/rate-limit-rules.ts` |
| Event-oriented simulation runtime | Dev2 | `packages/server/src/simulation/simulation-runtime.ts` |
| Canonical event log + replay | Dev2 | `packages/server/src/simulation/event-log.ts` |
| Command handlers | Dev2 | `packages/server/src/simulation/command-handlers.ts` |
| IDeliveryGateway interface (surface output only) | Dev2 | `packages/server/src/simulation/scheduler-contracts.ts` |
| Delivery gateway adapters (surface impls) | Optional adapter sub-plans | `packages/server/src/*/` |
| Event projections | Dev2 | `packages/server/src/simulation/projections/` |
| Simulation manager, lifecycle, scheduler | Dev2 | `packages/server/src/simulation/` |
| Intent resolver (stateful orchestration) | Dev2 | `packages/server/src/simulation/intent-resolver.ts` |
| Rate limit tracking (stateful) | Dev2 | `packages/server/src/simulation/rate-limit-gate.ts` |
| AgentRuntimeInput assembly | Dev2 | `packages/server/src/simulation/runtime-input-builder.ts` |
| In-memory store implementations | Dev2 | `packages/server/src/simulation/in-memory-stores.ts` |
| Spectator narrative projection (MVP rule-based) | Dev2 | `packages/server/src/simulation/projections/spectator-projection.ts` |
| Agent runtime, prompt builder | Dev1 | `packages/server/src/agent/` |
| Persona prompt/runtime profile | Dev1 | `packages/server/src/agent/persona-loader.ts` |
| LLM providers, budget tracker | Dev1 | `packages/server/src/llm/` |
| LLM provider/model config | Dev1 | `packages/server/src/llm/` |

## Persona And LLM Contract Split

Do not overload `PersonaConfig`.

- `PersonaConfig` is Dev3-owned domain calibration data used by the pure engine: mood baselines, emotional reactivity, sensitivity tables, thresholds, and social-behavior math.
- `PersonaPromptProfile` is Dev1-owned runtime prompt data: identity prose, voice examples, relationship biases expressed for the LLM, language/slang preferences, and system-prompt fragments.
- `LlmConfig` is Dev1-owned provider/runtime configuration: provider, model names, max tokens, temperature, timeout/retry policy, and budget policy.
- `AgentRuntimeInput` may carry the Dev3 `PersonaConfig` for calibration context, but Dev1 must translate it into prompt language and combine it with `PersonaPromptProfile`; it must not treat `PersonaConfig` as the full prompt/persona object.

Recommended runtime composition:

```text
AgentSeedState
  → PersonaConfig           # Dev3 engine calibration
  → PersonaPromptProfile    # Dev1 prompt identity and style
  → LlmConfig               # Dev1 model/provider/runtime settings
```

If a PR introduces `LlmConfig` or new prompt persona fields, it should add separate types or extend the Dev1 profile/config surface. It should not replace or narrow Dev3's existing `PersonaConfig`.

## Canonical Event Types (Dev3 defines, all consume)

```
message_sent, reply_sent, reaction_sent,
typing_started, typing_cancelled,
channel_created, agent_invited, agent_left,
presence_changed, intent_delayed, intent_blocked,
memory_written, no_op_recorded,
private_motive_summary, operator_warning, llm_failure,
simulation_started, simulation_paused, simulation_resumed, simulation_stopped,
recap_generated, reflection_completed, stagnation_detected
```

23 total. Dev2 and Dev1 consume these — never invent new event types outside shared.

## Command / Intent / Event Split

Use these terms consistently across all plans:

- **Command**: request from a human/operator/control client. Examples: `simulation:start`, `operator:inject_event`, `client:resume_from_cursor`.
- **Intent**: proposed agent action from Dev1 runtime. Examples: `send_message`, `create_channel`, `delay_response`, `no_op`.
- **Event**: accepted fact committed by Dev2 resolver/runtime. Examples: `message_sent`, `channel_created`, `intent_blocked`, `no_op_recorded`.

Only events are durable. Commands and intents may be rejected, delayed, transformed, or committed as one or more events.

## Key Type Flow

```
Command | ActionIntent
  → IntentResolver.resolve (dev2 orchestrates, calls dev3 pure validators)
  → CommittedEvent[] (dev3 defines type)
  → EventLog.append() (dev2 commits accepted facts)
  → Projections (dev2 derives audience-specific views)
      → EngineSnapshotProjection (dev2 assembles EngineSnapshot, dev3 defines type)
      → DeliveryProjection (dev2 prepares surface-ready output and calls IDeliveryGateway)
      → SpectatorProjection (dev2 MVP narrative)
      → OperatorProjection (dev2 debug/metrics)
  → RunEngineStep (dev3 pure function)
  → EngineStepResult (dev3 defines)
      → EngineEventBuilder (dev2 commits memory_written when proposals exist, no_op_recorded when present, and stagnation_detected when thresholds trip)
  → buildAgentRuntimeInput (dev2 assembles from EngineStepResult + persona + budget)
  → AgentRuntimeInput (dev3 defines type, dev2 builds instance)
  → AgentRuntime.generateIntent (dev1)
  → ActionIntent (dev3 defines type, dev1 produces instance)
```

Only `CommittedEvent[]` are appended to the event log. Commands and intents are requests/proposals; the event log contains accepted facts.

Engine-related facts (`memory_written`, `no_op_recorded`, `stagnation_detected`) are committed before the optional LLM path when their source data exists. Current dev3 `runEngineStep()` emits `noOpRecord` and an empty `memoryProposals[]`; memory proposals may be populated by later dev1/parser work. Resolver-emitted facts (`message_sent`, `reply_sent`, `reaction_sent`, `channel_created`, `intent_delayed`, `intent_blocked`) are committed only after `IntentResolver.resolve()`.

## Runtime / Projection / Delivery Boundary

- **Event runtime** owns canonical facts: lifecycle, scheduling, command handling, intent resolution, state updates, event append, and projection execution.
- **Projection layer** owns derived views: engine snapshots, spectator events, operator events, and delivery-ready messages/feed items.
- **Delivery gateway** owns surfaced information only: sending delivery-ready output to Discord, WebSocket, stdout, mocks, or another interface.

Delivery implementations must not validate intents, compute visibility, append events, mutate simulation state, run engine logic, or decide what happened. Platform concerns such as API formatting, external channel IDs, bot identity, rate limits, reconnect cursors, and mock capture stay behind the gateway.

## Cross-Boundary Contracts

### Seeded RNG

```typescript
// Dev3 defines in packages/shared/src/utils/rng.ts
type SeededRng = {
  next(): number;          // [0, 1)
  nextInt(max: number): number;
  seed: number;
};
function createSeededRng(seed: number): SeededRng;

// Dev2 creates per pulse: createSeededRng(simulationSeed + pulseIndex)
// Dev3 engine receives it in EngineSnapshot.rng
```

### dt (Time Delta)

```typescript
// dt = seconds since last pulse (float)
// Dev2 scheduler computes: (Date.now() - lastPulseTimestamp) / 1000
// Dev2 passes in EngineSnapshot.dt
// Dev3 engine uses dt for all time-dependent math (decay, inertia, regen)
```

### WorldSignals

```typescript
// Dev3 defines in packages/shared/src/engine/engine.types.ts
type WorldSignals = {
  highArousalNearby: boolean;       // any agent in channel anchor arousal > 0.7
  averageChannelArousal: number;    // mean arousal of visible agents
  activeAgentCount: number;         // agents with presence != offline
  timeSinceLastPublicMessage: number; // seconds
  channelMessageRatePerMinute: number;
  recentTopicShift: boolean;        // detected topic change in last 5 messages
};

// Dev2 scheduler computes WorldSignals from event log + agent states
// Channel-scoped fields use a scheduler-provided channel anchor, falling back to defaultPublicChannelId.
// Dev2 passes in EngineSnapshot.worldSignals
```

### AgentState Cursor

```typescript
// Dev3 defines on AgentState.
type AgentState = {
  // ...
  lastProcessedEventId: string | null; // anti-drift cursor advanced by runEngineStep and persisted by dev2
};
```

Dev2 persists `stepResult.updatedAgentState` after each successful engine step. Dev2 passes a channel anchor separately when computing `WorldSignals`.

### CommittedEvent

```typescript
// Dev3 defines in packages/shared/src/event/event.types.ts
type CommittedEvent = SimulationEvent & {
  id: string;           // assigned by event log on commit
  createdAt: number;    // timestamp assigned on commit
  pulseIndex: number;   // which pulse committed this event
};
```

### RateLimitStatus

```typescript
// Dev3 defines in packages/shared/src/engine/engine.types.ts
type RateLimitStatus = {
  agentId: string;
  messagesThisMinute: number;
  privateChannelsCreated: number;
  lastActionAt: number | null;
  blocked: boolean;
  blockReason?: string;
};

// Dev2 rate-limit-gate computes and provides
// Dev2 passes in EngineSnapshot.rateLimitStatus
// Dev3 engine uses for computeAvailableActions()
```

### AgentRuntimeInput Assembly

```typescript
// Dev3 defines type in packages/shared/src/agent/agent.types.ts
// Dev2 builds instance in packages/server/src/simulation/runtime-input-builder.ts

type AgentRuntimeInput = {
  simulationId: string;
  agentId: string;
  personaConfig: PersonaConfig;           // Dev3 engine calibration, not the full LLM prompt profile
  personaPromptProfile?: PersonaPromptProfile; // Dev1 runtime prompt profile, if assembled before call
  llmConfig?: LlmConfig;                  // Dev1 provider/model config, if assembled before call
  perceptionPacket: PerceptionPacket;     // from EngineStepResult
  emotionalState: EmotionalState;         // from EngineStepResult.updatedAgentState
  activeMotivations: Motivation[];        // from EngineStepResult.motivations
  activePressures: Pressure[];            // from EngineStepResult.pressures
  activeInhibitions: Inhibition[];        // from EngineStepResult.inhibitions
  relevantMemories: Memory[];             // from EngineStepResult.perceptionPacket.relevantMemories
  availableActions: AvailableAction[];    // from EngineStepResult.availableActions
  budgetPriority: BudgetPriority;         // from dev1 LlmBudget.getPriority()
  triggeringReason: TriggeringReason;     // from EngineStepResult.attentionResults
};

// Dev2 scheduler builds this by:
// 1. Running engine step → EngineStepResult
// 2. Looking up Dev3 PersonaConfig from shared constants
// 3. Attaching Dev1 PersonaPromptProfile / LlmConfig if that assembly is owned by the runtime boundary
// 4. Querying dev1 LlmBudget for priority
// 5. Extracting triggeringReason from attention results
// 6. Passing assembled input to dev1 AgentRuntime.generateIntent()
```

### AvailableAction

```typescript
// Dev3 defines type + pure computation in packages/engine/src/action/compute-available-actions.ts
type AvailableAction = {
  intentType: IntentType;
  channelTargets: string[];      // channel IDs agent can target
  personTargets: string[];       // agent IDs agent can target
  blocked: boolean;              // true if rate-limited or policy-blocked
  blockReason?: string;
};

// Dev3 pure function:
function computeAvailableActions(
  agentState: AgentState,
  channels: Channel[],
  membership: ChannelMembership[],
  settings: SimulationSettings,
  rateLimitStatus: RateLimitStatus  // Dev2 provides this
): AvailableAction[];

// Called inside runEngineStep. Dev2 passes RateLimitStatus via EngineSnapshot.
```

### Intent Resolution

```typescript
// Dev3 owns pure validation in packages/engine/src/intent/validate-intent.ts
type IntentValidationResult = {
  valid: boolean;
  violations: IntentViolation[];
};

function validateIntentPure(
  intent: ActionIntent,
  availableActions: AvailableAction[],
  agentState: AgentState,
  settings: SimulationSettings
): IntentValidationResult;

Salience derivation:
- Engine-emitted events derive salience from emotion delta magnitude or stagnation severity.
- Resolver-emitted events derive salience locally in the MVP resolver from `actionEmotions` + intent type.
- Lifecycle events default to `low`.

// Dev2 owns stateful resolver in packages/server/src/simulation/intent-resolver.ts
type ResolvedIntent = {
  outcome: 'committed' | 'delayed' | 'blocked' | 'fallback_committed' | 'operator_review';
  committedEvents: SimulationEvent[];
  operatorEvents: OperatorEvent[];
  delayUntilPulse?: number;
};

// Dev2 IntentResolver:
// 1. Calls dev3 validateIntentPure() for schema/safety checks
// 2. Checks channel membership via ChannelRegistry
// 3. Checks rate limits via RateLimitGate
// 4. Handles delay preferences
// 5. Produces CommittedEvent[] or block/delay outcome
```

### AgentRuntime Output

```typescript
// Dev1 defines in packages/server/src/agent/agent-runtime.types.ts
type AgentRuntimeOutput = {
  intent: ActionIntent;             // validated intent or safe fallback
  tokenUsage: LlmUsage;
  latencyMs: number;
  fallbackApplied: boolean;
  operatorEvents: OperatorEvent[];
};
```

### LLM Budget

```typescript
// Dev1 defines in packages/server/src/llm/llm-budget.ts
type LlmBudget = {
  canCall(request: LlmBudgetRequest): LlmBudgetDecision;
  recordUsage(usage: LlmUsage): void;
  getStatus(simulationId: string): LlmBudgetStatus;
  getPriority(simulationId: string, agentId: string): BudgetPriority;
};

type BudgetPriority = 'high' | 'normal' | 'low' | 'blocked';
// BudgetPriority type defined in packages/shared/src/agent/agent.types.ts
// Dev2 calls getPriority() and passes into AgentRuntimeInput.budgetPriority
```

### EngineSnapshot (Full)

```typescript
type EngineSnapshot = {
  pulseIndex: number;
  simulation: Simulation;
  committedEvents: CommittedEvent[];
  agentState: AgentState;
  persona: PersonaConfig;
  channels: Channel[];
  channelMembership: ChannelMembership[];
  relationalStates: Map<string, RelationalState>;
  worldSignals: WorldSignals;
  rateLimitStatus: RateLimitStatus;
  dt: number;
  rng: SeededRng;
};
```

### EngineStepResult (Full)

```typescript
type EngineStepResult = {
  visibleEvents: CommittedEvent[];
  newEvents: CommittedEvent[];
  attentionResults: AttentionResult;
  perceptionPacket: PerceptionPacket;
  interpretations: Interpretation[];
  emotionDelta: EmotionDelta;
  updatedAgentState: AgentState;
  motivations: Motivation[];
  pressures: Pressure[];
  inhibitions: Inhibition[];
  actionEmotions: ActionEmotions;
  decision: Decision;
  availableActions: AvailableAction[];
  initiativeCandidates: InitiativeCandidate[];
  memoryProposals: MemoryWriteProposal[];
  noOpRecord: NoOpRecord | null;
  operatorMetrics: OperatorMetrics;
};

type Decision = {
  outcome: 'act' | 'delay' | 'no_op' | 'memory_only';
  needsLLM: boolean;
  initiativeProceed: boolean;
  noOpReason?: NoOpReason;
  privateMotiveSeed: string;
};
```

### Repository Interfaces (Dev3 defines, Dev2 implements in-memory)

```typescript
type IEventRepository = {
  append(simulationId: string, events: SimulationEvent[]): Promise<CommittedEvent[]>;
  getById(simulationId: string, eventId: string): Promise<CommittedEvent | null>;
  getAfter(simulationId: string, afterEventId?: string): Promise<CommittedEvent[]>;
  getCommittedThrough(simulationId: string, pulseIndex: number): Promise<CommittedEvent[]>;
};

type IAgentStateRepository = {
  get(simulationId: string, agentId: string): Promise<AgentState | null>;
  upsert(agentState: AgentState): Promise<void>;
  listBySimulation(simulationId: string): Promise<AgentState[]>;
};

type IMemoryRepository = {
  getByAgent(simulationId: string, agentId: string): Promise<Memory[]>;
  upsert(memory: Memory): Promise<void>;
  getBySubject(simulationId: string, subjectAgentId: string): Promise<Memory[]>;
};

type ISimulationRepository = {
  create(input: CreateSimulationInput): Promise<Simulation>;
  get(simulationId: string): Promise<Simulation | null>;
  updateStatus(simulationId: string, status: SimulationStatus): Promise<void>;
  updateSettings(simulationId: string, settings: Partial<SimulationSettings>): Promise<void>;
};

type IChannelRepository = {
  create(channel: Channel): Promise<Channel>;
  listBySimulation(simulationId: string): Promise<Channel[]>;
  updateMembers(channelId: string, memberAgentIds: string[]): Promise<void>;
  archive(channelId: string): Promise<void>;
  getMembership(channelId: string): Promise<ChannelMembership[]>;
};
```

## Parallel Execution Timeline

### Week 1 (dev3 M1-M3 unblocks dev1+dev2)

| Dev3 | Dev1 | Dev2 |
|------|------|------|
| M1: workspace scaffold | Wait for M2 | Wait for M2 |
| M2: core shared schemas | **Unblocked**: M1 types+parser | **Unblocked**: M1 stores |
| M3: constants+personas | M2: prompt builder | M2: event log |

### Week 2

| Dev3 | Dev1 | Dev2 |
|------|------|------|
| M4: visibility+anti-drift | M3: mock provider | M3: event runtime+command handlers |
| M5: attention+perception | M4: budget tracker | M4: delivery gateway contract+mock |

### Weeks 3-4

| Dev3 | Dev1 | Dev2 |
|------|------|------|
| M6-M12: engine modules | M5: anthropic adapter | M5-M8: lifecycle+scheduler |

### Week 5 MVP Integration

| Dev3 | Dev1 | Dev2 |
|------|------|------|
| M13-M14: persistence+fixtures | M6: runtime orchestration | M9: spectator/operator projection |

**Integration**: scheduler → engine → runtime-input-builder → agent-runtime → intent-resolver → event-log → projections → delivery gateway. 60-second simulation test.
