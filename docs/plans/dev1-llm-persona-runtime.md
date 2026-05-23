# Developer 1 Plan: LLM / Persona Runtime

> Cross-reference: [Master Contract](./master-contract.md) for all shared types, ownership boundaries, and integration flow.

## Goal

Build persona cognition layer. Receives `AgentRuntimeInput` (assembled by dev2), combines Dev3's engine-calibration `PersonaConfig` with Dev1-owned `PersonaPromptProfile` and `LlmConfig`, creates the persona prompt using dev3's emotional language translator, calls either a local Qwen3-8B runtime or FreeLLMAPI through one OpenAI-compatible provider interface, validates structured JSON output against dev3's intent schema, tracks token budget, and returns the `ActionIntent`.

Keep the first implementation simple: no standalone LLM router is required. Provider choice comes from `input.llmConfig` or the Dev1 runtime profile resolved for the agent, not from Dev3's `PersonaConfig`.

## Architecture

```text
AgentRuntimeInput (built by dev2 from dev3 EngineStepResult)
  → PersonaLoader (combines dev3 PersonaConfig with dev1 PersonaPromptProfile)
  → PromptBuilder (uses dev3 translate-emotional-state)
  → BudgetTracker pre-check
  → LlmProvider: mock | openai-compatible
       - local_uncensored: Qwen3-8B via vLLM, llama.cpp, Ollama, or LM Studio
       - freellmapi: local FreeLLMAPI proxy for hosted-model A/B tests
  → IntentParser (extracts, repairs narrowly, validates against dev3 ActionIntent schema)
  → BudgetTracker record usage
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
- `PersonaConfig`, `AgentSeedState` — Dev3 engine calibration definitions
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
- Config provider supplies budget settings and environment secrets; per-agent provider/model choice comes from Dev1-owned `LlmConfig`

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
  persona-loader.ts             # combines PersonaConfig with PersonaPromptProfile
  persona-prompt-profile.ts     # Dev1-owned prompt identity, style examples, relationship prose
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
  llm-config.ts                 # Dev1-owned provider/model/runtime config
  llm-provider.ts               # LlmProvider interface
  mock-llm-provider.ts
  openai-compatible-provider.ts # generic client for Qwen local endpoints & FreeLLMAPI
  llm-budget.ts                 # BudgetPriority included
  llm-errors.ts
  __tests__/
    mock-llm-provider.test.ts
    llm-budget.test.ts
    openai-compatible-provider.test.ts
```

**NOT created by dev1 (resolved overlap):**
- ~~`emotional-language.ts`~~ → use `translateEmotionalState` from `@perfectman/engine`
- ~~replacement `PersonaConfig`~~ → `PersonaConfig` remains Dev3 engine calibration; Dev1 adds `PersonaPromptProfile`

## Persona And LLM Config Boundary

Dev1 must keep prompt/runtime concerns separate from Dev3's engine calibration.

```text
PersonaConfig
  owner: dev3
  purpose: engine calibration, mood baselines, thresholds, sensitivities

PersonaPromptProfile
  owner: dev1
  purpose: LLM identity, voice, style examples, relationship prose, language/slang

LlmConfig
  owner: dev1
  purpose: provider, model, temperature, max tokens, timeouts, retries, budget defaults
```

`PersonaLoader` may read Dev3's `PersonaConfig`, but only to translate calibration into natural language hints. It must not mutate, replace, or narrow `PersonaConfig`.

Suggested `PersonaPromptProfile` shape:

```typescript
type PersonaPromptProfile = {
  personaId: string;
  displayName: string;
  identityFrame: string;
  voiceGuidelines: string[];
  styleExamples: string[];
  relationshipBiases: Record<string, string>;
  language: "pt-BR" | "en";
};
```

Suggested `LlmConfig` shape:

```typescript
type LlmConfig = {
  provider: "mock" | "anthropic";
  cognitionModel: string;
  reflectionModel?: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  temperature: number;
  timeoutMs: number;
  retryCount: number;
};
```

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
8. **Output contract**: JSON only, one primary intent, include `privateMotiveSummary` (required, never empty), `intentType`, and required fields for that intent type, matching the shared `ActionIntent` schema. Use a compact schema example, not chain-of-thought or hidden reasoning.

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

## OpenAI-Compatible Provider

Same `LlmProvider` interface as mock:

```typescript
type LlmProvider = {
  generateIntent(input: AgentRuntimeInput, prompt: BuiltPrompt): Promise<LlmProviderResult>;
};
```

Behavior:
- Standard fetch client connecting to the OpenAI `/v1/chat/completions` REST endpoint.
- Instantiated from the agent's `LlmConfig`; no separate router is needed for MVP.
- Supports local Qwen3-8B endpoints from vLLM, llama.cpp/llama-server, Ollama, or LM Studio when they expose an OpenAI-compatible API.
- Supports FreeLLMAPI via `baseUrl: "http://localhost:3001/v1"` and a unified `freellmapi-...` API key.
- Configurable base URL, API key, model name, temperature, max tokens, timeout, and provider-specific `extraBody`.
- Returns raw assistant content, token usage, latency, and response headers. The provider does **not** own Zod validation.
- For FreeLLMAPI, capture `X-Routed-Via` and `X-Fallback-Attempts` when present so A/B tests can distinguish requested model from actual routed provider/model.
- Emits operator events for API failure, timeout, missing API key, rate limit, or upstream refusal. Parser/schema failures are emitted by `IntentParser` / `AgentRuntime`.

## Qwen3-8B Local Runtime Notes

Use local Qwen3-8B for persona/human-simulation calls that should not depend on hosted free-tier availability.

Recommended local serving order:

1. **vLLM** — best first target when an NVIDIA GPU is available. It exposes an OpenAI-compatible API at `/v1/chat/completions` and supports Qwen3 controls such as `chat_template_kwargs: { enable_thinking: false }` through provider-specific `extraBody`.
2. **llama.cpp / llama-server** — best portable target for GGUF quantized local runs, including CPU, Apple Silicon/Metal, and mixed CPU/GPU setups. It exposes an OpenAI-compatible API at `/v1/`.
3. **Ollama / LM Studio** — easiest manual developer setup, but JSON mode, extra body fields, and Qwen3 thinking controls must be treated as runtime-specific and verified before relying on them.

Qwen3 mode rules:

- Prefer non-thinking mode for structured `ActionIntent` generation.
- Do not prompt for chain-of-thought.
- Defensively strip or reject visible `<think>` / reasoning content before JSON parsing if a runtime exposes it in the assistant content.
- If a runtime does not support hard thinking disablement, keep prompts short, demand JSON-only output, and let parser fallback handle failures.

## FreeLLMAPI A/B Testing Notes

FreeLLMAPI is useful for experimentation, not as a reliability guarantee. When using it:

- Prefer explicit model names for clean A/B tests.
- If using `model: "auto"`, record the actual provider/model from response headers when available.
- Store requested provider/model separately from actual routed provider/model.
- Log latency, token usage, fallback attempts, parse validity, fallbackApplied, intent type, and resolver outcome.
- Treat free-tier rate limits, model catalog changes, and provider ToS changes as expected operational risks.

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

### M1: Runtime Types & Interface
- Import `ActionIntent` and `AgentRuntimeInput` from `@perfectman/shared`
- Define `BuiltPrompt`, `LlmProvider`, `LlmProviderResult`, `AgentRuntimeOutput`
- Define Dev1-owned `PersonaPromptProfile` and `LlmConfig` in the runtime/LLM layer
- Do not duplicate or replace Dev3 `PersonaConfig`; it remains engine calibration

### M2: Zod Schema Parser & Repair
- Build `IntentParser` to validate raw LLM JSON against the shared Zod schema for `ActionIntent`.
- Implement narrow JSON formatting repairs only: strip markdown code fences, trim text before/after the first JSON object, and remove trailing commas.
- Do not invent missing semantic fields during repair; if required fields are absent, fall back safely.
- Reject intents with invalid targets, unsupported intent types, or empty `privateMotiveSummary` values.

### M3: Prompt Builder
- Build all 8 sections of the prompt.
- Section 8 clearly instructs the model to follow the strict structured JSON `ActionIntent` schema contract.
- Import `translateEmotionalState` from `@perfectman/engine` for Section 4 (subjective emotions).

### M4: Mock Provider
- Deterministic fixture-based responses (using the JSON format matching the schema).
- Token usage + latency simulation.
- Verify mock outputs validate cleanly through the Zod intent parser.

### M5: OpenAI-Compatible Provider
- Implement `OpenAiCompatibleProvider` to handle standard OpenAI `/v1/chat/completions` JSON payloads.
- Support base URLs, API keys, model names, temperatures, max tokens, timeouts, and provider-specific `extraBody`.
- Select the provider directly from `input.llmConfig.providerType` or the Dev1 runtime profile resolved for the agent.
- No standalone `LlmRouter` for MVP; add one only if provider selection becomes more complex than runtime config lookup.

### M6: Runtime Orchestration & Robust Fallbacks
- Orchestrate `AgentRuntime.generateIntent()`: pre-check budget → resolve `PersonaPromptProfile` + `LlmConfig` → build prompt → create provider from `LlmConfig` → run provider → parse/repair/validate → record usage → return.
- Apply fail-safe fallback: connection errors, timeouts, invalid JSON, or schema failures automatically return a safe programmatic fallback (`delay_response` or `no_op`) rather than blocking the scheduler.

## Verification

```bash
pnpm --filter @perfectman/server test -- --grep "agent|llm"
pnpm build
```

Expected: prompt tests pass, parser tests pass, mock adapter tests pass, budget tests pass, OpenAI-compatible provider tests use mocked HTTP responses only (no network in CI).

## MVP Done Criteria

- Persona configs load for at least Goulart and Bruno, and Dev1 resolves their individual `PersonaPromptProfile` and `LlmConfig` definitions
- Prompt builder produces natural language subjective state without numbers
- Mock adapter produces deterministic valid JSON intents matching the `ActionIntent` schema
- OpenAI-compatible provider works with at least one verified local Qwen3-8B endpoint and FreeLLMAPI behind the same interface
- Token budget blocks calls cleanly
- Output parser cleanly validates JSON structures, applies repairs, and maps them to safe, structured `ActionIntent` payloads
- LLM failures and timeouts automatically fallback to safe programmatic `delay_response` or `no_op` and emit operator events
- Runtime can produce: reply, message, reaction, create private channel, delay, memory write proposal, no-op
- Runtime never mutates event log, channels, memory, or delivery gateways directly
