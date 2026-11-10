# Sub-Plan: `packages/hotel` (the Tilehouse Sidecar)

> Adapter package between the perfectman runtime and a grid hotel (Tilehouse).
> Decisions: [ADR-0018](../adr/0018-physical-space-model-and-embodiment.md) to [ADR-0026](../adr/0026-hotel-adapter-package.md). Body spec: [`../embodiment.md`](../embodiment.md). Closest precedent: [Discord Gateway](./discord-gateway.md).
> Wire contracts (Director WebSocket frames, internal HTTP, lease, reconcile) are owned by the hotel's docs, `docs/perfectman/director-protocol.md` in the Tilehouse repo. This plan names what the sidecar implements against them and does not copy them.

## 1. Scope

In scope: the `perfectman-hotel` Node process, its run manager, delivery gateway, space mirror driver, embodiment executor, guest ingestion, wall-clock pulse clock, LLM governor and circuit breaker, the fake grid hotel for CI, the image and its compose expectations.

Out of scope (specified elsewhere): the Director protocol and actor model in Tilehouse (hotel docs), the builder modal, camera and audio, the cinematic Director beyond its seams (Phase 4), sprites.

Non-goals for v1: resuming a run after a crash (D41), agent-to-human relational modeling (Phase 3), voice, mixed-mode runs (a run's mode is fixed, default d1).

## 2. Decisions this plan relies on

Integration decisions are written `D17` (approved by the owner on 2026-11-06; canonical log is the hotel repo's `docs/perfectman/decisions.md`). Repo ADR decisions are written `D-63`.

| # | Decision | Used in |
| --- | --- | --- |
| D9, D43 | AI badge on actors for players only; actors believe they are human, prompts never say otherwise | 7, 12 |
| D11/D36 | <= 12 actors per run; <= 3 concurrent runs, 1 per room (`PERFECTMAN_MAX_RUNS`); budget is a warning | 6, 13 |
| D13 | Sidecar + `HotelGateway` + server-owned actors + Director WS | 3, 4, 14 |
| D14 | Hybrid bodies | 11 |
| D15 | Run state in memory only; replays on a volume | 6, 16 |
| D16 | OpenAI-compatible LLM; key, base URL and model allowlist from the host's env; never user-entered | 13 |
| D17, D52 | Pulse clock: base pulse every 6 s plus a focused pulse on human chat that fires at once (other lines within 300 ms coalesce); replaces the 1.5 s debounce | 9 |
| D53 | Model allowlist admits a model only after a benchmark shows p95 <= 6 s at our prompt size; run panel shows live LLM p95 and warns on drift | 9, 13 |
| D18 | Cinematic lookahead of 1-2 pulses | 18 |
| D22 | Human chat is untrusted speech; only admin commands steer | 12 |
| D29, D44 | Actors hear by distance; humans may whisper to actors, bystanders within 2 tiles notice | 12 |
| D31 | Pair acts on humans are free with a 4 s reaction chip | 11 |
| D35 | Dark launch behind `PERFECTMAN_ENABLED` | 4 |
| D39 | Replays re-playable from event log + director track + frame log | 6 |
| D40 | No consent notice when actors enter player-owned rooms | 12 |
| D41 | Sidecar crash: the hotel waits 15 s, actors walk out, run `interrupted` | 6 |
| D42 | Links and markdown stripped; all actor text goes to the hotel `chat_log` | 7 |
| D45 | Cinematic can be staged in any room | 18 |
| D46, R2 | A run lives while any human is in its rooms; pauses after 5 min without humans (cause `idle`); ends with a walk-out after 30 min of idle pause. Admin and breaker pauses never end on a timer. A human entering an idle-paused run's rooms resumes it | 6 |

Lead resolutions of 2026-11-06 (hotel repo `docs/perfectman/decisions.md`, rows R1-R10) also apply: R1 `space` naming, R3 authoring route (section 4, 14), R4 actor ids and names, R5 per-room `rev`, R6 Dodge/Push movement, R8 expression fallback, R9 canvas badge, R10 arbiter outcome, `operator_only`, walk limiter, `maintain()`/`doze_off` exemption. They are cited as "lead resolution Rn"; they are not the hotel `risk-register.md` ids.

## 3. Package layout and dependencies

```text
packages/hotel/
  package.json            @perfectman/hotel  (private, type: module)
  Dockerfile              own image (section 16)
  src/
    main.ts               entrypoint: config, clients, RunManager, signals, health
    config.ts             env parsing (section 4)
    run/                  RunManager, Run, lifecycle timers, run composition
    gateway/              HotelGateway (delivery + body), room delivery queue, typing
    director/             DirectorClient (WS), HotelHttpClient, frame types (generated)
    space/                SpaceMirror driver (frame -> reducer action), per-room snapshot cache and rev tracking
    embodiment/           plan(), BodyExecutor, pair choreography, constants
    ingest/               guest ingestion, sanitizer, addressing, hearing
    clock/                WallClockPulseLoop, injected Clock
    llm/                  LlmGovernor (the server's `governProvider` on the hotel clock), BreakerDriver (the server's `LlmCircuitBreaker` plus its probe timer), meter, price table
    authoring/            AuthoringService + AuthoringServer (internal HTTP listener: validate, compile, draft, autolook, presets) over the server pipeline
    testing/              fake grid hotel, scripted humans, frame-log recorder
  vitest.config.ts
```

Dependencies: `@perfectman/shared`, `@perfectman/engine`, `@perfectman/server` (workspace). Dev: `@perfectman/eval` (probes, tests only). No dependency on `discord.js` is intended; if the server package cannot be imported without pulling it in at runtime, a subpath export is added in Phase 1 ([`server/package.json`](../../packages/server/package.json) exports only `.`; verified, and it does pull them in: see section 19, question 1).

Generated types: Rust `schemars` -> JSON Schema (vendored at `schema/director.schema.json`, provenance in `schema/SOURCE.md`) -> `json-schema-to-typescript` into `director/generated.ts` with `pnpm --filter @perfectman/hotel gen:director` (Phase 1 contract freeze). `check:director`, part of `pnpm test:gate`, fails when the generated file is stale.

Workspace edits: add `packages/hotel/vitest.config.ts` to [`vitest.workspace.ts`](../../vitest.workspace.ts); root `build` already runs `pnpm -r build`.

## 4. Process model and configuration

One Node 22 process. One event loop. Live run traffic is outbound only: it **dials out** to the hotel's Director listener (unpublished port, secret). It has two local listeners and no published port: the **authoring listener** (`PERFECTMAN_AUTHORING_BIND`, default `0.0.0.0:9101` in Docker, `127.0.0.1:9101` elsewhere), reachable only on the compose network by the hotel's admin API and guarded by the same bearer `PERFECTMAN_SECRET` (constant-time compare, lead resolution R3), and a loopback health endpoint.

Environment (names marked * are proposed here; `PERFECTMAN_ENABLED`, `PERFECTMAN_MAX_RUNS` and `PERFECTMAN_SECRET` come from the plan):

| Variable | Meaning |
| --- | --- |
| `PERFECTMAN_ENABLED` | Dark-launch flag (D35), shared `env_file` with the hotel. When `0` the sidecar stays up for its healthcheck but does not connect (the hotel has no Director listener then, close 4004) and starts nothing |
| `PERFECTMAN_SECRET` | Shared secret for the Director WS, the hotel's internal HTTP and the sidecar's authoring listener |
| `PERFECTMAN_DIRECTOR_URL`* | `ws://` URL of the Director listener |
| `PERFECTMAN_INTERNAL_URL`* | `http://` base of the hotel's internal HTTP surface |
| `PERFECTMAN_AUTHORING_BIND`* | Address of the authoring listener (the hotel reaches it as `PERFECTMAN_SIDECAR_URL`, default `http://perfectman-hotel:9101`) |
| `PERFECTMAN_MAX_RUNS` | Concurrent runs, default 3 |
| `PERFECTMAN_LLM_BASE_URL`* | OpenAI-compatible base URL |
| `PERFECTMAN_LLM_API_KEY`* | API key; referenced by name through `LLMConfig.apiKeyEnv` |
| `PERFECTMAN_LLM_MODELS`* | Comma-separated model allowlist; the first is the default. A model is added only after a benchmark shows p95 <= 6 s at our prompt size (12 agents, 40-event window; D53) |
| `PERFECTMAN_LLM_CHAIN`* | JSON array of provider links tried in order (`name`, `baseUrl`, `apiKeyEnv`, `model`, optional `maxContextTokens`, `sessionHeader`, `headers`, `timeoutMs` (default 5000 ms), `tokenRatio`, `promptStyle`, `harden`, `extraBody`: request-body extras such as a reasoning switch, see docs/plans/hotel-llm-chain.md, Config). Replaces the three `BASE_URL`/`API_KEY`/`MODELS` variables when set; its models are the allowlist. An enabled sidecar refuses to start when a link's model has no price (built-in table or `PERFECTMAN_LLM_PRICES`); a subscription link declares 0/0 there. The chain is not parsed while `PERFECTMAN_ENABLED` is off. See [hotel-llm-chain.md](hotel-llm-chain.md) |
| `PERFECTMAN_LLM_PRICES`* | JSON `{ "<model>": { "inUsdPerMTok": n, "outUsdPerMTok": n } }` |
| `PERFECTMAN_LLM_CONCURRENCY`* | Generate concurrency across both pulse lanes, default 3; one slot is reserved for addressed replies |
| `PERFECTMAN_LLM_SOFT_CALLS_PER_MIN`*, `PERFECTMAN_LLM_SOFT_TOKENS_PER_HOUR`* | Warn-mode thresholds |
| `PERFECTMAN_DATA_DIR`* | Volume root shared with the hotel, default `/data/perfectman` (layout in section 6.4) |
| `PERFECTMAN_HEALTH_PORT`* | Loopback health port, default 9100 |
| `PERFECTMAN_KB_SLIM` | Optional path of the slim reference-scenes file (`packages/kb`, "Slim artifact"). Set: the draft prompt gets reference scenes in the draft's language (none when the KB has none in it). Unset or unreadable: no prompt changes. How it ships: docs/deploying.md |
| `PERFECTMAN_KB_CRAFT` | Off unless exactly `1`, independent of the draft prompt, and needs `PERFECTMAN_KB_SLIM`: an authored beat's actor gets up to two style lines in the scene's language while the beat is near. Off: no actor prompt changes by a byte, even with the file loaded |

Startup: parse env (fail fast on a missing secret, URL or model list) -> start health endpoint and authoring listener -> connect Director WS -> receive `hello` and reconcile -> accept `pm_command` and `run_start` frames. Authoring works without a Director connection; run starts do not.

## 5. Data flow

```text
human line (Director frame human_chat)
  -> ingest/: sanitize, address, hearing        -> EventLog.append(message_sent, untrusted)
  -> RunManager: focused pulse request for the addressed actors (fires at once, 300 ms coalescing)
pulse (decide -> generate -> commit, ADR-0020)
  -> onConsult                                  -> typing{on} (via HotelGateway)
  -> IntentResolver (arbiter, rate gate)        -> committed events
  -> DeliveryProjection                         -> HotelGateway.sendAgentMessage (enqueue, return)
  -> planner.plan(...)                          -> HotelGateway.dispatch(BodyCommand[])
HotelGateway queue                              -> actor_cmd frames (chat, walk, face, gesture...)
Director deltas {rev, room, msg}                -> SpaceMirror reducer -> SpaceView for the next pulse
```

## 6. RunManager and lifecycle

### 6.1 Responsibilities

`RunManager` owns up to `PERFECTMAN_MAX_RUNS` runs, one per room. It starts, pauses, resumes and stops runs, applies leases, drives the lifecycle timers and reports run stats. It reuses the teardown order of the HTTP controller ([`run-controller.ts:219-293`](../../packages/server/src/http/run/run-controller.ts)): drain the in-flight pulse (bounded), stop the runtime, write artifacts, close handles, publish the final state. It does not reuse `RunController` itself ([ADR-0024](../adr/0024-multi-run-wall-clock-loop-and-bounded-event-reads.md)).

Each `Run` is one `buildConfiguredSimulation` handle ([`simulation-config.ts:506`](../../packages/server/src/config/simulation-config.ts)) with: `persistence: { type: "memory" }` plus the bounded retention window, `HotelGateway` injected via `extraGateways`, a listening `LlmCircuitBreaker` gateway (the `LlmHealthGateway` pattern, driven by `BreakerDriver`), an `AgentRuntime` built with the governed `providerFactory`, split pulse mode, the arbiter, and `onAgentCommitted` as the planner seam. All of it goes in as one `hotel: HotelSimulationOptions` bag; the sidecar keeps no adapters of its own over the runtime (`run/runtime-port.ts` only narrows the handle).

Commands accepted from the hotel: a `run_start` frame, and `pm_command` with `cmd` in `stop`, `pause`, `resume`, `inject`, `whisper`, `status`, `replay`, `wipe_memory` (the protocol doc owns the shapes). A `whisper` (or an `inject` that names one character) that tells someone to leave, with a room named or "another room", is carried out by the body: the planner walks the actor to the door and takes it (`leaveDirective`, `Run.directExit`), because a small model does not write the `body.move` it is asked for; the hop then cuts the camera like any other. `start`, `open` and `killall` are hotel-local: the hotel creates the `runs` row and sends `run_start`. The hotel can also send `run_end` (it ended the run itself: idle timeout, kill-all, lease expiry); the sidecar then stops the runtime, writes artifacts and drops the run.

### 6.2 States and transitions

States are the hotel's `runs.state`: `starting`, `running`, `paused`, `stopping`, `ended`, `interrupted`, `failed`. The sidecar reports its own view in `run_status`; the hotel is the authority.

| From | To | Trigger |
| --- | --- | --- |
| (none) | `starting` | `run_start` received (the hotel already checked caps and room): scenario version fetched over internal HTTP, validated by `AuthoringService`, LLM health check passed; answered with `run_ack` (the hotel waits 20 s) |
| `starting` | `running` | lease granted, all actors spawned (names unique, spawn not refused under the 10-slot rule), room snapshots synced, first pulse scheduled |
| `starting` | `failed` | any step fails (`run_ack{ok:false}`, no ack in 20 s, a spawn refused); actors already spawned walk out; reason reported to the admin |
| `running` | `paused` | `pause` (cause `admin`); circuit breaker open (cause `breaker`); 5 min with no human in any of the run's rooms (cause `idle`, D46, requested by the hotel with `pm_command{pause, source:"auto"}`) |
| `paused` | `running` | `resume` (admin); breaker half-open success (only cause `breaker`, ADR-0025); a human enters a run room (only cause `idle`, requested by the hotel with `pm_command{resume, source:"auto"}`, lead resolution R2) |
| `paused` (cause `idle`) | `stopping` / `ended` | 30 min idle-paused: **the hotel** ends the run (walk-out, `end_reason idle_timeout`) and sends `run_end`. Admin and breaker pauses have no end timer |
| `running` / `paused` | `stopping` | `pm_command stop`; scenario end offer (`goal_end_offered`, reported as `run_end{completed}`); fatal LLM verdict (`run_end{breaker}`) |
| `stopping` | `ended` | actors walked out and despawned, pulse drained, artifacts written |
| any | `interrupted` | Director socket closed > 15 s (decided by the hotel), hotel restart, or sidecar restart (D41) |

Paused runs hold their actors in place; they do not walk out until `stopping`. "The run's rooms" are its home room plus every room that holds one of its Actors; "human" is any non-Actor member or watcher, admins and cinematic audience included. **The hotel keeps the idle clock** (`runs.idle_since`, `paused_at`): it already owns the occupant lists and must work with a wedged sidecar. The sidecar reports its pause cause in `run_status.pause_cause` (`admin|idle|breaker`) and never decides idle pause, resume or the 30 min end itself. An admin `pause` on an idle-paused run changes the cause to `admin` and cancels the end timer.

### 6.3 Crash and reconcile (D41)

- Sidecar process dies: the hotel waits 15 s for the socket, then walks the actors out and marks the run `interrupted`. The sidecar keeps nothing to resume.
- Sidecar reconnects within the window with the same process: it answers `hello` with `hello_ack{resume}` and the hotel renews the lease (`lease{run, lease}`).
- Sidecar restarts: `hello` from the hotel lists live actors and runs; the sidecar owns none of them, so every unknown actor is despawned and every unknown run is marked `interrupted`.
- Hotel restarts: orphan runs are marked `interrupted` at startup; actors are gone; the sidecar sees a fresh `hello`.
- SIGTERM: stop accepting `start`, move every run to `stopping` with walk-out (bounded to 10 s), flush artifacts, close the socket, exit 0. Compose grants a 20 s stop grace period. A restart is not a deliberate stop, so no `run_end` is sent: the artifacts say `finalState: "interrupted"`, `stopReason: "sidecar_shutdown"`, an admin notice `shutting_down` goes out, and the hotel marks the run `interrupted` (`sidecar_lost`, D41) when the socket closes or the next `hello_ack` does not resume it. `run_end` stays for a stop the admin asked for, the scenario's own end and a failure.

### 6.4 Artifacts

Per run, under `PERFECTMAN_DATA_DIR/runs/<runId>/` (the volume layout is owned by the hotel's `data-model.md` section 3): `events.jsonl` (the evicted and final event log, [ADR-0024](../adr/0024-multi-run-wall-clock-loop-and-bounded-event-reads.md)), `director.json` (cinematic director track), and `replay.json`, the manifest that ties the files together (scenario version sha256, final state, counters, stop reason, `dirty` when a pulse did not drain, as in [`run-controller.ts:295-312`](../../packages/server/src/http/run/run-controller.ts)). The sidecar registers them with `POST /internal/v1/runs/{run}/artifacts`. The hotel writes `frames.jsonl` itself and joins it at replay (D39).

## 7. HotelGateway

`HotelGateway implements IDeliveryGateway, IBodyGateway`. `IDeliveryGateway` is [`scheduler-contracts.ts:31`](../../packages/server/src/simulation/scheduler-contracts.ts); `IBodyGateway.dispatch(BodyCommand[])` is new (embodiment.md section 9).

**Rule: nothing in a gateway method awaits the hotel.** `DeliveryProjection` awaits every gateway call inline inside the pulse ([`delivery-projection.ts:104-110`](../../packages/server/src/simulation/projections/delivery-projection.ts)), and the HTTP controller's `timeboxGateway` abandons any call that takes 2 s ([`run-controller.ts:36`](../../packages/server/src/http/run/run-controller.ts), [`timeboxed-gateway.ts:19`](../../packages/server/src/delivery/timeboxed-gateway.ts)). Hotel runs do not go through that controller, so they would not be timeboxed at all; a slow send would stall the pulse. Methods therefore enqueue and return, the way the Discord gateway hands to its rate limiter ([`discord-gateway.ts:80`](../../packages/server/src/discord/discord-gateway.ts)).

| Method | Behavior |
| --- | --- |
| `sendAgentMessage(channelId, msg)` | Resolve run and room from `channelId`. Strip links and markdown (D42). Take mode (`say` / `shout` / `whisper`, and the target) from the committed event (`DeliveryMessage` gains `eventId`, `mode`, `whisperTo`; **new**). Compute `landAt = max(now, consultAt + min(4000, sampledDelay + 55 ms x chars))` with `sampledDelay` from the persona's `responseDelayMs`; enqueue; return. Reactions map to a gesture or expression, not text |
| per-actor queue | FIFO; on release sends `typing{off}` then `chat` |
| per-room queue | enforces >= 2.5 s between actor lines in a room (timing rule 3): a colliding addressed reply is delayed, never dropped. Queue cap 6 per room; overflow drops the oldest ambient line first, then the oldest interjection, counted as `undelivered_committed` |
| `createChannel` / `addMember` / `removeMember` | Mirror membership; huddle bookkeeping for private channels (embodiment.md 6.4). No hotel call |
| `sendSpectatorEvent` | Default mode: ignored. Cinematic: appended to the director input |
| `sendOperatorEvent` | Forwards thoughts as `chat{mode:"thought"}` commands (always logged to `chat_log`, D42; delivered to nobody in default mode, delivered to Audience in cinematic, D30) and ends typing on a silent consult. The circuit breaker is its own listening gateway; the run raises the admin notices (`ui_push` notice) for `llm_circuit_open`, `llm_circuit_closed` and `llm_budget_warning` |
| `onSimulationStopped` | Trigger walk-out and despawn through the run manager |
| `dispatch(commands)` | Per-actor token bucket (<= 4 per 5 s, embodiment 7.2) as a second check, ahead of the hotel's own backstop of 8 per 5 s that includes `walk`; sends `actor_cmd` frames; records every send in the local frame log; reports `actor_error` frames back to the executor |

Typing: `onConsult` -> `typing{on}`; released with the line, or after at least 0.8 s when the consult ends in a fallback or `no_op`.

### Runtime surface the sidecar codes against (as built, Phase 2 L3)

- `buildConfiguredSimulation(config, { hotel: HotelSimulationOptions, extraGateways, agentRuntimeFactory })` switches a run into hotel mode: split pulse (default concurrency 3, one slot reserved for addressed), `arbiter` config, `spaceMirror`, `windowedReads`, `eventRetention: { maxRetained, onEvict }` (the NDJSON sink is the sidecar's), `onConsult`, `onAgentCommitted`, `clock`.
- `SimulationRuntime`: `runPulse(simId, { reason, focusAgentIds?, elapsedMs? })`, `getPulseIndex`, `awaitIdle`, `ingest(GuestLineInput)`, `resolveDeferred(agentId, intent)`, `registerRoomChannel` / `addChannelMember` / `removeChannelMember`, `getArbiter(simId)` (`noteHumanLine`, `noteHumanTyping`), `getResponseDelayMs(simId, agentId)`.
- LLM: `hotel.budget` (soft limits) registers the simulation's own warn-mode limits on the shared `llmBudget` inside the build and `handle.close()` forgets them; `handle.budget.onWarning` carries the warnings; `LlmCircuitBreaker` goes in `extraGateways` and reports through `onOpen` / `onClose` (`BreakerDriver` schedules its probe); providers are wrapped with `governProvider` in the `providerFactory`. A call that throws out of `generateIntent` before the step ran is counted too (the scheduler's `llm_failure` carries `stage: "generate"`).
- Planner seam: `onAgentCommitted(AgentCommitInfo)` runs the planner for that actor with the validated `body` block, its targets and the view it decided from; a `body.deferral` makes the run hold the intent and call `resolveDeferred` when the walk that was taking the speaker to the addressee arrives (or drop it at `expiresAt` with `body_blocked: not_in_earshot`). Actors the model was not consulted for get the automatic rules from a sweep after each base pulse.
- Rooms: `addChannelMember` on a `room:<id>` channel also makes it the actor's default channel, so a `moved_room` frame becomes `removeChannelMember` / `addChannelMember` plus a `moved_room` event on the destination channel.
- `WallClockPulseLoop` in `packages/server` is a ready two-lane loop on an injected clock; the sidecar may use it or its own.
- Engine-side fake grid hotel and probes also exist in `packages/eval/src/embodiment/` (used by the server and engine probes); the sidecar's own fake in `src/testing/` is still needed for the Director transport.

## 8. Timing rules 1-7 and their owners

The rules are specified in [`../embodiment.md`](../embodiment.md) section 8.3. Owners:

| Rule | Owner in this package |
| --- | --- |
| 1 Addressed: focused pulse, typing at consult, line lands at `max(LLM done, persona delay + 55 ms/char, cap 4 s)`, p50 <= 5 s, p95 <= 10 s | ingestion (addressed set) -> `RunManager.requestFocused` -> `WallClockPulseLoop`; `HotelGateway` landing time |
| 2 One answer per human line unless several were addressed; after it, others only react until 10 s without human speech | server arbiter (`not_addressed_open_line`, a `policy_blocked` denial that falls back to `no_op`, never `rateLimited`); the hotel supplies the human-line state (id, addressed set, typing) through `arbiter.noteHumanLine` / `noteHumanTyping` |
| 3 <= 1 actor line per 2.5 s per room; <= 3 lines per human line | per-room queue (spacing); arbiter (`line_budget`) |
| 4 Typing human suppresses ambient lines up to 6 s | arbiter (`human_typing`); typing frames from the hotel |
| 5 Silence first-class; ambient after 10 s without human speech, scaled by scenario energy | arbiter (`ambient_too_soon`) |
| 6 Body budget 4 / 5 s / actor, gesture cooldown 15 s, dwell 20 / 30 s | planner and `dispatch` bucket |
| 7 LLM priority addressed > ambient > fidget; budget warns, breaker stops | generate-phase ordering and reserved slot (server), warn mode, `LlmCircuitBreaker` |

Cinematic replaces 1-4 with director pacing (`readingSeconds`, shot holds, 1-2 pulses of lookahead, D18).

## 9. Wall-clock pulse clock (D17, D52)

`WallClockPulseLoop` replaces both `runPulseLoop` (runs as fast as the model allows, [`pulse-loop.ts:10-12`](../../packages/server/src/http/run/pulse-loop.ts)) and `SimulationRuntime.start()` (period = interval + duration, [`pulse-scheduler.ts:157-162`](../../packages/server/src/simulation/pulse-scheduler.ts)). All time comes from an injected `Clock`.

```text
# base lane
nextBaseAt = clock.now() + interval                  # 6000 ms (D52); optional seeded jitter inside 5000..8000 ms
loop while state == running:
    wait until nextBaseAt                            # abortable
    runtime.runPulse(sim, { reason: "base", elapsedMs: since(lastPulseAt) })   # not awaited by the focus lane
    nextBaseAt = max(clock.now(), startedAt + interval)   # drift-free: no catch-up bursts
    lastPulseAt = clock.now()

# focus lane (independent of the base lane)
requestFocused(ids):
    pending |= ids
    if clock.now() >= windowEnd:                     # first line: fire at once
        windowEnd = clock.now() + 300
        fire()
    elif no follow-up armed:                         # lines inside the 300 ms window coalesce
        arm(windowEnd, fire)
fire():  runtime.runPulse(sim, { reason: "human_chat", focusAgentIds: pending.take(), elapsedMs: since(lastPulseAt) })
```

Rules: one base pulse in flight at a time and one focused pulse per window, on separate lanes gated by per-agent locks, with `PERFECTMAN_LLM_CONCURRENCY` (3) shared and one slot reserved for addressed replies ([ADR-0020](../adr/0020-decide-generate-commit-and-focused-pulse.md)); addressed replies jump ambient lines in the gateway's 2.5 s room queue; a base pulse that overruns skips the missed beats rather than bursting; `pause` stops the timers and resolves the in-flight pulse; `stop` aborts and drains with the bounded wait the controller uses (30 s, [`run-controller.ts:38`](../../packages/server/src/http/run/run-controller.ts)). The simulation's `pulseIntervalMs` setting stays inside the schema range (500-10000, [`simulation.schema.ts:16`](../../packages/shared/src/simulation/simulation.schema.ts)) and is set to the base interval (6000) so decay math keeps its meaning.

## 10. `onConsult` and the typing bubble

The scheduler calls `onConsult({ agentId, reason, addressed })` when a generate task takes its concurrency slot, immediately before `generateIntent` ([ADR-0020](../adr/0020-decide-generate-commit-and-focused-pulse.md) D-74). The run registers a callback that records `consultAt[agentId]` and sends `typing{on}`. `consultAt` feeds the landing-time formula in section 7, so typing overlaps model latency instead of adding to it. `PresenceProfile.responseDelayMs` ([`persona-pack.types.ts:56`](../../packages/shared/src/persona/persona-pack.types.ts)) is read by the gateway from the run's cast; the engine does not need it.

## 11. Space mirror, planner and executor

- `SpaceMirror` applies hello, `room_snapshot`, `{ rev, room, msg }` deltas, `room_ping`, `walk_started`, `arrived` and `moved_room` to the shared reducer, detects **per-room** rev gaps (resnapshot, that room `degraded`, lead resolution R5; there is no global rev), dead-reckons walkers, and exposes `SpaceView` projections to `engineSnapshotProjection`. A room is stale after 5 s without any frame for it (delta, snapshot or `room_ping`) ([`../embodiment.md`](../embodiment.md) 3.1). The mirror is shared by every run, so an actor is keyed inside it by its run-scoped ref `r<run>.<ref>` (two runs of one scenario both have a `person-1`); each run reads and writes through `ScopedMirror`, which speaks the plain ref, and another run's actor in a shared room appears under its scoped ref. Two runs can therefore share character ids.
- `plan()` is pure ([ADR-0018](../adr/0018-physical-space-model-and-embodiment.md) D-66) and is called at commit time per actor and by the executor on `arrived` and choreography steps.
- `BodyExecutor` holds the stateful parts: in-flight `BodyPlan`s with ETA, `PendingSpeech` (released through `resolveDeferred` on `arrived`), the pair-choreography state machine, hysteresis memory, and the command budget bookkeeping. For a human target the executor just sends `actor_cmd{pair}`; the hotel raises the reaction chip (`PairPrompt`) and returns `pair_reaction` (D31, R6), which the executor turns into an emotion event and a relationship memory.
- ETA = route tiles x 300 ms, checked against the hotel's `walk_started{eta_ms}`; a mismatch above 30% is logged as a probe signal, not corrected.

## 12. Guest ingestion and untrusted text

Implements [ADR-0022](../adr/0022-guests-and-human-ingestion.md) and [ADR-0023](../adr/0023-untrusted-human-text-in-prompts.md). Steps for each `human_chat` frame from a room containing at least one of the run's actors:

1. Drop frames from rooms with no actor of the run.
2. Sanitize text and name (NFKC, control and bidi stripping, length caps, alias on failure); never forward `h:<userId>` into a prompt.
3. Resolve the addressed set: names via the exported mention matcher; else "the only other person within social band".
4. Compute `hearing` and `visibleToAgents` from the mirror (say 6 / 10 tiles, shout room, whisper target with bystanders <= 2 tiles at level `notice`; D44).
5. Append `message_sent` with `untrusted: true`, current `pulseIndex`, salience (`high` if addressed or shouted); use the `operator_only` shape when nobody hears it.
6. Notify the arbiter (`noteHumanLine`), request a focused pulse for the addressed actors, apply the ingestion cap (8 lines per 5 s per run).
7. Admin commands never come through here; `pm_command` frames are separate.

Human-initiated whispers to an actor are ingested the same way with the target as sole `clear` hearer; the actor may answer with a whisper through the normal pipeline. The prompt never tells the actor what a speaker is (D43). Third-party text leaves the hotel for the external LLM without notice (D40); the acceptance is recorded in ADR-0023.

## 13. LLM configuration, governor and breaker

Configuration (D16): every actor's `LLMConfig` is built by the sidecar from env, never from the scenario or the browser.

```ts
const llm: LLMConfig = {
  providerType: "openai-compatible",
  baseUrl: env.PERFECTMAN_LLM_BASE_URL,
  apiKeyEnv: "PERFECTMAN_LLM_API_KEY",          // the NAME of the variable, as the schema requires
  modelName,                                      // must be in PERFECTMAN_LLM_MODELS, else a diagnostic
  maxInputTokens, maxOutputTokens, temperature, timeoutMs, retryCount,
  responseFormatJsonSchema: true,
};
```

Field names are those of [`llm-config.ts`](../../packages/server/src/llm/llm-config.ts). A scenario that names a model outside the allowlist is rejected at `start`. The run panel shows the live LLM p95 (from `recordUsage` timings) and warns when it drifts above 6 s (D53). Run artifacts pass through `scrubConfigForArtifact` ([`secrets.ts:40`](../../packages/server/src/http/run/secrets.ts)); the per-run key mechanism in that file is not used, since the key is a host env var.

Budget ([ADR-0025](../adr/0025-llm-budget-and-circuit-breaker.md)): the run registers limits with `mode: "warn"`. `canCall` is invoked from `agent/surface/action-intent-step.ts` (lines 92 and 257) and `world/goal-layer-llm.ts:76`; `getPriority` from `pulse-scheduler.ts:349`; addressed maps to `high`. Cost per run = tokens from `recordUsage` x `PERFECTMAN_LLM_PRICES`, reported to the hotel in `run_status` every 5 s with calls, tokens, cost, breaker state, `pause_cause` and `undelivered_committed`.

`LlmGovernor` wraps each provider (through the `AgentRuntime` `providerFactory` parameter): honors `Retry-After`, applies jittered exponential backoff on 429, shares a penalty window across runs. `LlmCircuitBreaker` counts consecutive provider failures per run (5), opens, auto-pauses with cause `breaker`, notifies admins, half-opens after 15 s doubling to 5 min.

## 14. Director WS client and internal HTTP client

Contracts are in the hotel's `director-protocol.md`. The sidecar implements:

- `DirectorClient`: connect with the secret, reconnect with backoff 1, 2, 4, 8 s (cap 8, +-20% jitter; the whole schedule fits inside the hotel's 15 s grace), `run_heartbeat` every 5 s per live run including while paused, per-run lease tracking (`lease` frames), `hello` reconcile (section 6.3), `{ rev, room, msg }` ordering with gap detection, a send queue with bounded depth, and a frame recorder.
- `HotelHttpClient`: scenario versions, scenarios (preset import), player memory (read and upsert), artifact registration, the figure catalog, with timeouts and retry on idempotent calls only. Run rows are hotel-owned (created before `run_start`); counters travel in `run_status`, not over HTTP.
- Transport choice: Node 22's global `WebSocket` (stable since 22.4.0; **verify against the pinned base image**) unless it lacks reconnect or ping control, in which case `ws` is added.
- `AuthoringService` exposes `validate`, `compile`, `draft`, `autolook` and `presets` over `compileRunInputs` and `draftStory` ([`http/server.ts:114-134`](../../packages/server/src/http/server.ts)). `AuthoringServer` serves them as JSON over the authoring listener (section 4). The hotel's admin API calls it as a background job and the browser polls the hotel, because Caddy cuts responses at 30 s (lead resolution R3; `director-protocol.md` section 7). The Director WS carries live run traffic only.
- **The draft path** (`draft`, the builder's "Draft with AI") applies the `perfectman-cast-and-scenario-drafting` skill within what the draft type can carry. `draftPrompt` ([`story-draft.ts`](../../packages/server/src/authoring/story-draft.ts)) asks, in the user's language with English keys, for each person's goal (wanted from another named person), `obstacle`, `method`, `standing` (high or low) and whether it `flips`, and for `beats`: at most one earned physical peak, one rung per beat from rung 2, one aftermath beat, the 18 verbs only (the lists are built from `ACT_VERBS`, `ACT_TARGET_MODE` and `LADDER_VERBS`, never retyped), no weapon, blood or `@human`. The reply is untrusted: `repairBeats` ([`draft-beats.ts`](../../packages/shared/src/live/draft-beats.ts)) drops an unknown verb, `@human`, a stranger, a missing or extra target and a self-aim, keeps one death, moves physical beats to 20 s apart, moves the first beat to 15 s, drops a skipped rung that is not the peak (the peak carries `skip: true`), adds a cut after a death, and derives the smallest `drama` block (`max_rung` = highest rung used, only the needed `may_target` pairs, only the victim in `may_die`, `permadeath` when someone dies). `roomFiles` writes `drama:` and `beats:` into the scenario frontmatter by agent id, puts standing in the persona's `## Voice` as manner and obstacle plus method as one `## Triggers` entry, and opens a contact pair standing side by side in `## First Move`. With `PERFECTMAN_LLM_CHAIN` set, the draft follows the chain (`hotel-llm-chain.md`, Failover): `AuthoringService.draft` hands `draftStory` the links in order, each with its own `baseUrl`, model, key (`process.env[link.apiKeyEnv]`; a link with an empty variable is skipped), the headers the chain client sends (`linkHeaders`, with a fresh session id per draft) and `extraBody`, and a non-2xx, network error, timeout, empty reply or two unreadable drafts moves on to the next link; with no chain it makes the one legacy `baseUrl` + `PERFECTMAN_LLM_API_KEY` request. A draft is long, so each attempt gets at least 60 s whatever the link's `timeoutMs` (the pulse default is 5 s), capped at 90 s. When every link fails the 503 `llm_unavailable` keeps its short message and carries each link's name and the provider's own words in `errors[0].message`, never a key. `AuthoringService.draft` then compiles the bundle as a loaded scene is; if the loader refuses the script, or the block would veto a beat, the story ships without the script (free play). Not carried by the type, so prompt-only: super-objective, status matrix across pairs, `STEERED` beats, the stage frame, `plan.json`.

The sidecar never trusts a frame's room or actor ids it has not seen in `hello`/snapshots; unknown ids are logged and dropped.

## 15. Fake grid hotel

Deterministic stand-in for Tilehouse behind `IBodyGateway` and a `DirectorTransport` interface, so mock-provider runs and probes need no hotel.

| Aspect | Rule |
| --- | --- |
| Clock | injected; one tick = 300 ms; walkers advance one tile per tick |
| Layouts | 3 fixtures in Phase 2 (lounge with bar, sofas and window; bedroom; hallway with a door between them); the wing rooms are added as fixtures in Phase 3 |
| Pathing | BFS over 8 directions with the corner rule; goal on a seat means sit on arrival |
| Limits | 8 commands per 5 s per actor, `walk` included (the hotel's own actor limiter, lead resolution R10; Tilehouse itself has none for walk) -> `slow_down`; chat 4 per 6 s per actor; join interval 200 ms |
| Gestures | durations Wave 5000, Blow 1400, Laugh 2000, Thumbs 2000, Sign 5000; refused while walking; sit snaps `dir` even |
| Rooms | `move_room` through the door tile; occupants and adjacency |
| Humans | scriptable: `say(mode)`, `walk`, `type`, `enter`, `leave` |
| Output | a `BodyFrameLog` in both directions, with space snapshots, consumed by the body probes |

The rules are copied from the **[T]** table in [`../embodiment.md`](../embodiment.md) section 1.1. Drift is checked by a recorded-trace parity test in Phase 2 (traces captured from the Tilehouse end-to-end tests), not by copying more rules.

## 16. Image and compose expectations

- `packages/hotel/Dockerfile`: multi-stage like the root [`Dockerfile`](../../Dockerfile) (pinned pnpm via corepack, manifests first for layer reuse, `pnpm install --frozen-lockfile`, builds in order `shared`, `engine`, `server`, `hotel`, a runtime stage with `--prod --filter` for those four packages), `node:22-bookworm-slim`, non-root user, no `EXPOSE`, `CMD ["node", "packages/hotel/dist/main.js"]`, `STOPSIGNAL SIGTERM`, `HEALTHCHECK` against the loopback endpoint.
- Compose (owned by the hotel repo, `deploy/compose.server.yaml` and `setup-server.sh`): service `perfectman-hotel`, same host, internal network only, **no published port**, `env_file` carrying the section 4 variables (the authoring port stays unpublished; the hotel container gets `PERFECTMAN_SIDECAR_URL`), a volume at `/data/perfectman` (shared with the hotel container, same uid or a group-writable directory), `restart: unless-stopped`, `stop_grace_period: 20s`, depends on the hotel service.
- The root `Dockerfile` and `fly.toml` are unchanged.

## 17. Test strategy

Lean, per [`../testing-strategy.md`](../testing-strategy.md): seams and probes, each invariant at the lowest layer that can fail, an injected clock (no sleeps), seeded rng, no real network.

| Seam | Layer | What fails it |
| --- | --- | --- |
| Director client | integration against a scripted fake server | reconnect, lease renewal, rev gap resnapshot, unknown-id drop |
| `validateBodyIntent` | property (fast-check is already a dev dependency of `engine`) | every code reachable; never throws; speech half never dropped |
| `plan()` | table plus property | no direction reversal inside dwell; <= 4 commands per 5 s; gesture cooldown |
| Arbiter | table-driven | each rule, addressed exemption, `fallback_committed` outcome |
| Ingestion | table-driven | sanitization, addressing, `hearing` levels, `operator_only` shape, cap |
| Gateway queue | integration, fake clock | landing time, 2.5 s spacing, overflow policy, enqueue-and-return |
| Lifecycle | integration, fake clock | every transition in 6.2, D41 and D46 timers, cause-aware resume |
| Governor / breaker | integration, fake provider | 429 backoff, open, half-open, resume only for breaker pauses |
| Pulse clock | integration, fake clock | cadence without drift, debounce, no catch-up burst |
| End to end | one suite on the fake grid hotel with the mock provider | spawn, walk, speak, react to a scripted human, stop, walk out; killing the transport leaves 0 actors |
| Probes | eval probes over the frame log | embodiment.md section 10 |

Not planned: per-class unit tests that restate the code, snapshot tests of prompts beyond one canonical fixture, tests that need the real Tilehouse (those are the hotel repo's end-to-end suite).

## 18. Phases

- **Phase 1** (contracts freeze, spike): `director/generated.ts`, `IBodyGateway`, `BodyIntentSchema`, runtime API (`runPulse` options, `onConsult`, `getPulseIndex`, `resolveDeferred`), latency spike with 12 mock agents and a real model through the split.
- **Phase 2** (default-mode foundation): everything in sections 3-17 for default mode, including the authoring listener (validate, compile, draft); exit demo: an admin builds a scenario, four actors walk in, talk, sit, react to a human, then stop and walk out; killing the sidecar mid-run leaves 0 actors; probes green on mock.
- **Phase 3** (default mode complete): pair acts and consequences, player memory, live controls, the 8-room wing (added to the fake grid fixtures), preset import and auto-look (`presets`, `autolook`), canary red-team set, dark-launch deploy.
- **Phase 4** (cinematic): `Director` (beats from `shared/src/stage/live-to-beats.ts`, lookahead, shot planner, cuts, SFX cues, narrator pass), the director track, any room allowed (D45).
- **Phase 5**: replays, clips, sprites.

## 19. Open questions

| # | Question | Default |
| --- | --- | --- |
| 1 | Can `@perfectman/server` be imported without loading Discord, Ollama and SQLite modules at runtime? | **Resolved in Phase 2**: `@perfectman/server/hotel` (`packages/server/src/hotel.ts`) re-exports only what a hotel run needs, `better-sqlite3` and `ollama` load on demand (`createRepositories`, `generateOllamaIntent`), and `simulation-config.ts` imports the delivery modules directly instead of the barrel. `hotel-entry.test.ts` fails if any of the three loads at init. The barrel still loads them |
| 2 | Retention window (2000 events) and ingestion cap (8 per 5 s) are seeds | Calibrate in the Phase 2 soak test |
| 3 | Cost stop: v1 has warnings only (D11); revisit after real cost data | None |
| 4 | Does a breaker pause auto-resume on half-open success (ADR-0025, as specced here) or wait for an admin (a stricter reading of lead resolution R2)? | Settled by D49: auto-resume after one successful half-open call; admin notified on pause and resume; never ends on a timer |
| 5 | Shape of `scenario_versions.source` and `body` | `source` is a bundle: `=== file: name ===` lines separate the scenario and persona files (`authoring/source-bundle.ts`). `body` is `{ v: 1, title, config, seeds, maxPulses, looks?, responseDelays? }` (`run/scenario-body.ts`); agents carry a placeholder model that the host's config replaces at run start |
| 6 | Where the live LLM p95 travels (D53) | **Resolved**: `run_status` carries optional `llm_p50_ms` and `llm_p95_ms` (schema vendored from Tilehouse `feat/pm-integration`); `lag_ms` is the sidecar's event-loop lag (how late the 5 s status timer fires) |
| 7 | Who plans the body | **Resolved**: the server's `onAgentCommitted` calls the run right after each actor's intent is resolved (the `plannerHook: "server"` mode); the old per-pulse tick is gone. The idle sweep only covers actors with no commit in a base pulse |

Resolved by the 2026-11-06 lead resolutions: the 30 min end timer is idle-only (R2); authoring goes over an internal HTTP listener on the sidecar, not the Director socket (R3); the directory is `shared/src/space/` (R1).
