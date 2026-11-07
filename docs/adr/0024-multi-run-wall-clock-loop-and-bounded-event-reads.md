# ADR-0024: Multi-Run, Wall-Clock Pulse Loop and Bounded Event Reads

**Status**: Proposed (2026-11-06) — implements hotel-integration decisions D11/D36 (at most 3 concurrent runs hotel-wide, 1 per room), D15 (run state in memory only) and D17 (pulse clock). Decisions **D-89..D-92**.

## Context

The hotel runs up to three rooms of up to twelve actors for as long as humans are present (D46 as narrowed by lead resolution R2: a run pauses after 5 min with no human in its rooms and ends after 30 min of that idle pause; admin and breaker pauses never end on a timer). Four things in today's server assume short, single, fast runs:

- **One run.** `RunController` allows exactly one active run and says why: `better-sqlite3` is synchronous and the scheduler re-reads the whole log each pulse, so concurrent runs would block each other and the HTTP server ([`run-controller.ts:1-9`](../../packages/server/src/http/run/run-controller.ts), `RunAlreadyActiveError` at [`:96-97`](../../packages/server/src/http/run/run-controller.ts)). `SimulationRuntime` itself already maps many simulations ([`simulation-runtime.ts:80`](../../packages/server/src/simulation/simulation-runtime.ts)).
- **No wall-clock loop.** `runPulseLoop` runs "as fast as the model allows" ([`pulse-loop.ts:10-12,44`](../../packages/server/src/http/run/pulse-loop.ts)); `start()` schedules the next pulse `pulseIntervalMs` after the previous one finishes ([`pulse-scheduler.ts:157-162`](../../packages/server/src/simulation/pulse-scheduler.ts)), so its period is interval plus duration.
- **Full-log reads every pulse.** `executePulse` calls `getCommittedThrough(sim, Number.MAX_SAFE_INTEGER)` at [`:230-233`](../../packages/server/src/simulation/pulse-scheduler.ts) and again every tenth pulse at [`:467`](../../packages/server/src/simulation/pulse-scheduler.ts). The in-memory repository is worse than linear: `append` copies the whole array (`[...log, ...committed]`), `getAfter` does `findIndex`, and `getAfter` with an unknown cursor rejects ([`in-memory-stores.ts:43,52-60`](../../packages/server/src/simulation/in-memory-stores.ts)). Over hours that is quadratic work and an unbounded heap.
- **Sim time only.** `simTime += pulseIntervalMs` ([`pulse-scheduler.ts:204`](../../packages/server/src/simulation/pulse-scheduler.ts)); there is no notion of "this pulse is due now".

## Decision

1. **One composition per run, a new `RunManager` (D-89).** Each run is its own `buildConfiguredSimulation` handle: own runtime, repositories, scheduler and `HotelGateway` (injected through `extraGateways`, the seam the HTTP controller uses at [`run-controller.ts:147-166`](../../packages/server/src/http/run/run-controller.ts)). The `RunManager` in `packages/hotel` enforces at most 3 runs and one per room and reuses the controller's teardown order (drain the in-flight pulse, stop the runtime, write artifacts, close). `RunController` and the web builder are not changed; the single-run limit is "lifted only for the hotel" by not routing the hotel through it.
2. **A wall-clock pulse loop in the hotel (D-90).** `WallClockPulseLoop` schedules base pulses on a drift-free timeline with a seeded jitter of 4-6 s between starts, passes `elapsedMs` (wall time since the previous pulse of any kind) to `runPulse` ([ADR-0020](./0020-decide-generate-commit-and-focused-pulse.md)), queues focused pulses with a 1.5 s trailing debounce, and supports pause, resume and stop. `SimulationRuntime.start()` is not used for hotel runs; `runPulseLoop` is not used either.
3. **Bounded in-memory event store (D-91).** `InMemoryEventRepository` gains a retention window (`maxRetained`, default 2000) with an id-to-index map: `append` is amortized O(k), `getAfter` is O(1) to locate the cursor, and a cursor that has been evicted returns events from the window start flagged `gap` instead of rejecting. `IEventRepository` gains an optional `getWindow(simulationId, spec)` returning what a pulse needs: the last 40 agent-visible events (`CONTEXT_WINDOW_PULSES_LIMIT`), the last `OWN_HISTORY_LIMIT` (12) messages per agent, and every event newer than `max(STAGNATION_WINDOW_PULSES = 40, HOLD_VOICE_REFRACTORY_PULSES = 3)` pulses. `executePulse` uses it when present and falls back to `getCommittedThrough` otherwise, so SQLite paths are untouched. Evicted events are appended to an NDJSON file on the replay volume through an `EventSink`, so replays stay complete.
4. **Run state is memory-only; restart means interrupted (D-92).** The sidecar persists nothing between processes (D15, D41). Hotel restart or sidecar crash ends runs as `interrupted`; resume is a later feature. The persistence config is `{ type: "memory" }` plus the retention window.

## Rationale

- Per-run compositions reuse the proven root (`buildConfiguredSimulation`) and keep every run's repositories, scheduler state and anchors isolated; sharing one `SimulationRuntime` across runs would share its single delivery gateway ([`simulation-runtime.ts:39`](../../packages/server/src/simulation/simulation-runtime.ts)) and make per-run routing the gateway's problem.
- The memory-only store removes the SQLite synchronous-write argument that justified the single run. The bounded window removes the other half (the full read).
- A drift-free schedule keeps the pulse cadence a human perceives steady while model latency varies; the same loop is where pause, resume and the 5 min / 30 min lifecycle timers (D46) attach.

## Rejected Alternatives

- **Lift the limit inside `RunController`** — changes the web builder's contract and still lacks a wall clock, a lifecycle and a body.
- **One shared runtime for all runs** — one delivery gateway for every run; cross-run state in `currentChannelIdByAgent` and the rate gate.
- **SQLite in-memory databases per run** — keeps synchronous writes on the event loop that also carries the Director socket.
- **Keep unbounded in-memory logs and rely on short runs** — D46 makes run length unbounded while humans stay.

## Consequences

- `IEventRepository` gets an optional method; `PulseScheduler` has two read sites to update; `InMemoryEventRepository` gets an index and an eviction policy (the existing in-memory tests cover the unbounded behavior and stay green by default, retention is opt-in).
- Eval and CLI runs are unaffected: they keep sequential mode, unbounded memory or SQLite, and `runPulseLoop`.
- Process memory per run is bounded by the retention window, agent states and the space mirror; the target (12 actors, 3 runs) is verified in the Phase 2 soak test.
- Replay fidelity depends on the NDJSON sink: a write failure marks the run's artifacts `dirty`, as the controller already does for an undrained pulse ([`run-controller.ts:308`](../../packages/server/src/http/run/run-controller.ts)).

## Cross-links

[ADR-0020](./0020-decide-generate-commit-and-focused-pulse.md) · [ADR-0026](./0026-hotel-adapter-package.md) · [`../plans/hotel-package.md`](../plans/hotel-package.md) sections 6 and 9
