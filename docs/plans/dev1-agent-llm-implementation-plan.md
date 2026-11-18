# Dev1 Agent + LLM Runtime Implementation Plan

## Scope

Implement the Dev1 persona cognition runtime in `packages/server/src/agent/` and `packages/server/src/llm/`.

This plan implements the docs in [`dev1-llm-persona-runtime.md`](./dev1-llm-persona-runtime.md) without changing Dev3's `PersonaConfig` ownership. Dev1 owns prompt/runtime persona data and provider config separately.

## Current State

Already available:

- `AgentRuntimeInput` in `@perfectman/shared`.
- `ActionIntentSchema` in `@perfectman/shared`.
- `OperatorEvent` and `LlmUsage` in `@perfectman/shared`.
- `PerceptionPacket.translatedEmotionalState` in `@perfectman/shared`.
- Dev3 engine tests/build passing.

Current Dev1 progress:

- M1 runtime/provider types exist under `packages/server/src/agent/` and `packages/server/src/llm/`.
- M2 `IntentParser` exists and validates raw LLM JSON against `ActionIntentSchema` with narrow repair/fallback behavior.
- M3 `PersonaPromptProfile` and `PersonaLoader` exist with initial Vasco/Dario profiles and mock `LlmConfig` defaults.

Not implemented yet:

- Prompt building.
- Mock provider.
- Budget tracker.
- OpenAI-compatible provider.
- Runtime orchestration/fallback telemetry.

## Key Design Decisions

1. **No standalone LLM router for MVP**
   - Resolve a Dev1-owned `LlmConfig` for the agent.
   - Select `mock` or `openai-compatible` directly from `LlmConfig.providerType`.

2. **Do not mutate Dev3 `PersonaConfig`**
   - `PersonaConfig` remains engine calibration.
   - `PersonaPromptProfile` is Dev1-owned prompt identity/style data.
   - `LlmConfig` is Dev1-owned provider/runtime config.

3. **Use runtime context instead of changing `AgentRuntimeInput`**
   - `LlmUsage` and `OperatorEvent` require `pulseIndex`.
   - Add Dev1-owned `AgentRuntimeContext`:

```ts
type AgentRuntimeContext = {
  pulseIndex: number;
  now: number;
};
```

Runtime signature:

```ts
generateIntent(
  input: AgentRuntimeInput,
  context: AgentRuntimeContext,
): Promise<AgentRuntimeOutput>;
```

4. **Use native `fetch` for OpenAI-compatible provider**
   - No SDK dependency for MVP.
   - Easier to support vLLM, llama.cpp, Ollama, LM Studio, and FreeLLMAPI variants.

5. **Provider returns raw content; parser owns validation**
   - Provider handles HTTP, timeout, retries, usage, and headers.
   - `IntentParser` owns JSON extraction, narrow repair, Zod validation, target checks, and safe fallback.

6. **Persona source data uses a simple hybrid architecture**
   - `PersonaPromptProfile` stays small, typed, deterministic, and prompt-ready.
   - Rich persona material lives separately as committed Markdown/source docs, not as raw runtime prompt input.
   - Characters are fictional; source docs never describe real people.
   - Source material distinguishes self-perception, peer perception, and observed chat evidence.
   - Relationship biases in the runtime profile are from the agent's perspective, informed by self-interviews, peer testimonials, and sanitized chat evidence.

## Target Files

```text
packages/server/src/agent/
  agent-runtime.ts
  agent-runtime.types.ts
  persona-loader.ts
  persona-prompt-profile.ts
  prompt-builder.ts
  intent-parser.ts
  fixtures/
    vasco-cold-start.ts
    dario-exclusion.ts
  __tests__/
    prompt-builder.test.ts
    intent-parser.test.ts
    agent-runtime.test.ts

packages/server/src/llm/
  index.ts
  llm-config.ts
  llm-provider.ts
  mock-llm-provider.ts
  openai-compatible-provider.ts
  llm-budget.ts
  llm-errors.ts
  __tests__/
    mock-llm-provider.test.ts
    openai-compatible-provider.test.ts
    llm-budget.test.ts
```

Also update:

```text
packages/server/src/index.ts
```

## Persona Source Architecture

Keep three layers separate:

1. **Self-perception source** — what the target says about themselves: how they think they act, how they think others read them, what they hide, what triggers them, how they repair tension, and how they differ in public vs private.
2. **Peer-perception source** — what each friend says about the target: biases, relationship-specific dynamics, emotional tells, silence patterns, conflict/repair behavior, affection, jealousy/exclusion, and chat examples.
3. **Runtime prompt profile** — the compact `PersonaPromptProfile` used by Dev1 prompt builder.

`PersonaPromptProfile` should answer: "What does the LLM need right now to act as this agent in chat?" It should not answer: "What is every known fact, quote, testimonial, and contradiction about this person?"

Rules:

- These files describe fictional characters only.
- Sanitize or paraphrase examples by default.
- Exclude addresses, phone numbers, secrets, medical/legal/financial details, and private facts that should not affect simulation behavior.
- Do not load full Markdown files into the runtime prompt.
- Manually summarize source material into `PersonaPromptProfile` until there is enough repeated work to justify a compiler.
- Avoid a Markdown parser, testimonial schema, database, or ingestion pipeline for now.

## Contract Sketch

### Runtime types

```ts
type AgentRuntimeContext = {
  pulseIndex: number;
  now: number;
};

type BuiltPrompt = {
  system: string;
  user: string;
  inputTokensEstimate: number;
};

type AgentRuntimeOutput = {
  intent: ActionIntent;
  llmUsage: LlmUsage | null;
  latencyMs: number;
  fallbackApplied: boolean;
  operatorEvents: OperatorEvent[];
};
```

### LLM config

```ts
type LlmConfig = {
  providerType: "mock" | "ollama" | "openai-compatible";
  baseUrl?: string;
  apiKeyEnv?: string;
  modelName: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  temperature: number;
  timeoutMs: number;
  retryCount: number;
  extraBody?: Record<string, unknown>;
};
```

### Provider result

```ts
type LlmProviderResult = {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  latencyMs: number;
  model: string;
  responseHeaders?: Record<string, string>;
  requestedModel?: string;
  routedModel?: string;
  fallbackAttempts?: number;
};
```

## Milestones

### M1 — Runtime and provider types

Create type files only.

Acceptance:

- Server package builds.
- Types import from `@perfectman/shared` only where needed.
- No new runtime behavior yet.

### M2 — IntentParser

Implement `IntentParser`.

Responsibilities:

- Strip markdown code fences.
- Trim content before/after first JSON object.
- Remove trailing commas.
- Parse JSON.
- Validate with `ActionIntentSchema`.
- Reject empty `privateMotiveSummary`.
- Reject targets not present in `availableActions`.
- Produce safe fallback intent for invalid output.

Acceptance:

- Valid JSON parses.
- Fenced JSON parses.
- Prefixed/suffixed JSON parses.
- Missing required fields fallback.
- Invalid hidden target fallback.
- Empty `privateMotiveSummary` fallback.

### M3 — PersonaPromptProfile and PersonaLoader

Implement Dev1-owned profiles/config lookup.

Responsibilities:

- Define `PersonaPromptProfile`.
- Provide initial profiles for at least Vasco and Dario.
- Resolve profile by `personaId`.
- Resolve `LlmConfig` by agent/persona with safe mock defaults.
- Never mutate or replace `PersonaConfig`.

Acceptance:

- Vasco and Dario resolve.
- Unknown persona falls back to a safe generic profile or explicit typed error handled by runtime.
- LLM config defaults to mock unless configured otherwise.

### M4 — PromptBuilder

Implement 8-section prompt.

Inputs:

- `AgentRuntimeInput`.
- `PersonaPromptProfile`.
- `LlmConfig`.

Must use:

- `input.perceptionPacket.translatedEmotionalState` for subjective emotions and felt pressures/inhibitions.
- `input.availableActions` as the allowed action menu.

Must exclude:

- Raw numeric attention/pressure/inhibition/mood scores.
- Scheduler due score.
- Operator debug data.
- Spectator narration.
- Hidden/private channel content not in the perception packet.
- Chain-of-thought requests.

Acceptance:

- Prompt contains all 8 sections.
- Prompt includes triggering event/context when present.
- Prompt includes only available action types/targets.
- Prompt does not include decimal score-like values from raw state.
- Prompt demands strict JSON only.

### M5 — MockLlmProvider

Implement deterministic mock provider.

Responsibilities:

- Return valid JSON intent content.
- Pick behavior from input shape: mention, boredom/cold start, high inhibition, private-channel motive.
- Simulate token usage and latency.
- Never perform network I/O.

Acceptance:

- Mock outputs validate through `IntentParser`.
- Same input returns same intent shape.
- Budget/runtime tests can use it without network.

### M6 — LlmBudget

Implement in-memory budget tracker.

Track:

- Calls per simulation/window.
- Calls per agent/window.
- Input/output tokens.
- Priority status.

Behavior:

- `canCall()` blocks exhausted budgets.
- `recordUsage()` records only real provider calls.
- `getPriority()` returns `blocked`, `low`, `normal`, or `high`.

Acceptance:

- Budget blocks calls cleanly.
- Exhausted budget causes runtime fallback with operator event.
- No fake `LlmUsage` is recorded when blocked.

### M7 — OpenAiCompatibleProvider

Implement generic provider using native `fetch`.

Request:

- `POST {baseUrl}/chat/completions` after normalizing trailing slash.
- OpenAI-compatible messages.
- `model`, `temperature`, `max_tokens`.
- Merge `extraBody` last.
- Use `AbortController` for timeout.

Response:

- Extract assistant content from `choices[0].message.content`.
- Extract usage from `usage.prompt_tokens` and `usage.completion_tokens`.
- Capture headers for FreeLLMAPI observability.
- Capture requested model and routed/fallback metadata when headers are present.

Error handling:

- Missing base URL for OpenAI-compatible provider → typed error.
- Missing API key only when `apiKeyEnv` is set but env var is absent.
- Timeout, non-2xx, malformed response → typed error.
- Retry transient errors up to `retryCount`.

Acceptance:

- Tests mock `globalThis.fetch`; no network in CI.
- Timeout path tested.
- Non-2xx path tested.
- Usage and headers captured.

### M8 — AgentRuntime orchestration

Implement `AgentRuntime.generateIntent(input, context)`.

Flow:

```text
start timer
→ resolve PersonaPromptProfile + LlmConfig
→ budget pre-check
→ if blocked: fallback intent + operator event + llmUsage null
→ build prompt
→ call provider
→ parse/repair/validate
→ if parse valid: record usage + return intent
→ if provider/parser fails: fallback intent + operator event + llmUsage null or provider usage if available
```

Fallback preference:

- `delay_response` when the situation can wait.
- `no_op` when unsafe/invalid/exhausted.

Operator events:

- `llm_budget_exceeded` for budget block.
- `llm_failure` for provider failures.
- `llm_failure` with parser details for invalid model output.

Acceptance:

- Runtime never throws for expected LLM failures.
- Runtime returns schema-valid fallback intent.
- Operator events include `simulationId`, `agentId`, `pulseIndex`, `createdAt` from context.
- `llmUsage` uses `context.pulseIndex` and `context.now` for real calls.

### M9 — Exports and integration tests

Update `packages/server/src/index.ts` to export Dev1 runtime and LLM surfaces.

Acceptance:

- `pnpm --filter @perfectman/server test` passes.
- `pnpm build` passes.
- Existing persistence exports remain intact.

## Verification Commands

```bash
pnpm --filter @perfectman/server test -- --grep "agent|llm"
pnpm --filter @perfectman/server test
pnpm build
pnpm test
git diff --check
```

## Risks / Watch Items

- Qwen3 thinking-disable behavior differs across vLLM, llama.cpp, Ollama, and LM Studio. Do not rely only on provider-side JSON mode.
- FreeLLMAPI routing can change actual model/provider. Record headers when present.
- `ActionIntentSchema` is broad; parser must still enforce available target checks before returning output to Dev2.
- Keep provider code dependency-free unless a concrete issue justifies adding an SDK.
- Do not store API keys in persona profiles or docs; store env var names only.

## Definition of Done

- Agent runtime can produce a valid `ActionIntent` from mock provider.
- Prompt builder uses translated emotional state and leaks no raw scores.
- Parser rejects malformed/unsafe output and returns safe fallback.
- Budget blocks calls without crashing scheduler.
- OpenAI-compatible provider works with mocked HTTP tests.
- Runtime telemetry uses `AgentRuntimeContext` for `pulseIndex` and `createdAt`.
- All server/package tests and full build pass.
