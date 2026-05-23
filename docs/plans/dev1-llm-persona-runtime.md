# Developer 1 Plan: LLM / Persona Runtime

> Cross-reference: [Master Contract](./master-contract.md) for all shared types, ownership boundaries, and integration flow.

## Goal

Build persona cognition layer. Receives `AgentRuntimeInput` (assembled by dev2), creates persona prompt using dev3's emotional language translator, calls LLM (mock or Anthropic), validates structured output against dev3's intent schema, tracks token budget, returns `ActionIntent`.

## Architecture

```text
AgentRuntimeInput (built by dev2 from dev3 EngineStepResult)
  → PersonaLoader (reads dev3 shared constants)
  → PromptBuilder (uses dev3 translate-emotional-state)
  → LlmProvider: mock | anthropic
  → IntentParser (validates against dev3 ActionIntent schema)
  → BudgetTracker
  → ActionIntent | safe no_op | delay
  → returned to Dev2 Event Runtime
```

## Ownership Boundary

**Own:**
- `packages/server/src/agent/` — runtime orchestration, persona loading, prompt building, intent parsing
- `packages/server/src/llm/` — LLM providers, budget tracking, model selection, error handling

**Import from dev3 (do not duplicate):**
- `ActionIntent`, `IntentType` — intent schema
- `AgentRuntimeInput` — runtime input type
- `PersonaConfig`, `AgentSeedState` — persona definitions
- `CoreMood`, `SocialEmotions`, `RelationalState`, `ActionEmotions` — emotion types
- `Pressure`, `Inhibition` — pressure/inhibition types
- `Memory` — memory type
- `PerceptionPacket` — perception type
- `OperatorEvent`, `LlmUsage` — operator/telemetry types
- `AvailableAction` — available action type
- `NoOpReason`, `DelayPreference` — decision types
- `translateEmotionalState()` — from `@perfectman/engine` (pure function)

**Consume from dev2 (event runtime):**
- Event runtime scheduler calls `AgentRuntime.generateIntent(input)` passing assembled `AgentRuntimeInput`
- Operator projection receives LLM failure events
- Config provider supplies `LLM_PROVIDER`, model names, budget settings

**Provide to dev2:**
- `AgentRuntime.generateIntent(input: AgentRuntimeInput): Promise<AgentRuntimeOutput>`
- `LlmBudget.canCall(request): LlmBudgetDecision`
- `LlmBudget.recordUsage(usage): void`
- `LlmBudget.getStatus(simulationId): LlmBudgetStatus`
- `LlmBudget.getPriority(simulationId, agentId): BudgetPriority`
- Mock provider for integration tests without network

## Files To Create

```
packages/server/src/agent/
  agent-runtime.ts
  agent-runtime.types.ts        # BuiltPrompt, AgentRuntimeOutput, LlmProviderResult
  persona-loader.ts             # reads PersonaConfig from @perfectman/shared constants
  prompt-builder.ts             # builds 8-section prompt, imports translateEmotionalState from engine
  intent-parser.ts              # validates LLM JSON output against shared ActionIntent schema
  fixtures/
    goulart-cold-start.ts
    bruno-exclusion.ts
  __tests__/
    prompt-builder.test.ts
    intent-parser.test.ts

packages/server/src/llm/
  index.ts
  llm-provider.ts               # LlmProvider interface
  mock-llm-provider.ts
  anthropic-llm-provider.ts
  llm-budget.ts                 # BudgetPriority included
  llm-errors.ts
  model-selector.ts
  __tests__/
    mock-llm-provider.test.ts
    llm-budget.test.ts
    anthropic-llm-provider.test.ts
```

**NOT created by dev1 (resolved overlap):**
- ~~`emotional-language.ts`~~ → use `translateEmotionalState` from `@perfectman/engine`

## Runtime Output Contract

```typescript
type AgentRuntimeOutput = {
  intent: ActionIntent;             // validated intent or safe fallback
  tokenUsage: LlmUsage;
  latencyMs: number;
  fallbackApplied: boolean;         // true if parse/API failure caused fallback
  operatorEvents: OperatorEvent[];  // LLM failures, budget blocks, parse errors
};
```

## Prompt Design

### 8 Sections

1. **Persona identity**: name, archetype, writing style, relationship biases, style examples, human channel-chat framing
2. **What agent noticed**: triggering event, visible surrounding messages, involved people, public/private context
3. **Social interpretation**: plausible meanings, uncertainty, silence/delay/mention/exclusion signals — from `EngineStepResult.interpretations`
4. **Subjective emotional state**: natural language only via `translateEmotionalState()` from `@perfectman/engine` — **no raw scores**
5. **Pressures and inhibitions**: written as felt urges and blocks — **no numeric intensity**
6. **Relevant memories**: short biased summaries, only agent-visible memories
7. **Available actions**: action menu from `AgentRuntimeInput.availableActions` — model cannot create unsupported actions
8. **Output contract**: JSON only, one primary intent, include `privateMotiveSummary`, delay/fallback fields

### Hard Exclusions (never in prompt)

Tick number, scheduler due score, raw attention/pressure/inhibition scores, other agents' motive summaries, spectator narration, operator debug data, chain-of-thought, private channels agent is not in.

## Emotional Language Translation

Dev1 imports `translateEmotionalState()` from `@perfectman/engine` (dev3 owns).

Examples:
```text
CoreMood: valence -0.2, arousal 0.65
→ "You feel tense and watchful, not openly angry, but not relaxed."

Pressure: urgeToReply high, inhibition fearOfLookingNeedy high
→ "You want to answer, but part of you worries it would look too eager."
```

Rules: short subjective sentences, preserve ambiguity, never leak numbers, never spectator-style narration.

## Mock LLM Provider

Deterministic by `agentId` + event type + top pressure. Required for dev2/dev3 integration without network.

Fixtures:
- Goulart alone + boredom → casual opener
- Bruno sees Caio reply to Goulart but not Bruno → react/delay/no_op by inhibition
- High reply pressure + high shame → emoji or delay
- Overwhelming inhibition → no-op with meaningful motive summary
- Private-channel motive → `create_channel` with gossip/comfort/repair/etc motive

Mock behavior:
- Returns valid `ActionIntent` every time
- Simulates token usage
- Simulates latency with configurable delay
- Supports budget tests without external API

## Anthropic Adapter

Same `LlmProvider` interface as mock:

```typescript
type LlmProvider = {
  generateIntent(input: AgentRuntimeInput, prompt: BuiltPrompt): Promise<LlmProviderResult>;
};
```

Behavior:
- Uses `ANTHROPIC_API_KEY`
- Sonnet for agent cognition, Opus for reflection/recap (future scope)
- Enforces max tokens per call
- Reports input/output token usage
- Retries transient API failures with bounded backoff
- One schema repair retry for invalid JSON
- Returns safe `no_op` or `delay_response` after repair failure
- Emits operator event for API failure, refusal, timeout, invalid JSON, budget block

## Token Budget

```typescript
type LlmBudget = {
  canCall(request: LlmBudgetRequest): LlmBudgetDecision;
  recordUsage(usage: LlmUsage): void;
  getStatus(simulationId: string): LlmBudgetStatus;
  getPriority(simulationId: string, agentId: string): BudgetPriority;
};

type BudgetPriority = 'high' | 'normal' | 'low' | 'blocked';
```

Dev2 event runtime scheduler calls `getPriority()` → passes into `AgentRuntimeInput.budgetPriority`.
Dev1 checks `canCall()` before LLM invocation.

Budget rules:
- Check budget before each call
- Track calls per simulation + per agent
- Track input/output tokens
- Track remaining calls/tokens per window
- Prefer high-salience attention events over low-priority initiative when constrained
- When exhausted: return controlled delay/no-op + emit operator budget event

## Error Handling

Every failure → safe structured result. The event runtime scheduler never crashes from LLM failure.

Failure cases: missing API key, timeout, rate limit, refusal, invalid JSON, schema-invalid JSON, unsupported intent type, hidden target in output, budget exhausted.

Fallback: prefer `delay_response` when social context can wait, `no_op` when unsafe/invalid/exhausted. Include operator-visible failure reason. Never include failure details in agent chat.

## Implementation Milestones

### M1: Runtime Types + Parser
- Import `ActionIntent` and `AgentRuntimeInput` from `@perfectman/shared`
- Define `BuiltPrompt`, `LlmProvider`, `LlmProviderResult`, `AgentRuntimeOutput`
- Zod validation wrapping shared intent schema
- Parse valid/invalid JSON, reject unsupported intent types, reject missing `privateMotiveSummary`

### M2: Prompt Builder
- Build all 8 sections
- Import `translateEmotionalState` from `@perfectman/engine` for section 4
- Test: no raw scores, no hidden fields, triggering event present, only allowed actions

### M3: Mock Provider
- Deterministic fixture-based responses
- Token usage + latency simulation
- All mock outputs validate through parser

### M4: Budget Tracker
- Simulation-level call window + per-agent counts + token accounting
- `getPriority()` for dev2 scheduler
- Priority-aware budget decisions
- Budget-exhausted fallback

### M5: Anthropic Provider
- Same `LlmProvider` interface as mock
- Sonnet for cognition, Opus for reflection/recap (future)
- Timeout, transient retry, schema repair retry, safe fallback

### M6: Runtime Orchestration
- `AgentRuntime.generateIntent()` — pre-check budget → build prompt → call provider → parse → record usage → return

## Verification

```bash
pnpm --filter @perfectman/server test -- --grep "agent|llm"
pnpm build
```

Expected: prompt tests pass, parser tests pass, mock adapter tests pass, budget tests pass, Anthropic adapter tests use mocked API (no network in CI).

## MVP Done Criteria

- Persona configs load for at least Goulart and Bruno
- Prompt builder produces natural language subjective state without numbers
- Mock adapter produces deterministic valid intents
- Anthropic adapter works behind same interface
- Token budget blocks calls cleanly
- Invalid model output never reaches resolver
- LLM failures become operator events
- Runtime can produce: reply, message, reaction, create private channel, delay, memory write proposal, no-op
- Runtime never mutates event log, channels, memory, or delivery gateways directly
