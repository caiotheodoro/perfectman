# Developer 3 Plan: Shared Domain / Pure Engine / Integration

> Cross-reference: [Master Contract](./master-contract.md) for all shared types, ownership boundaries, and integration flow.

## Goal

Build shared domain contracts, pure social engine, persistence interfaces + SQLite, scenario fixtures, and integration verification. Dev3 is the foundation — dev1 and dev2 cannot start meaningful work until dev3 publishes core schemas (M2 is blocking).

## Architecture

```text
packages/shared      → all types, schemas, constants, fixtures
packages/engine      → pure functions only (no I/O)
packages/server/src/persistence → repository interfaces + SQLite
```

## Ownership Boundary

**Own:**
- `packages/shared/` — every type, schema, constant, fixture used by any developer
- `packages/engine/` — all pure social engine functions
- `packages/server/src/persistence/` — repository interfaces + SQLite implementations
- Root workspace setup (pnpm, tsconfig, vitest)

**Provide to dev1:**
- `ActionIntent`, `IntentType`, `AgentRuntimeInput`, `PersonaConfig`, `AgentSeedState`
- `CoreMood`, `SocialEmotions`, `RelationalState`, `ActionEmotions`
- `Pressure`, `Inhibition`, `Memory`, `PerceptionPacket`
- `OperatorEvent`, `LlmUsage`, `AvailableAction`, `NoOpReason`, `DelayPreference`
- `translateEmotionalState()` — pure function in engine
- Fixture scenarios for testing

**Do not provide to dev1:**
- LLM provider configuration such as provider, model name, temperature, token limits, timeout, or retry policy
- Prompt identity/configuration as a replacement for `PersonaConfig`
- System prompt text or persona voice examples as part of the engine calibration contract

`PersonaConfig` is Dev3-owned engine calibration data. If Dev1 needs LLM-facing persona data, it should use a separate `PersonaPromptProfile`/runtime profile and combine it with `PersonaConfig` at the agent runtime boundary.

**Provide to dev2:**
- `Simulation`, `SimulationStatus`, `SimulationSettings`
- `Channel`, `ChannelType`, `ChannelMembership`
- `SimulationEvent`, `CommittedEvent`, `EventVisibility`
- `AgentState`, `EngineSnapshot`, `EngineStepResult`
- `SpectatorEvent`, `OperatorEvent`
- `WorldSignals`, `SeededRng`, `RateLimitStatus`
- `RunEngineStep()` — pure engine entry point
- `filterVisibleEvents()` — pure visibility function
- `validateIntentPure()` — pure intent validation
- `computeAvailableActions()` — pure action computation
- `checkRateLimitPure()` — pure rate limit rules
- Repository interfaces (`IEventRepository`, `IAgentStateRepository`, etc.)
- Fixture scenarios for testing

**Need from dev1:**
- Parser constraints for intent schema (field requirements, max lengths)
- Prompt denylist (fields that must never appear in prompts)
- Mock LLM output examples for integration fixtures

**Need from dev2:**
- Event runtime and scheduler call shape confirmation
- Event projection requirements for engine/spectator/operator/delivery views
- Operator metric payload requirements
- Reconnect cursor constraints for event replay

## Files To Create

### Workspace

```
package.json
pnpm-workspace.yaml
tsconfig.base.json
vitest.workspace.ts
packages/shared/package.json
packages/shared/tsconfig.json
packages/engine/package.json
packages/engine/tsconfig.json
packages/server/package.json
packages/server/tsconfig.json
```

### Shared Package

```
packages/shared/src/
  index.ts                                    # barrel export

  simulation/
    simulation.types.ts                       # Simulation, SimulationStatus, SimulationSettings
    simulation.schema.ts

  channel/
    channel.types.ts                          # Channel, ChannelType, ChannelMembership
    channel.schema.ts

  event/
    event.types.ts                            # SimulationEvent, CommittedEvent, EventVisibility, EventType (23 types)
    event.schema.ts

  agent/
    agent.types.ts                            # AgentState, AgentRuntimeInput, AgentSeedState, PresenceMode, BudgetPriority, TriggeringReason, EmotionalState
    agent.schema.ts

  prompt/
    prompt.types.ts                           # TranslatedEmotionalState and safe prompt helper types, not provider config

  visibility/
    visibility.types.ts                       # EventVisibility fields, VisibilityContext

  attention/
    attention.types.ts                        # AttentionResult, AttentionReason, TriggeringReason

  perception/
    perception.types.ts                       # PerceptionPacket

  interpretation/
    interpretation.types.ts                   # Interpretation, InterpretationSignal

  motivation/
    motivation.types.ts                       # Motivation, MotivationType (17 categories)

  emotion/
    emotion.types.ts                          # CoreMood, SocialEmotions, RelationalState, ActionEmotions, MoodImpulse, EmotionDelta
    emotion.schema.ts

  pressure/
    pressure.types.ts                         # Pressure, PressureType, VisibilityPreference

  inhibition/
    inhibition.types.ts                       # Inhibition, InhibitionType

  intent/
    intent.types.ts                           # ActionIntent, IntentType (11), IntentValidationResult, IntentViolation, ResolvedIntent, MemoryWriteProposal
    intent.schema.ts

  memory/
    memory.types.ts                           # Memory, MemoryType (6 types)

  spectator/
    spectator.types.ts                        # SpectatorEvent

  operator/
    operator.types.ts                         # OperatorEvent, LlmUsage, StagnationMetrics, OperatorMetrics

  initiative/
    initiative.types.ts                       # InitiativeAccumulator, InitiativeCandidate, InitiativeSource (17 sources)

  engine/
    engine.types.ts                           # EngineSnapshot, EngineStepResult, WorldSignals, RateLimitStatus

  decision/
    decision.types.ts                         # Decision, DecisionOutcome, NoOpReason, NoOpRecord, DelayPreference

  action/
    action.types.ts                           # AvailableAction

  constants/
    circumplex.ts                             # 12 reference positions
    personas.ts                               # 5 persona mood configs (13 params each) + 5 sensitivity tables (15 dims each)
    emotion-rules.ts                          # event-to-impulse table (15 rows), social emotion triggers + decay, relational update rules
    action-pressure-map.ts                    # 15 action emotion → pressure/inhibition mappings
    stagnation.ts                             # 7 metric thresholds, composite score weights, intervention cooldowns

  utils/
    id.ts                                     # nanoid or similar
    math.ts                                   # clamp, lerp, angularDistance, dampedSpring, meanOf
    rng.ts                                    # SeededRng interface + createSeededRng implementation

  fixtures/
    personas.ts                               # buildFivePersonaSeedFixture()
    simulation-fixture.ts                     # buildSimulationFixture()
    bruno-caio-exclusion.ts                   # buildBrunoCaioExclusionScenario()
    cold-start-first-10-minutes.ts            # buildGoulartColdStartScenario()
    delayed-reply.ts                          # buildDelayedReplyScenario()
    no-op-inhibition.ts                       # buildNoOpInhibitionScenario()
    private-channel-motive.ts                 # buildPrivateChannelMotiveScenario()
    biased-memory.ts                          # buildBiasedMemoryScenario()
```

### Engine Package

```
packages/engine/src/
  index.ts                                    # barrel: runEngineStep, filterVisibleEvents, validateIntentPure, computeAvailableActions, translateEmotionalState, checkRateLimitPure

  step/
    run-engine-step.ts                        # primary entry: EngineSnapshot → EngineStepResult

  visibility/
    filter-visible-events.ts                  # per-agent, per-spectator, per-operator filtering

  memory/
    get-new-events-since.ts                   # anti-drift: events after lastProcessedEventId

  attention/
    score-attention.ts                        # attention scoring, needsLLM gate

  perception/
    build-perception-packet.ts                # context bundle for AgentRuntimeInput

  interpretation/
    interpret-programmatic-signals.ts         # mention-ignored, reply-latency, silence, asymmetry

  emotion/
    update-core-mood.ts                       # damped spring, angular constraint, shock override
    update-social-emotions.ts                 # 15 trigger rules, decay, mood-congruent amplification
    update-relational-emotions.ts             # per-pair asymmetric, mood-congruent distortion
    compute-action-emotions.ts               # 15 behavioral tendencies from mood+social+relational
    update-emotion-stack.ts                   # 8-step cycle composing all 4 layers

  rumination/
    apply-rumination.ts                       # probability from mood+persona, intensify relational, cooldown

  motivation/
    derive-motivations.ts                     # 17 motivation categories from context

  pressure/
    compute-pressures.ts                      # action emotions → pressure types + intensity + visibility preference

  inhibition/
    compute-inhibitions.ts                    # persona + social state → inhibition types + strength

  decision/
    resolve-decision.ts                       # pressure vs inhibition → act/delay/no-op/memory-only

  initiative/
    update-initiative-accumulators.ts         # per-pulse pure math, 17 sources
    score-initiative-candidates.ts            # scoring + gating, cold-start stagger

  intent/
    validate-intent.ts                        # pure validation: schema, safety, symbolic rules, delay handling
    rate-limit-rules.ts                       # pure rate limit check given RateLimitStatus

  action/
    compute-available-actions.ts              # pure: agentState + channels + membership + settings + rateLimitStatus → AvailableAction[]

  prompt/
    translate-emotional-state.ts              # CoreMood + SocialEmotions + RelationalState + Pressures + Inhibitions → natural language strings

  health/
    compute-stagnation-metrics.ts             # 7 metrics (BDI, RDV, IGE, CUE, ERI, ISD, CNS), composite score, attractor detection

  __tests__/
    visibility.test.ts
    attention.test.ts
    emotion-core.test.ts
    emotion-social.test.ts
    emotion-relational.test.ts
    emotion-stack.test.ts
    action-emotions.test.ts
    pressure-inhibition.test.ts
    initiative.test.ts
    perception-packet.test.ts
    rumination.test.ts
    interpretation.test.ts
    decision.test.ts
    validate-intent.test.ts
    available-actions.test.ts
    translate-emotional-state.test.ts
    stagnation.test.ts
    engine-step.test.ts
    no-io-boundary.test.ts                    # verifies engine imports no I/O modules
```

### Persistence

```
packages/server/src/persistence/
  repositories.ts                             # IEventRepository, IAgentStateRepository, IMemoryRepository, ISimulationRepository, IChannelRepository
  sqlite/
    schema.ts                                 # CREATE TABLE statements
    database.ts                               # connection helper
    event-repository.ts
    agent-state-repository.ts
    memory-repository.ts
    simulation-repository.ts
    channel-repository.ts
  __tests__/
    sqlite-repositories.test.ts
```

## Shared Domain Model (Canonical)

### Simulation

```typescript
type SimulationStatus = 'initializing' | 'running' | 'paused' | 'stopped';

type SimulationSettings = {
  omniscientSpectatorMode: boolean;
  allowPrivateChannels: boolean;
  maxPrivateChannelsPerAgent: number;
  maxMessagesPerMinutePerAgent: number;
  llmCallBudgetPerMinute: number;
  pulseIntervalMs: number;            // 2000-5000
  tokenBudgetPerHour: number;
};

type Simulation = {
  id: string;
  name: string;
  status: SimulationStatus;
  agentIds: string[];
  channelIds: string[];
  settings: SimulationSettings;
  seed: number;                        // for deterministic RNG
  createdAt: number;
  updatedAt: number;
};
```

### Channel

```typescript
type ChannelType = 'public_channel' | 'private_channel' | 'spectator_channel' | 'operator_channel';

type Channel = {
  id: string;
  simulationId: string;
  type: ChannelType;
  name: string;
  createdBy: string;                   // agentId or 'system'
  memberAgentIds: string[];
  spectatorVisible: boolean;
  operatorVisible: boolean;            // always true
  createdForMotives: string[];         // from 17 private channel motive categories
  status: 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
};

type ChannelMembership = {
  channelId: string;
  agentId: string;
  joinedAt: number;
  leftAt?: number;
};
```

### Event (23 types)

```typescript
type EventType =
  | 'message_sent' | 'reply_sent' | 'reaction_sent'
  | 'typing_started' | 'typing_cancelled'
  | 'channel_created' | 'agent_invited' | 'agent_left'
  | 'presence_changed' | 'intent_delayed' | 'intent_blocked'
  | 'memory_written' | 'no_op_recorded'
  | 'private_motive_summary' | 'operator_warning' | 'llm_failure'
  | 'simulation_started' | 'simulation_paused' | 'simulation_resumed' | 'simulation_stopped'
  | 'recap_generated' | 'reflection_completed' | 'stagnation_detected';

type EmotionalSalience = 'low' | 'medium' | 'high' | 'critical';

type EventVisibility = {
  visibleToAgents: string[];           // agent IDs, empty = all in channel
  visibleToSpectators: boolean;
  visibleToOperators: boolean;         // always true
  visibilityReason: string;
};

type SimulationEvent = {
  id?: string;                         // assigned on commit
  simulationId: string;
  channelId: string;
  actorId: string;
  type: EventType;
  payload: Record<string, unknown>;
  createdAt?: number;                  // assigned on commit
  pulseIndex?: number;                 // assigned on commit
  sourceIntentId?: string;
  sourceEventIds: string[];
  emotionalSalience: EmotionalSalience;
  visibility: EventVisibility;
};

type CommittedEvent = SimulationEvent & {
  id: string;
  createdAt: number;
  pulseIndex: number;
};
```

### Agent State

```typescript
type PresenceMode = 'active' | 'semi_active' | 'lurking' | 'busy_elsewhere' | 'avoidant' | 'offline';

type BudgetPriority = 'high' | 'normal' | 'low' | 'blocked';

type AgentState = {
  agentId: string;
  simulationId: string;
  personaId: string;
  presence: PresenceMode;
  coreMood: CoreMood;
  socialEmotions: SocialEmotions;
  relationalStates: Map<string, RelationalState>;  // keyed by target agentId
  memories: Memory[];
  initiativeAccumulators: InitiativeAccumulator[];
  lastProcessedEventId: string | null;
  lastActionAt: number | null;
  createdAt: number;
  updatedAt: number;
};

type EmotionalState = {
  coreMood: CoreMood;
  socialEmotions: SocialEmotions;
  relationalStates: Map<string, RelationalState>;
};

type LlmConfig = {
  providerType: 'local_uncensored' | 'freellmapi' | 'mock';
  baseUrl: string;                 // e.g. 'http://localhost:8000/v1', 'http://localhost:8080/v1', 'http://localhost:11434/v1', or 'http://localhost:3001/v1'
  apiKey?: string;                 // Unified key for FreeLLMAPI, or empty/omitted for local runtimes
  modelName: string;               // e.g., 'Qwen/Qwen3-8B', 'qwen3:8b', 'auto', or a FreeLLMAPI model id
  temperature: number;
  maxTokens?: number;
  timeoutMs?: number;
  extraBody?: Record<string, unknown>; // Provider-specific options, e.g. Qwen3 enable_thinking=false when supported
};

type PersonaConfig = {
  id: string;
  name: string;
  archetype: string;
  writingStyle: {
    tone: string;
    rules: string[];
    styleExamples: string[];
  };
  relationshipBiases: Record<string, string>;
  llmConfig: LlmConfig;            // per-agent provider config for local/FreeLLMAPI A/B testing
};

type AgentRuntimeInput = {
  simulationId: string;
  agentId: string;
  personaConfig: PersonaConfig;        // engine calibration only
  perceptionPacket: PerceptionPacket;
  emotionalState: EmotionalState;
  activeMotivations: Motivation[];
  activePressures: Pressure[];
  activeInhibitions: Inhibition[];
  relevantMemories: Memory[];
  availableActions: AvailableAction[];
  budgetPriority: BudgetPriority;
  triggeringReason: TriggeringReason;
};
```

Dev3 may define safe prompt helper types such as `TranslatedEmotionalState` because the engine owns numeric-to-subjective translation. Dev3 should not define `LlmConfig`; provider/model/runtime config belongs to Dev1.

### Emotion Stack (4 layers)

**Layer 1: CoreMood**
```typescript
type CoreMood = {
  valence: number;           // [-1, 1]
  arousal: number;           // [0, 1]
  stability: number;         // [0.1, 1] (floor 0.1)
  energy: number;            // [0, 1]
  circumplexAngle: number;   // radians
  circumplexRadius: number;  // [0, 1]
  momentumValence: number;
  momentumArousal: number;
};
```

**Layer 2: SocialEmotions** — 15 dimensions `[0, 1]`
```typescript
type SocialEmotions = {
  jealousy: number; envy: number; humiliation: number; pride: number;
  shame: number; affection: number; resentment: number; suspicion: number;
  admiration: number; contempt: number; neediness: number; socialAnxiety: number;
  fearOfExclusion: number; desireForStatus: number; desireForIntimacy: number;
};
```

**Layer 3: RelationalState** — 12 dims per pair, asymmetric
```typescript
type RelationalState = {
  targetAgentId: string;
  trust: number;                // [-1, 1]
  affection: number;            // [0, 1]
  resentment: number;           // [0, 1]
  attraction: number;           // [0, 1]
  suspicion: number;            // [0, 1]
  admiration: number;           // [0, 1]
  envy: number;                 // [0, 1]
  comfort: number;              // [0, 1]
  threat: number;               // [0, 1]
  curiosity: number;            // [0, 1]
  desireForCloseness: number;   // [0, 1]
  desireForDistance: number;     // [0, 1]
  interactionCount: number;
  lastInteractionAt: number | null;
  lastPositiveAt: number | null;
  lastNegativeAt: number | null;
};
```

**Layer 4: ActionEmotions** — 15 tendencies `[0, 1]`, computed not persisted
```typescript
type ActionEmotions = {
  defensiveness: number; warmth: number; jealousInspection: number;
  shameWithdrawal: number; resentfulColdness: number; curiousApproach: number;
  anxiousOverreach: number; pridefulPerformance: number; vulnerableRetreat: number;
  contemptuousDismissal: number; strategicPatience: number; impulsiveProvocation: number;
  comfortSeeking: number; dominanceAssertion: number; repairImpulse: number;
};
```

### Intent (11 types)

```typescript
type IntentType =
  | 'send_message' | 'reply_to_message' | 'react'
  | 'create_channel' | 'invite_agent' | 'leave_channel'
  | 'typing_start' | 'typing_cancel'
  | 'write_memory' | 'delay_response' | 'no_op';

type ActionIntent = {
  id: string;
  actorId: string;
  intentType: IntentType;
  channelTarget?: string;
  personTargets: string[];
  visibleContent?: string;
  privateMotiveSummary: string;        // required, never empty
  emotionDrivers: string[];
  motivationDrivers: string[];
  preferredDelay?: number;             // ms
  fallbackIfBlocked?: IntentType;
  memoryWrites: MemoryWriteProposal[];
  spectatorSummary?: string;
};
```

### Engine Contract

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

type WorldSignals = {
  highArousalNearby: boolean;
  averageChannelArousal: number;
  activeAgentCount: number;
  timeSinceLastPublicMessage: number;
  channelMessageRatePerMinute: number;
  recentTopicShift: boolean;
};

type RateLimitStatus = {
  agentId: string;
  messagesThisMinute: number;
  privateChannelsCreated: number;
  lastActionAt: number | null;
  blocked: boolean;
  blockReason?: string;
};
```

## Engine Modules

### Visibility
- `filterVisibleEvents(events, agentId, channels, membership, settings)` → agent-filtered events
- Also supports spectator/operator views
- Tests: non-member can't see private, member can, spectator controlled by policy, operator sees all

### Anti-Drift Memory
- `getNewEventsSince(events, lastProcessedEventId)` → only unprocessed events
- Cursor moves forward only. Empty permits rumination. Old events never retrigger.

### Attention
- `scoreAttention(agent, event, persona, relationalStates, worldSignals)` → AttentionResult
- Due score formula: `cadencePulse + mentionUrgency + channelActivityPull + personFocusPull + arousalBoost + objectiveUrgency + socialPressure - sleepPressurePenalty - offlinePenalty - recentActionCooldown`
- Returns `needsLLM` only for meaningful events

### Perception Packet
- `buildPerceptionPacket(agent, visibleEvents, channels, memories, emotionalState, availableActions)` → PerceptionPacket
- No hidden channel content, no spectator/operator events, no raw numeric scores

### Programmatic Interpretation
- Detect: mention-ignored, reply-latency, public-silence, public/private-asymmetry, reaction-instead-of-text
- Preserve uncertainty — multiple meanings, not forced truth

### Emotion Stack (8-step cycle)
1. Collect impulses from new events using event-to-impulse table
2. Update L2 social emotions (triggers × persona sensitivity, decay, mood-congruent amplification)
3. Update L3 relational emotions (per-pair asymmetric, mood-congruent distortion)
4. Aggregate L3→L2 feedback
5. Update L1 core mood (damped spring, angular constraint, shock override, energy/stability)
6. Compute L4 action emotions (15 formulas from mood+social+relational)
7. Clamp all values. Stability floor 0.1, emotions [0,1], valence [-1,1]
8. Compute pressures + inhibitions from L4

### Motivation
- 17 categories: boredom, curiosity, repair, gossip, status, attraction, comfort, alliance, avoidance, control, testing, conflict, exclusion, liking, vulnerability, secrecy, impulse

### Pressure + Inhibition
- Action emotions → pressure types (urges) with intensity + visibility preference (public/private/either/hidden)
- Persona + social state → inhibition types (blocks) with strength
- 15 action-to-pressure mappings from design docs

### Decision
- Pressure vs inhibition: strongest pressure > strongest inhibition → act, otherwise delay/no-op/memory-only
- No-op is first-class with reason and private motive summary seed

### Initiative
- 17 accumulator sources, updated every pulse (pure math)
- Cold-start bootstrapping with staggered arrivals per persona
- Scoring + gating: can proceed without new message

### Rumination
- Probability from mood + persona (negative mood increases probability)
- Intensifies unresolved relational emotions without creating synthetic evidence
- Cooldown prevents runaway

### Health / Stagnation
- 7 metrics: BDI, RDV, IGE, CUE, ERI, ISD, CNS
- Composite score: `0.25*(1-RDV) + 0.20*(1-ERI) + 0.15*(1-BDI) + 0.15*(1-IGE) + 0.10*(1-CUE) + 0.10*(1-ISD) + 0.05*(1-CNS)`
- YELLOW > 0.60, RED > 0.75, CRITICAL > 0.85
- 6 attractor state detectors
- MVP: detection only, breaking mechanisms post-MVP

### Emotional State Translation
- `translateEmotionalState(mood, social, relational, pressures, inhibitions)` → natural language strings
- Short subjective sentences, preserves ambiguity, never leaks numbers, never spectator-style narration
- Dev1 imports this for prompt builder sections 4 and 5

### Intent Validation (Pure)
- `validateIntentPure(intent, availableActions, agentState, settings)` → IntentValidationResult
- Checks: schema valid, intent type supported, targets in available actions, no hidden channels/people, privateMotiveSummary present, delay/fallback valid
- Dev2 IntentResolver calls this as first step

### Rate Limit Rules (Pure)
- `checkRateLimitPure(intentType, rateLimitStatus, settings)` → { allowed: boolean, reason?: string }
- Dev2 rate limit gate provides `RateLimitStatus`, this function applies pure rules

### Available Actions (Pure)
- `computeAvailableActions(agentState, channels, membership, settings, rateLimitStatus)` → AvailableAction[]
- Called inside `runEngineStep`
- Dev2 passes `rateLimitStatus` via `EngineSnapshot.rateLimitStatus`

## Persistence

### Repository Interfaces

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

Dev2 implements these as in-memory stores for MVP. Dev3 implements SQLite versions.

### SQLite Tables

```sql
CREATE TABLE simulations (
  id TEXT PRIMARY KEY, name TEXT, status TEXT, agent_ids JSON,
  channel_ids JSON, settings JSON, seed INTEGER, created_at INTEGER, updated_at INTEGER
);

CREATE TABLE channels (
  id TEXT PRIMARY KEY, simulation_id TEXT REFERENCES simulations(id),
  type TEXT, name TEXT, created_by TEXT, member_agent_ids JSON,
  spectator_visible INTEGER, operator_visible INTEGER,
  created_for_motives JSON, status TEXT, created_at INTEGER, updated_at INTEGER
);

CREATE TABLE events (
  id TEXT PRIMARY KEY, simulation_id TEXT REFERENCES simulations(id),
  channel_id TEXT, actor_id TEXT, type TEXT, payload JSON,
  created_at INTEGER, pulse_index INTEGER, source_intent_id TEXT,
  source_event_ids JSON, emotional_salience TEXT, visibility JSON
);

CREATE TABLE agent_states (
  agent_id TEXT, simulation_id TEXT, PRIMARY KEY (agent_id, simulation_id),
  persona_id TEXT, presence TEXT, core_mood JSON, social_emotions JSON,
  relational_states JSON, memories JSON, initiative_accumulators JSON,
  last_processed_event_id TEXT, last_action_at INTEGER,
  created_at INTEGER, updated_at INTEGER
);

CREATE TABLE memories (
  id TEXT PRIMARY KEY, agent_id TEXT, simulation_id TEXT,
  type TEXT, subject_agent_ids JSON, source_event_ids JSON,
  summary TEXT, emotional_tone TEXT, confidence REAL,
  unresolved INTEGER, created_at INTEGER, last_reinforced_at INTEGER
);
```

## Fixtures

Each fixture includes: simulation, channels, agents, agent states, events, expected engine signals, expected available action shape.

- `buildSimulationFixture()` — basic 5-agent sim with #geral
- `buildFivePersonaSeedFixture()` — all 5 persona configs with seed states
- `buildGoulartColdStartScenario()` — Goulart arrives first, boredom drives first message
- `buildBrunoCaioExclusionScenario()` — Caio replies to Goulart not Bruno, tests exclusion cascade
- `buildPrivateChannelMotiveScenario()` — affinity+inhibition drives private channel creation
- `buildDelayedReplyScenario()` — delay interpretation changes meaning
- `buildNoOpInhibitionScenario()` — overwhelming inhibition produces first-class no-op
- `buildBiasedMemoryScenario()` — mood-congruent memory retrieval bias

## Implementation Milestones

### M1: Workspace + Package Scaffolding
- pnpm workspace, tsconfig base, vitest workspace
- Empty packages/shared, packages/engine, packages/server with build scripts
- `pnpm build` passes on empty packages

### M2: Core Shared Schemas (BLOCKING — dev1 and dev2 wait on this)
- Simulation, Channel, Event types + Zod schemas
- Agent, Intent, Emotion types + Zod schemas
- Visibility, Perception, Operator, Spectator types
- Engine types: EngineSnapshot, EngineStepResult, WorldSignals, RateLimitStatus
- Decision, Action, Initiative types
- SeededRng, CommittedEvent, AgentRuntimeInput, BudgetPriority
- Export everything from `packages/shared/src/index.ts`
- Tests: schemas validate fixtures, reject invalid data

### M3: Constants + Persona Seeds
- Circumplex 12 positions
- 5 persona mood configs (13 params × 5)
- 5 persona sensitivity tables (15 dims × 5)
- Event-to-impulse table (15 rows)
- Social emotion trigger rules + decay rates
- Relational update rules
- Action-to-pressure mapping (15)
- Stagnation thresholds + weights
- Tests: persona seeds validate

### M4: Visibility + Anti-Drift
- `filterVisibleEvents` — per-agent, per-spectator, per-operator
- `getNewEventsSince` — cursor-based
- Tests: private visibility, omniscient spectator, cursor forward-only

### M5: Attention + Perception + Available Actions
- `scoreAttention` with due score formula
- `buildPerceptionPacket` — visible-only context bundle
- `computeAvailableActions` — pure action computation from state + rate limits
- Tests: mention attention, ignored low-salience, packet excludes hidden data + raw scores

### M6: Emotion Stack
- `updateCoreMood` — damped spring, angular constraint, shock override
- `updateSocialEmotions` — 15 triggers × persona sensitivity, decay, amplification
- `updateRelationalEmotions` — per-pair asymmetric, mood-congruent distortion
- `computeActionEmotions` — 15 formulas
- `updateEmotionStack` — 8-step cycle composition
- Tests: bounds/clamping, Bruno-Caio asymmetry, energy/stability rules, angular constraint

### M7: Interpretation + Motivation + Pressure + Inhibition
- `interpretProgrammaticSignals` — 6 signal types
- `deriveMotivations` — 17 categories
- `computePressures` — action emotions → urges
- `computeInhibitions` — persona + social → blocks
- Tests: exclusion interpretation, shame beats reply, private-channel motive

### M8: Decision + Initiative + Rumination
- `resolveDecision` — pressure vs inhibition → outcome
- `updateInitiativeAccumulators` — per-pulse math, 17 sources
- `scoreInitiativeCandidates` — scoring + gating + cold-start stagger
- `applyRumination` — probability, intensification, cooldown
- Tests: act/delay/no-op paths, cold-start initiative, rumination without new evidence

### M9: Intent Validation + Rate Limit Rules
- `validateIntentPure` — schema + safety + symbolic rules
- `checkRateLimitPure` — pure check given RateLimitStatus
- Tests: valid intent passes, hidden target blocked, unsupported type blocked, rate limit blocked

### M10: Emotional State Translation
- `translateEmotionalState` — mood+social+relational+pressures+inhibitions → natural language
- Tests: output contains no numbers, output is subjective, no spectator narration style

### M11: Engine Step Composition
- `runEngineStep` — compose all modules: visibility → anti-drift → attention → perception → interpretation → emotion → motivation → pressure/inhibition → decision → initiative → available actions → package result
- Tests: full step with fixtures, no I/O imports (import boundary test)

### M12: Health / Stagnation
- `computeStagnationMetrics` — 7 metrics + composite score + attractor detection
- Tests: repetitive activity increases score, mixed activity keeps score low, metrics never in agent prompt

### M13: Persistence
- Repository interfaces
- SQLite schema + connection helper
- 5 SQLite repository implementations
- Tests: round-trips, event append ordering, lastProcessedEventId persistence

### M14: Fixtures + Integration Readiness
- All 8 fixture builders
- Export stable EngineSnapshot, EngineStepResult, fixture builders
- No-I/O boundary test (engine package must not import fs/http/net/socket.io/provider SDKs/server)
- Full `pnpm build` passes

## Verification

```bash
pnpm build                                    # all packages compile
pnpm --filter @perfectman/shared test          # schemas validate
pnpm --filter @perfectman/engine test          # engine pure functions pass
pnpm --filter @perfectman/server test          # persistence tests pass
pnpm test                                      # full workspace
```

Engine no-I/O boundary test must pass — engine package cannot import `fs`, `http`, `net`, `socket.io`, `better-sqlite3`, any LLM provider SDK, or any `packages/server` module.

## MVP Done Criteria

- Shared schemas cover simulation, channel, event, agent, emotion, pressure, inhibition, memory, intent, spectator, and operator events
- Five persona seed states validate
- Engine visibility enforces one world with many views
- Engine attention produces `needsLLM` only for meaningful events
- Engine builds safe perception packets
- Engine updates the four-layer emotion stack
- Engine computes pressure and inhibition
- Engine returns action, delay, no-op, and memory-only decisions
- Engine initiative can create action without a new message
- Engine rumination intensifies emotion without inventing evidence
- Intent validation catches invalid/unsafe intents before resolver
- Available action computation accounts for rate limits
- Emotional state translation produces natural language without numbers
- Persistence stores simulations, channels, events, agent states, and memories
- Fixture scenarios are available for all developers
- End-to-end MVP can run with mock delivery gateway, mock runtime, and real engine for 60 seconds without runaway, flatline, or unhandled errors
