# Dev3 — Implementation Notes

**Branch:** `dev3/domain-engine-integration` → merged to `main`
**Tests:** 263 passing (216 engine + 47 server)
**Packages touched:** `@perfectman/shared`, `@perfectman/engine`, `@perfectman/server`

---

## What Was Built

Three packages delivered a complete, self-contained domain engine — pure functional logic, no sockets, no LLM calls, no HTTP. The boundary is enforced by a lint rule and a no-io boundary test.

---

## 1. `@perfectman/shared` — Domain Types + Constants + Fixtures

### Type System (`src/`)

Every concept in the domain has a dedicated type file. No god-objects. Types are split into domain subdirectories:

| Path | What it defines |
|---|---|
| `agent/agent.types.ts` | `AgentState`, `PersonaConfig`, presence states |
| `channel/channel.types.ts` | `Channel`, `ChannelMembership`, channel type union |
| `emotion/emotion.types.ts` | `CoreMood`, `SocialEmotions`, `RelationalState`, `EmotionalState` |
| `event/event.types.ts` | `SimulationEvent`, `CommittedEvent`, `EventType` (23 variants), `EmotionalSalience` |
| `decision/decision.types.ts` | `Decision`, `DecisionOutcome`, `NoOpRecord`, `NoOpReason` |
| `engine/engine.types.ts` | `EngineSnapshot`, `EngineStepResult`, `WorldSignals`, `RateLimitStatus` |
| `intent/intent.types.ts` | `AgentIntent`, `IntentType` (10 variants) |
| `interpretation/interpretation.types.ts` | `Interpretation`, `InterpretationSignalType` (6 types) |
| `memory/memory.types.ts` | `Memory`, `MemoryType` (6 variants) |
| `motivation/motivation.types.ts` | `Motivation`, `MotivationType` (17 variants) |
| `pressure/pressure.types.ts` | `Pressure`, `PressureType`, `PressureIntensity` |
| `inhibition/inhibition.types.ts` | `Inhibition`, `InhibitionType`, `InhibitionStrength` |
| `initiative/initiative.types.ts` | `InitiativeAccumulator`, `InitiativeCandidate`, `InitiativeSource` (17 sources) |
| `perception/perception.types.ts` | `PerceptionPacket` |
| `action/action.types.ts` | `AvailableAction` |
| `visibility/visibility.types.ts` | `EventVisibility` |
| `operator/operator.types.ts` | `OperatorMetrics`, `StagnationMetrics`, `StagnationLevel` |
| `simulation/simulation.types.ts` | `Simulation`, `SimulationSettings`, `SimulationStatus` |
| `attention/attention.types.ts` | `AttentionResult` |
| `spectator/spectator.types.ts` | Spectator-facing types |

### Runtime Constants (`src/constants/`)

- **`personas.ts`** — 5 canonical `PersonaConfig` objects: `GOULART`, `BRUNO`, `CAIO`, `MARIANA`, `LEO` plus `ALL_PERSONAS` array and `getPersonaById`. Each persona has archetype, writing style, baseline mood values, social tendencies, and personality dimensions (openness, conscientiousness, extraversion, agreeableness, neuroticism).
- **`emotion-rules.ts`** — Interaction matrices: which events trigger which social emotion deltas, mood decay constants, rumination factors.
- **`stagnation.ts`** — `STAGNATION_THRESHOLDS` (normal/yellow/red/critical), `STAGNATION_WEIGHTS` (per metric), `ATTRACTOR_THRESHOLDS`, `ATTRACTOR_DETECTION_WINDOW_PULSES`.
- **`circumplex.ts`** — Russell circumplex angle/radius math helpers.
- **`action-pressure-map.ts`** — Maps `IntentType` → expected `PressureType` for validation.

### Utilities (`src/utils/`)

- **`rng.ts`** — `createSeededRng(seed: number): () => number` — mulberry32 PRNG. Pure, deterministic, reproducible across tests.
- **`math.ts`** — `clamp(v, min, max)`, `meanOf(arr)`, `lerp(a, b, t)`.
- **`id.ts`** — Lightweight monotonic ID generator (no external deps).

### Zod Schemas (`src/*/schema.ts`)

Validation schemas for: `SimulationEvent`, `AgentIntent`, `AgentState`, `Channel`, `Simulation`. Used by Dev1 at LLM-output boundaries to catch hallucinated fields before they reach the engine.

### Fixtures (`src/fixtures/`)

8 scenario builders + shared helpers, all exported from `@perfectman/shared`. Each returns a fully-typed snapshot ready for `runEngineStep`.

| Builder | Scenario | Key state |
|---|---|---|
| `buildSimulationFixture()` | 5 agents in #geral, neutral baseline | All agents active, no events |
| `buildFivePersonaSeedFixture()` | Same fixture, returns per-persona entries | Used for multi-agent iteration |
| `buildGoulartColdStartScenario()` | Empty channel, goulart bored | `boredom_accumulator.value = 0.75 > threshold 0.6`, others offline |
| `buildBrunoCaioExclusionScenario()` | Caio replies to Goulart, ignoring Bruno | Bruno `fearOfExclusion: 0.2`, Caio reply event with no Bruno target |
| `buildPrivateChannelMotiveScenario()` | Mariana wants private channel | `desireForIntimacy` elevated, `attraction` and `comfort` toward Caio |
| `buildDelayedReplyScenario()` | Leo's message 4min unanswered | `socialAnxiety: 0.2`, `timeSinceLastPublicMessage: 240` |
| `buildNoOpInhibitionScenario()` | Bruno publicly mocked | `shame: 0.85`, `humiliation: 0.75`, `valence: -0.8` |
| `buildBiasedMemoryScenario()` | Goulart has mixed memories of Caio | 2 positive episodic, 2 negative emotional_residue/social_theory, same timestamp |

**`fixtures/helpers.ts`** — factory functions used by all builders: `makeAgentState`, `makeRelationalState`, `makeCommittedEvent`, `makePublicChannel`, `makePrivateChannel`, `membershipFor`, `makeSimulation`, `makeMemory`.

---

## 2. `@perfectman/engine` — Pure Domain Engine

**Hard rule:** zero imports from `fs`, `http`, `net`, `socket.io`, `better-sqlite3`, or any LLM SDK. Enforced by `no-io-boundary.test.ts` which walks `node_modules` imports on the compiled output.

### Engine Step — `src/step/run-engine-step.ts`

Single entry point: `runEngineStep(snapshot: EngineSnapshot): EngineStepResult`

14 sequential stages per agent per pulse:

```
1.  Extract new events (since lastProcessedEventId)
2.  Visibility filter (agent's channel memberships + visibleToAgents list)
3.  Update initiative accumulators (growth/decay, pre-emotion)
4.  Attention scoring (due score, needs LLM flag)
5.  Interpretation (programmatic social signal detection)
6.  Emotion stack update (core mood, social, relational, action emotions, rumination)
7.  Motivation derivation (from emotional state → MotivationType goals)
8.  Pressure computation (action urges from motivations + interpretations)
9.  Inhibition computation (blocking forces from social emotions + rules)
10. Available actions (filtered by rate limits, channel membership, settings)
11. Initiative candidates (score accumulators against thresholds)
12. Decision resolution (pressures vs inhibitions → outcome + needsLLM)
13. Build perception packet (context events + memories for LLM prompt)
14. Assemble updated AgentState + OperatorMetrics
```

### Visibility — `src/visibility/filter-visible-events.ts`

Three filter functions:
- `filterVisibleEventsForAgent(events, agentId, channels, membership)` — must be channel member + pass `visibleToAgents` list check
- `filterVisibleEventsForSpectator(events, channels, settings)` — `visibleToSpectators: true` + channel `spectatorVisible: true` (unless omniscient mode)
- `filterVisibleEventsForOperator(events)` — identity filter on `visibleToOperators: true`

Private channel events are invisible to non-members at the membership level, before any `visibleToAgents` check.

### Emotion Stack — `src/emotion/`

Four modules applied in sequence inside `update-emotion-stack.ts`:

1. **`update-core-mood.ts`** — valence/arousal/stability/energy decay toward persona baseline + event-driven deltas + momentum carry-over. Circumplex angle/radius derived from valence+arousal.
2. **`update-social-emotions.ts`** — 15 social emotion dimensions updated from recent events. Discrete event-type triggers with persona-weighted multipliers.
3. **`update-relational-emotions.ts`** — per-target `RelationalState` updated from direct interactions. Trust, affection, resentment, suspicion, threat, curiosity, etc.
4. **`compute-action-emotions.ts`** — 15 action emotion dimensions (`defensiveness`, `warmth`, `jealousInspection`, `shameWithdrawal`, `resentfulColdness`, etc.) computed from emotional state. These modulate initiative growth and LLM tone hints.
5. **`apply-rumination.ts`** — valence adjustment loop when negative mood + high arousal; simulates stuck negative thoughts decaying slowly.

### Attention — `src/attention/score-attention.ts`

Produces `AttentionResult.dueScore` (urgency to act) from: recency of last action, new event count, world signals (channel rate, arousal nearby), initiative accumulator scores, persona reactivity. `needsLLM = true` when due score crosses threshold.

### Interpretation — `src/interpretation/interpret-programmatic-signals.ts`

6 programmatic signal types (no LLM, no text parsing):
- `mention_ignored` — agent was mentioned, conversation moved on without reply
- `reply_latency` — reply to agent came >5 pulses late
- `public_silence` — no public messages for >120s (world signal)
- `public_private_asymmetry` — someone active in DMs but silent publicly
- `reaction_instead_of_text` — reaction used where text was expected
- `topic_shift` — MVP stub, always false

Each returns an `Interpretation` with natural-language `description` preserving ambiguity — never forced certainty.

### Motivation — `src/motivation/derive-motivations.ts`

Maps emotional state to active `Motivation[]`. 17 motivation types: `seek_connection`, `seek_validation`, `assert_dominance`, `repair_relationship`, `seek_privacy`, `express_creativity`, `resolve_conflict`, `protect_status`, `seek_intimacy`, `process_shame`, `seek_excitement`, `punish_rival`, `test_loyalty`, `escape_situation`, `seek_comfort`, `observe_safely`, `express_authenticity`. Derived from thresholds on social emotions + relational states.

### Pressures & Inhibitions — `src/pressure/`, `src/inhibition/`

**`compute-pressures.ts`** — 15 urge types (`urge_to_reply`, `urge_to_message`, `urge_to_defend_self`, `urge_to_create_private_channel`, `urge_to_withdraw`, etc.) with intensities (`low | medium | high | overwhelming`). Derived from motivations, interpretations, and action emotions. RNG used for stochastic tie-breaking.

**`compute-inhibitions.ts`** — 14 block types (`fear_of_looking_needy`, `fear_of_rejection`, `shame_about_desire`, `social_anxiety_block`, `status_protection`, `conflict_avoidance`, `vulnerability_guard`, etc.) with strengths (`low | medium | high`). Derived from social emotions and persona traits.

### Decision — `src/decision/resolve-decision.ts`

`resolveDecision(pressures, inhibitions, agentState, persona, hasNewEvents, initiativeProceed, pulseIndex)` → `Decision`

Resolution logic:
1. No pressures + no initiative → `no_op` (`waited_for_someone_else`)
2. No pressures + initiative → `act` (initiative-driven, `needsLLM: true`)
3. Overwhelming `urge_to_withdraw` alone → `memory_only`
4. Top inhibition strength ≥ top pressure intensity → delay or no_op (depends on inhibition type)
5. Otherwise → `act`, `needsLLM: true`

Decision propagates `initiativeProceed` flag through most paths; only hard inhibition wins zero it out.

### Initiative Accumulators — `src/initiative/update-initiative-accumulators.ts`

17 initiative sources accumulate per-pulse. Each source has `growthRate`, `decayRate`, `threshold`. Growth = `(growthRate + emotionBoost) * energy`. Decay on `justActed`. Cooldown of 5 pulses after firing.

Key sources: `boredom_accumulator`, `cold_start_bootstrap` (threshold 0.30, fast growth), `reply_pressure`, `exclusion_response`, `secrecy_motive`.

### Available Actions — `src/action/compute-available-actions.ts`

`computeAvailableActions(agentState, channels, membership, settings, rateLimitStatus)` → `AvailableAction[]`

Each action has a `blocked: boolean` with a `blockedReason`. Rate-limit checks applied: `messagesThisMinute`, `privateChannelsCreated`, `blocked` flag. Private channel creation blocked when `allowPrivateChannels: false` or limit reached.

### Perception Packet — `src/perception/build-perception-packet.ts`

Assembles context for LLM prompt assembly (done by Dev1):
- `visibleContextEvents` — last 10 visible events, excluding operator/spectator-only types, excluding current triggeringEvent
- `relevantMemories` — up to 8 memories, prioritized by involved people then recency
- `involvedPeople` — actor of triggering event + mentions + reply targets
- `relevantChannels` — channel IDs agent is member of
- `currentEmotionalState` — translated emotional state

**Security:** `OPERATOR_EVENT_TYPES` = `{operator_warning, llm_failure, stagnation_detected, private_motive_summary}` — all stripped before reaching context window.

### Prompt Translation — `src/prompt/translate-emotional-state.ts`

Converts numeric emotional state to natural language with a hard no-decimals contract. 5 sections:

- `moodDescription` — valence + arousal in first-person subjective language
- `socialContext` — up to 3 salient social emotions as felt sentences
- `relationalFlavors[]` — per-target relationship description, max 5
- `pressureDescriptions[]` — each pressure as a felt urge
- `inhibitionDescriptions[]` — each inhibition as a felt block

All template strings are hand-written to preserve ambiguity and avoid clinical/numeric framing.

### Health / Stagnation — `src/health/compute-stagnation-metrics.ts`

`computeStagnationMetrics(simulationId, pulseIndex, recentEvents, agentStates)` → `StagnationMetrics`

7 metrics, all `[0, 1]` where 1 = most stagnant:

| Metric | What it measures |
|---|---|
| BDI | Behavioral Diversity Index — event type spread |
| RDV | Relational Drift Variance — trust value variance across relationships |
| IGE | Initiative Gap Entropy — initiative source concentration |
| CUE | Channel Utilization Entropy — message channel concentration |
| ERI | Emotional Range Index — valence/arousal variance across agents |
| ISD | Intent Success Diversity — variety of action types |
| CNS | Conversation Novelty Score — actor repetition in recent window |

Composite = weighted sum. Levels: `normal < 0.35`, `yellow < 0.55`, `red < 0.70`, `critical ≥ 0.70`.

`detectAttractorStates(recentEvents, agentStates)` → string[] — detects: `message_loop`, `silence_cascade`, `dormant_agents`, `private_channel_flood`, `reaction_only`.

### Intent Validation — `src/intent/`

- **`validate-intent.ts`** — `validateIntentPure(intent, agentState, channels, membership, settings)` → pure validation, no side effects. Checks channel membership, blocked actions, payload required fields.
- **`rate-limit-rules.ts`** — `checkRateLimitPure(intent, status, settings)` → checks messages per minute, private channel creation cap.

---

## 3. `@perfectman/server` — SQLite Persistence

### Repository Interfaces — `src/persistence/repositories.ts`

5 interfaces that Dev2 also implements (in-memory) for dev/test:
- `IEventRepository` — append-only event log with cursor-based reads
- `IAgentStateRepository` — upsert + list by simulation
- `IMemoryRepository` — upsert + query by agent or subject
- `ISimulationRepository` — create/get/updateStatus/updateSettings/list
- `IChannelRepository` — create/get/list/updateMembers/archive/membership CRUD

### SQLite Schema — `src/persistence/sqlite/schema.ts`

6 tables: `simulations`, `channels`, `channel_memberships`, `events`, `agent_states`, `memories`

Key design choices:
- All JSON blobs stored as `TEXT` columns (SQLite has no native JSON type for TypeScript-safe round-trip)
- `Map<string, RelationalState>` serialized as `[[key, value], ...]` JSON tuples, deserialized with `new Map(JSON.parse(...))`
- Foreign keys enabled with `PRAGMA foreign_keys = ON`, WAL mode with `PRAGMA journal_mode = WAL`
- Cascade deletes: simulation → events, agent_states, memories, channels
- Indexes on `events(simulation_id)`, `events(created_at)`, `events(pulse_index)`, `memories(agent_id, simulation_id)`

### SQLite Implementations

**`event-repository.ts`**
- `append`: monotonic ID generation (`evt_{timestamp}_{counter}`), pulseIndex = `MAX(existing) + 1` per simulation, pre-committed `id`/`createdAt` preserved if provided, wrapped in a SQLite transaction
- `getAfter`: cursor uses `(created_at, id)` composite ordering for stability when multiple events share a timestamp
- `getRecent`: fetches DESC with LIMIT, reverses for ascending order on return
- Single prepared statement for inserts (compiled once in constructor)

**`agent-state-repository.ts`**
- `INSERT OR REPLACE` (upsert) on `(agent_id, simulation_id)` primary key
- `relationalStates` serialized/deserialized as `[string, RelationalState][]` tuples

**`memory-repository.ts`**
- `getBySubject` uses `json_each(subject_agent_ids)` to query inside JSON arrays without full table scan

**`channel-repository.ts`**
- `removeMembership` sets `left_at` timestamp rather than deleting the row (preserves history)

**`simulation-repository.ts`**
- `updateSettings` is a read-modify-write: fetches current settings JSON, merges partial update, writes back atomically

### Database Helper — `src/persistence/sqlite/database.ts`

```ts
openDatabase(path: string): DB   // runs schema on first connection
closeDatabase(db: DB): void
```

`:memory:` path for tests; file path for production.

---

## 4. Test Suites

### Engine Tests (216 total)

| File | Tests | What it covers |
|---|---|---|
| `engine-step.test.ts` | 14 | Full `runEngineStep` pipeline, edge cases |
| `scenarios.test.ts` | 22 | Each fixture → engine step → expected signal assertions |
| `multi-pulse.test.ts` | 4 | 10-pulse loop × 5 agents, emotion bounds + stagnation |
| `visibility-security.test.ts` | 18 | Private channel isolation, `visibleToAgents` precision, spectator/operator boundaries |
| `no-prompt-leak.test.ts` | 12 | No decimal numbers in LLM translation, no operator events in perception packet, `visibleToAgents` respected |
| `visibility.test.ts` | 20 | Standard visibility cases, `getNewEventsSince` cursor logic |
| `decision.test.ts` | 20 | Every decision code path, `anyInitiativeProceed` |
| `emotion-stack.test.ts` | 15 | `updateCoreMood`, social + relational emotion updates, bounds |
| `attention.test.ts` | 10 | `scoreAttention` output range, `needsLLM` threshold |
| `pressure-inhibition.test.ts` | 19 | Pressure/inhibition derivation, intensity/strength correctness |
| `available-actions.test.ts` | 11 | Rate limit blocks, channel membership blocks, private channel cap |
| `stagnation.test.ts` | 11 | All 7 metrics, composite score, attractor detection |
| `translate-emotional-state.test.ts` | 15 | No-decimal contract, empty states, all pressure/inhibition types |
| `validate-intent.test.ts` | 22 | Intent validation, rate limit rules |
| `no-io-boundary.test.ts` | 3 | Static import walk — confirms zero fs/net/socket/sqlite imports |

### Server Tests (47 total)

| File | Tests | What it covers |
|---|---|---|
| `sqlite-repositories.test.ts` | 47 | Round-trip for all 5 repositories using `:memory:` DB, FK cascades, cursor ordering |

### Contract Factory (0 tests, exports only)

`src/persistence/__tests__/repository-contract.ts` — exports `runEventRepositoryContract`, `runAgentStateRepositoryContract`, `runMemoryRepositoryContract`, `runSimulationRepositoryContract`, `runChannelRepositoryContract`. Dev2 imports these to validate in-memory implementations against the same behavioral spec.

---

## 5. Key Design Decisions

**No numeric values in LLM context.** `translateEmotionalState` converts all floats to natural language before they reach the prompt. The no-prompt-leak test enforces this with a `/\b-?\d+\.\d+\b/` regex assertion on all output strings.

**Append-only events.** `CommittedEvent` is immutable after append. Agent state is derived forward, never back-patched. Cursor-based reads (`getAfter`) make replay cheap.

**Visibility is structural, not inferential.** Event visibility is set at creation time by the emitter (`visibilityReason`, `visibleToAgents`, `visibleToSpectators`, `visibleToOperators`). Filters are pure predicates — no access control logic lives in the engine step.

**Pure engine boundary.** `runEngineStep` takes a snapshot (immutable) and returns a result (new agent state + metrics). No mutation, no I/O. This makes the engine testable without any infrastructure and safe to call in parallel.

**Deterministic RNG.** All stochastic behavior (`computePressures` tie-breaking, `resolveDecision` jitter) routes through `createSeededRng(seed)`. Tests pass `createSeededRng(42)` for reproducibility.

**Map serialization.** `RelationalState` is keyed by `targetAgentId` in a `Map<string, RelationalState>`. SQLite can't store Maps natively; they serialize as `JSON.stringify([...map.entries()])` and deserialize with `new Map(JSON.parse(...))`.

**TypeScript project references.** `@perfectman/engine` and `@perfectman/server` reference `@perfectman/shared` via `composite: true` + `references: [{path: "../shared"}]`. This prevents `rootDir` violations when imports cross package boundaries and enables incremental builds.

---

## 6. What Dev1 and Dev2 Plug Into

**Dev1 (LLM persona runtime):**
- Import `runEngineStep` — already returns `perceptionPacket`, `translatedEmotionalState`, `motivations`, `decision.needsLLM`
- Import `translateEmotionalState` if prompt sections need re-rendering outside the step
- Import `validateIntentPure` + `checkRateLimitPure` to validate LLM output before committing
- Import Zod schemas (`intent.schema.ts`, `event.schema.ts`) for LLM output parsing

**Dev2 (WebSocket runtime):**
- Import `IEventRepository`, `IAgentStateRepository`, etc. from `repositories.ts` for in-memory stores
- Import `runEventRepositoryContract` etc. from `repository-contract.ts` to test them
- Import `filterVisibleEventsForAgent/Spectator/Operator` for Socket.IO room routing
- SQLite implementations in `src/persistence/sqlite/` are ready to swap in for production
