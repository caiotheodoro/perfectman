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
| Socket.IO server, rooms, broadcast | Dev2 | `packages/server/src/socket/` |
| Simulation manager, lifecycle, scheduler | Dev2 | `packages/server/src/simulation/` |
| Intent resolver (stateful orchestration) | Dev2 | `packages/server/src/simulation/intent-resolver.ts` |
| Rate limit tracking (stateful) | Dev2 | `packages/server/src/simulation/rate-limit-gate.ts` |
| AgentRuntimeInput assembly | Dev2 | `packages/server/src/simulation/runtime-input-builder.ts` |
| In-memory store implementations | Dev2 | `packages/server/src/simulation/in-memory-stores.ts` |
| Spectator narrative (MVP rule-based) | Dev2 | `packages/server/src/simulation/spectator-feed.ts` |
| Agent runtime, prompt builder | Dev1 | `packages/server/src/agent/` |
| LLM providers, budget tracker | Dev1 | `packages/server/src/llm/` |
| Persona loader (reads dev3 constants) | Dev1 | `packages/server/src/agent/persona-loader.ts` |

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

## Key Type Flow

```
EngineSnapshot (dev2 assembles, dev3 defines)
  → RunEngineStep (dev3 pure function)
  → EngineStepResult (dev3 defines)
  → buildAgentRuntimeInput (dev2 assembles from EngineStepResult + persona + budget)
  → AgentRuntimeInput (dev3 defines type, dev2 builds instance)
  → AgentRuntime.generateIntent (dev1)
  → ActionIntent (dev3 defines type, dev1 produces instance)
  → IntentResolver.resolve (dev2 orchestrates, calls dev3 pure validators)
  → CommittedEvent (dev3 defines type, dev2 commits to event log)
  → BroadcastRouter (dev2 fans out with dev3 visibility rules)
```

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
  highArousalNearby: boolean;       // any agent in same channel arousal > 0.7
  averageChannelArousal: number;    // mean arousal of visible agents
  activeAgentCount: number;         // agents with presence != offline
  timeSinceLastPublicMessage: number; // seconds
  channelMessageRatePerMinute: number;
  recentTopicShift: boolean;        // detected topic change in last 5 messages
};

// Dev2 scheduler computes WorldSignals from event log + agent states
// Dev2 passes in EngineSnapshot.worldSignals
```

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
  personaConfig: PersonaConfig;           // from shared constants
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
// 2. Looking up PersonaConfig from shared constants
// 3. Querying dev1 LlmBudget for priority
// 4. Extracting triggeringReason from attention results
// 5. Passing assembled input to dev1 AgentRuntime.generateIntent()
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
| M4: visibility+anti-drift | M3: mock provider | M3: socket server+rooms |
| M5: attention+perception | M4: budget tracker | M4: broadcast router |

### Weeks 3-4

| Dev3 | Dev1 | Dev2 |
|------|------|------|
| M6-M12: engine modules | M5: anthropic adapter | M5-M8: lifecycle+scheduler |

### Week 5 MVP Integration

| Dev3 | Dev1 | Dev2 |
|------|------|------|
| M13-M14: persistence+fixtures | M6: runtime orchestration | M9: spectator+reconnect |

**Integration**: scheduler → engine → runtime-input-builder → agent-runtime → intent-resolver → event-log → broadcast. 60-second simulation test.
