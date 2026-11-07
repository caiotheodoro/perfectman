# ADR-0025: LLM Budget as a Warning, and a Circuit Breaker

**Status**: Accepted and implemented (Phase 2 lane L3, 2026-11-06). Implements D11, D16 and D49. Decisions **D-93..D-96**.

## Context

The tracker is built to block. `LLMBudgetTracker.canCall` denies a call when the per-minute call budget or the hourly token budget is spent, and by priority before that ([`llm-budget.ts:120-164`](../../packages/server/src/llm/llm-budget.ts)); `getPriority` walks `high` -> `normal` (50%) -> `low` (80%) -> `blocked` ([`:254-278`](../../packages/server/src/llm/llm-budget.ts)). The defaults are 20 calls per minute and 50,000 tokens per hour ([`:44-47`](../../packages/server/src/llm/llm-budget.ts)); web runs set 200 and 1,000,000 ([`assemble-config.ts:56,60`](../../packages/server/src/authoring/assemble-config.ts)). Twelve actors can ask for well over 20 calls a minute, and a blocked call becomes a `no_op` fallback, which in a room reads as an actor going mute.

Where the budget is actually consulted (traced, not assumed):

| Call site | What it does |
| --- | --- |
| [`pulse-scheduler.ts:349`](../../packages/server/src/simulation/pulse-scheduler.ts) | `getPriority(sim, agent)` only; stamps `budgetPriority` on the runtime input. No `canCall`. |
| [`action-intent-step.ts:92`](../../packages/server/src/agent/surface/action-intent-step.ts) | `canCall` gate before the first provider call |
| [`action-intent-step.ts:257`](../../packages/server/src/agent/surface/action-intent-step.ts) | `canCall` again before each repetition or target retry |
| [`action-intent-step.ts:407,414`](../../packages/server/src/agent/surface/action-intent-step.ts) | `recordUsage` for the main call and each retry |
| [`goal-layer-llm.ts:75-76,114`](../../packages/server/src/simulation/world/goal-layer-llm.ts) | `getPriority` + `canCall` + `recordUsage` for goal synthesis |
| [`simulation-config.ts:528-531`](../../packages/server/src/config/simulation-config.ts) | registers per-simulation limits from `settings`; [`:554`](../../packages/server/src/config/simulation-config.ts) hands the same tracker to the goal client |
| [`agent-runtime.ts`](../../packages/server/src/agent/agent-runtime.ts) | does not call the tracker; it runs the step's `gate` |

`action-intent-step.ts` imports the module singleton (`llmBudget`, [`llm-budget.ts:282`](../../packages/server/src/llm/llm-budget.ts)) directly, so the `llmBudget` option of `buildConfiguredSimulation` reaches the scheduler's `getPriority` but not the step's `canCall`. Everything is keyed by `simulationId`, which is what makes the singleton safe across concurrent runs.

Separately, nothing today reacts to a provider that is down. `LlmHealthWatch` fails a run only if its first three calls are all engine fallbacks ([`llm-health-watch.ts:27-58`](../../packages/server/src/http/run/llm-health-watch.ts)); after that a dead endpoint produces a silent room.

## Decision

1. **Warn mode (D-93).** `LLMBudgetTracker` gains `mode: "enforce" | "warn"` per simulation (default `enforce`, so every existing path is unchanged). In `warn` mode `canCall` always allows, `getPriority` never returns `blocked`, and crossing 80% of the configured soft limits emits one `llm_budget_warning` operator event per window instead of a denial. The hotel registers soft limits high enough that normal use stays under them and sets `warn`.
2. **Addressed means high priority (D-94).** `getPriority(sim, agent, opts?: { addressed })` returns `high` for an addressed agent regardless of consumption; the scheduler passes `addressed` from the decision's attention reasons. Within the generate phase of [ADR-0020](./0020-decide-generate-commit-and-focused-pulse.md) calls are ordered addressed > ambient > fidget, and one concurrency slot is reserved for addressed calls.
3. **A circuit breaker on provider failures (D-95).** `LlmCircuitBreaker` observes operator events through a listening gateway, the shape `LlmHealthGateway` already uses ([`llm-health-watch.ts:60-90`](../../packages/server/src/http/run/llm-health-watch.ts)), and counts provider-level failures (the `Provider failed:` motive prefix and `llm_failure` events: timeouts, 5xx, 429, network). Schema or parse fallbacks are not counted; they belong to the fallback-rate probe (band <= 5%). After 5 consecutive provider failures in a run the breaker opens: the run auto-pauses (actors stay where they are), admins in the room get a notice, and a half-open probe runs after 15 s, 30 s, 60 s, up to 5 min; the first success resumes a run that the breaker paused (never one an admin paused; confirmed by D49). The breaker is per run for counting and global for backoff, since a provider outage is provider-wide.
4. **Backoff on 429 at the provider seam (D-96).** The hotel builds its `AgentRuntime` through the existing `providerFactory` parameter ([`agent-runtime.ts:16-21`](../../packages/server/src/agent/agent-runtime.ts)), wrapping each provider with a governor that honors `Retry-After`, applies jittered exponential backoff and holds a shared penalty window across runs. Cost is `recordUsage` tokens times the env price table (D16), reported per run to the admin panel; there is no hard cost stop in v1 (D11).

## Rationale

- With a blocking budget the failure mode of a busy room is silence, the worst outcome for a "person in a room". A warning plus a breaker on real failure keeps the room alive when the model is healthy and stops it when it is not.
- Adding a mode to the tracker, rather than a second tracker, changes one class and leaves the four call sites untouched.
- Reusing the listening-gateway pattern keeps the breaker out of the engine and the scheduler.

## Rejected Alternatives

- **Set the limits to a very large number and do nothing else** — works for D11 but leaves `blocked` reachable by a misconfiguration and gives no signal before the bill.
- **Remove `canCall` from the step** — the step is shared with eval and the web builder, where the gate is wanted.
- **A breaker inside `IntentParser` or the provider** — it must pause the run, which only the run manager can do.
- **Hard cost ceiling per run** — contradicts D11; revisit after the first real cost data.

## Consequences

- `LLMBudgetTracker` changes (mode, soft thresholds, `getPriority` options); the `LLMBudget` type used by the scheduler ([`pulse-scheduler.ts:81-83`](../../packages/server/src/simulation/pulse-scheduler.ts)) gains the optional options argument.
- Goal-layer calls (`goal-layer-llm.ts`) obey the same mode; hotel runs do not enable the goal layer in v1, so the point is moot until they do.
- New operator event types `llm_budget_warning`, `llm_circuit_open` and `llm_circuit_closed` (D49: the admin is told on resume as well as on pause) flow to the admin notice path. They join `OPERATOR_EVENT_TYPES` together with their producers, because its guard test rejects a type with no emission site; the Phase 1 freeze (`hotel-runtime-api.ts`) holds only the breaker state and the resume rule.
- The 429 error shape from the OpenAI-compatible transport is not verified here; the governor's classifier is written against the status code and message and pinned by a test in Phase 2.

## Implementation notes (Phase 2 L3)

- `LLMBudgetTracker`: `registerLimits(sim, { ..., mode?: "enforce" | "warn", softLimits? })`. Warn mode always allows, never returns `blocked` (the 50% / 80% ladder runs against the soft limits, capped at `low`) and emits one `llm_budget_warning` per kind per window past 80% of a soft limit; `onWarning(fn)` and `budgetWarningEvent(...)` bridge it to the operator path. `getPriority(sim, agent, { addressed })` returns `high` for an addressed agent; `getUsage(sim)` is the frozen `RunUsage`; `getLatencyStats(sim)` gives count, p50, p95 and max over the last 500 calls (D53). `hotelBudgetRegistration(soft?)` is the hotel's registration (huge hard limits, warn mode).
- Where to register: the module singleton `llmBudget`. `action-intent-step.ts` calls it directly, and `BuildConfiguredSimulationOptions.llmBudget` only reaches the scheduler's `getPriority`. At integration the hotel stopped overriding after the build: `HotelSimulationOptions.budget` (soft limits) makes `buildConfiguredSimulation` register `hotelBudgetRegistration(...)` for that simulation id instead of the settings-derived limits, the handle exposes the tracker as `budget` (warnings, usage, latency percentiles), and `handle.close()` calls `forget(simulationId)` so a long-lived sidecar does not keep finished runs.
- `LlmCircuitBreaker` (`packages/server/src/llm/llm-circuit-breaker.ts`) is an `IDeliveryGateway` for `extraGateways`: it counts `Provider failed:` / `Retry call failed.` motives on `action_intent` operator events as failures (parse fallbacks count as the provider answering; `LLM budget exceeded:` is ignored), opens after 5, calls `onOpen` (the hotel pauses; returning `false` means an admin already holds the pause, so `pausedRun` is false), probes after 15 s doubling to 5 min through `shouldProbe` / `beginProbe`, and closes on the first good half-open call, calling `onClose(sim, { pausedRun })`. It emits `llm_circuit_open` and `llm_circuit_closed`. A `generateIntent` call that throws before the step (or misses its deadline) produces no `action_intent`; the scheduler records it as a committed `llm_failure` whose payload carries `stage: "generate"`, the operator projection forwards it, and `classifyLlmCall` counts that marker as a provider failure. The hotel's `BreakerDriver` owns the half-open timer: it calls `beginProbe`, makes the tiny health call and feeds the answer back as one observed call.
- `LlmGovernor` (`governProvider(provider, shared, opts)`) wraps a provider for `AgentRuntime`'s `providerFactory`: it retries 429 only, honouring `Retry-After` (seconds or HTTP date) and otherwise jittered exponential backoff, with one `GovernorShared` penalty window across runs. `LLMHttpError` now carries response `headers` so `Retry-After` survives the transport.
- Operator event types `llm_budget_warning`, `llm_circuit_open` and `llm_circuit_closed` joined `OPERATOR_EVENT_TYPES` with their producers.

## Cross-links

[ADR-0010](./0010-goal-layer-llm-slice.md) (goal calls share the singleton) · [ADR-0020](./0020-decide-generate-commit-and-focused-pulse.md) · [`../plans/hotel-package.md`](../plans/hotel-package.md) section 13
