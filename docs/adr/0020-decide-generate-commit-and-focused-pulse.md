# ADR-0020: Decide / Generate / Commit Split and the Focused Pulse

**Status**: Proposed (2026-11-06) — implements hotel-integration decision D17 (base pulse 4-6 s plus a focused pulse on human chat, 1.5 s debounce) and the timing target "addressed reply p50 <= 5 s, p95 <= 10 s". Decisions **D-71..D-75**. Gated by the Phase 1 latency spike.

## Context

`PulseScheduler.executePulse` ([`pulse-scheduler.ts:203`](../../packages/server/src/simulation/pulse-scheduler.ts)) walks the agents one at a time in a seeded order ([`:255`](../../packages/server/src/simulation/pulse-scheduler.ts)) and, inside each iteration, runs the pure engine step, commits engine events, awaits the LLM call ([`:354`](../../packages/server/src/simulation/pulse-scheduler.ts)), resolves and commits the intent, and persists state ([`:462`](../../packages/server/src/simulation/pulse-scheduler.ts)). Four properties make the hotel's latency targets unreachable as built:

- LLM calls are strictly sequential. Twelve agents with three consulted means three round trips in a row before the next pulse can start.
- `runPulse()` returns the in-flight promise when one exists ([`:173`](../../packages/server/src/simulation/pulse-scheduler.ts)). A human line that arrives mid-pulse cannot trigger a pulse of its own; it waits for the next scheduled one.
- Every pulse advances the clock by the configured interval (`simTime += pulseIntervalMs`, [`:204`](../../packages/server/src/simulation/pulse-scheduler.ts); `dt` from the same value at [`:206`](../../packages/server/src/simulation/pulse-scheduler.ts)) and increments `pulseIndex` at the end ([`finishPulse`, :573-577](../../packages/server/src/simulation/pulse-scheduler.ts)). An extra pulse would age emotions, refractories, stagnation and goal reviews a full interval for no wall time.
- Later agents in a pulse react to earlier agents' same-pulse commits only through `worldSignals`, built from the refreshed `newEvents` ([`:258-275`](../../packages/server/src/simulation/pulse-scheduler.ts), [`world-signals-builder.ts:36-50`](../../packages/server/src/simulation/world-signals-builder.ts)); the rolling context window is fixed at pulse start ([`:230`](../../packages/server/src/simulation/pulse-scheduler.ts)). That is the existing dog-pile damper, and a concurrent design weakens it.

## Decision

1. **Three phases inside one pulse (D-71).** (A) *Decide*, sequential in turn order: build the snapshot, `runEngineStep`, commit engine events, record `needsLLM` (ADR-0015 keeps the decision as its only owner). (B) *Generate*: for every agent with `needsLLM`, call `agentRuntime.generateIntent` with bounded concurrency (`generateConcurrency`, default 4 in the hotel) and one slot reserved for addressed agents. (C) *Commit*, in turn order: resolve, append, project, apply memory, persist. The mode is opt-in (`pulseMode: "split"`); the default `"sequential"` keeps today's loop byte-identical, so eval, the CLI and the web builder do not move.
2. **`runPulse` takes options (D-72).** `runPulse(opts?: { reason: "base" | "human_chat" | "body_arrived" | "wake"; focusAgentIds?: string[]; elapsedMs?: number })`. A focused pulse evaluates only `focusAgentIds` (turn order filtered), uses `dt = elapsedMs / 1000` and `simTime += elapsedMs`, does not advance `pulseIndex`, skips the 10-pulse stagnation check ([`:466`](../../packages/server/src/simulation/pulse-scheduler.ts)) and the goal-layer review ([`:529`](../../packages/server/src/simulation/pulse-scheduler.ts)), salts the rng so it does not repeat the next base pulse's draws, and stamps events with the current (next) `pulseIndex`. Base pulses may also pass `elapsedMs` (wall time since the previous pulse of any kind); undefined means `pulseIntervalMs`, today's behavior.
3. **One pulse at a time, with a queue (D-73).** Pulses stay serialized: `agentStates` are loaded once at pulse start ([`:244`](../../packages/server/src/simulation/pulse-scheduler.ts)) and persisted per agent, so two concurrent pulses would overwrite each other. A focused request that finds a pulse in flight queues behind it (one slot; focus ids union; trailing 1.5 s debounce) and no longer receives the in-flight promise. Base pulses are kept short by bounding generation (D-75) and by priority ordering in phase B (addressed first, then ambient, then fidget).
4. **`onConsult` fires when a generate task takes a slot (D-74).** `onConsult({ agentId, reason, addressed })` runs immediately before `generateIntent`, after the semaphore, so the hotel's typing bubble starts when the model call starts rather than when the task was queued.
5. **Generation has a deadline (D-75).** Each generate task is bounded by `generateDeadlineMs` (seed 20 s; the per-call `LLMConfig.timeoutMs` still applies). Expiry follows the existing failure path (`llm_failure` event, `no_op`, [`:357-361`](../../packages/server/src/simulation/pulse-scheduler.ts)), so one slow model cannot hold the commit phase indefinitely.

## Rationale

- Splitting only the LLM wait out of the loop removes the sequential round trips while keeping every pure computation, every commit and every persist in the order the rest of the system assumes (single writer after commit).
- A focused pulse that ages the simulation by real elapsed time keeps emotion decay, `justActed` ([`run-engine-step.ts:104`](../../packages/engine/src/step/run-engine-step.ts)) and cooldowns honest; not advancing `pulseIndex` keeps pulse-denominated windows (hold-voice refractory 3 pulses, stagnation 40, goal review cadence) meaning what their authors intended.
- Serialization is the smallest change that is correct. Per-agent locking would require reworking the `agentStates` map ownership at [`:244-253`](../../packages/server/src/simulation/pulse-scheduler.ts).

## Rejected Alternatives

- **Concurrent pulses** — races on `agentStates`, on `lastCommittedEventId` and on `currentChannelIdByAgent`.
- **A short base interval instead of a focused pulse** — 1-2 s pulses would ask every agent's engine step and many LLM consults to run for no reason, and do not remove head-of-line blocking.
- **Prompting the model to reply faster** — latency is the provider's, not the prompt's.
- **Advancing `pulseIndex` on focused pulses** — shortens every pulse-denominated window by the number of human lines.

## Consequences

- Within a pulse, agents no longer see same-pulse commits through `worldSignals` when generating (phase A precedes all commits). The room speech arbiter ([ADR-0021](./0021-room-speech-arbiter.md)) compensates; the dog-pile probe must be green before the split is the hotel default.
- A base pulse in flight delays a queued focused pulse by its remaining time. The Phase 1 spike measures p50/p95 of that wait; if it breaks the 5 s / 10 s target, the options in order are a shorter `generateDeadlineMs`, a reserved-slot-only mode for base pulses, then per-agent locking.
- Events committed by focused pulses carry the next base pulse's `pulseIndex`; analyses that group by pulse see them in that pulse.
- `SimulationRuntime.runPulse(simulationId)` ([`simulation-runtime.ts:279`](../../packages/server/src/simulation/simulation-runtime.ts)) gains the options parameter and a `getPulseIndex(simulationId)` accessor used by human ingestion ([ADR-0022](./0022-guests-and-human-ingestion.md)).

## Cross-links

[ADR-0015](./0015-decision-owns-needs-llm.md) · [ADR-0017](./0017-voiced-hold-and-private-drive.md) · [ADR-0021](./0021-room-speech-arbiter.md) · [ADR-0024](./0024-multi-run-wall-clock-loop-and-bounded-event-reads.md) · [`../plans/hotel-package.md`](../plans/hotel-package.md)
