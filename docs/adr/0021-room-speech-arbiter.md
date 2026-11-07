# ADR-0021: Room Speech Arbiter

**Status**: Proposed (2026-11-06) — implements hotel-integration timing rules 2-5 (one answer per human line, room speech budget, human priority, silence first-class) and the turn-taking scorecard. Decisions **D-76..D-79**.

## Context

Twelve actors in a room with a human is a turn-taking problem the simulation does not have today. The only speech throttle is `RateLimitGate`: per agent, wall-clock, "messages per minute" ([`rate-limit-gate.ts:46-52`](../../packages/server/src/simulation/rate-limit-gate.ts)). It knows nothing about channels, other speakers or humans. [ADR-0020](./0020-decide-generate-commit-and-focused-pulse.md) also removes the one implicit damper: agents generating concurrently no longer see each other's same-pulse lines.

How the resolver treats a denied line decides what the simulation believes happened:

- `IntentResolver.resolveInternal` checks `RateLimitGate.allowAction` ([`intent-resolver.ts:632`](../../packages/server/src/simulation/intent-resolver.ts)) before `recordAction` ([`:705`](../../packages/server/src/simulation/intent-resolver.ts)). A denial there is flagged `rateLimited: true`, and `resolveWithFallback` ([`:547-593`](../../packages/server/src/simulation/intent-resolver.ts)) then returns without trying the fallback ([`:553`](../../packages/server/src/simulation/intent-resolver.ts): "a denied action must not become a route around the gate").
- A non-rate-limit denial does try `fallbackIfBlocked`, which `composeIntentPacket` stamps as `no_op` for `send_message` and `reply_to_message` ([`intent-packet.schema.ts:175,218`](../../packages/shared/src/intent/intent-packet.schema.ts)). The result is outcome `fallback_committed`: a committed `no_op_recorded`, no outward-act stamp, no pressure discharge ([`pulse-scheduler.ts:422-459`](../../packages/server/src/simulation/pulse-scheduler.ts)). The simulation records that the agent stayed silent. That is the right outcome for a line nobody will hear.

## Decision

1. **A `RoomSpeechArbiter` consulted by `IntentResolver` (D-76).** It is a small class constructed next to `RateLimitGate` per simulation ([`simulation-runtime.ts:117-118`](../../packages/server/src/simulation/simulation-runtime.ts)) and passed to `IntentResolver` as an optional dependency. It keeps per-room state on the wall clock: last actor line, actor lines since the last human line, the last human line (id, time, addressed set, who has answered), human typing, scenario energy. It applies only to `send_message` / `reply_to_message` in a room channel (`room:<id>`).
2. **A denial is `policy_blocked`, never `rateLimited` (D-77; owner/lead resolution R10 of the hotel decision log).** The arbiter runs after `allowAction` and before `recordAction`, so a blocked line spends no rate-limit counter. It returns `{ outcome: "blocked", violation: { type: "policy_blocked", detail: "room_speech:<rule>" } }` with `rateLimited: false`, which sends it through the existing fallback to `no_op`. Rules, in order: `human_typing` (ambient or interjection while a human types, up to 6 s), `not_addressed_open_line` (a non-addressed actor speaking into a human line that still has unanswered addressees), `line_budget` (more than `max(3, addressees)` actor lines since the human line), `ambient_too_soon` (ambient before 10 s without human speech, scaled by scenario energy). Addressed replies are never blocked by these rules.
3. **Spacing delays, it does not block (D-78).** "At most one actor line per 2.5 s per room" is enforced by the hotel gateway's per-room delivery queue ([`plans/hotel-package.md`](../plans/hotel-package.md) section 7), not by the arbiter: an addressed reply that collides is delivered late, not dropped.
4. **Two checkpoints (D-79).** `arbiter.preview(agentId, room)` runs in the decide phase; if the agent is not addressed and the preview says blocked, the scheduler skips generation and records no LLM call, so a blocked agent does not burn a model call every pulse (a denied act is not discharged, so its pressure would keep re-triggering). `arbiter.gate(...)` runs in the resolver and is authoritative, because room state changes while models generate.

## Rationale

- The `fallback_committed` path is already the repo's definition of "tried, could not, stayed quiet". Reusing it means probes (`noop-meaningfulness`, silence misreading) and the spectator layer see a real, recorded silence rather than a missing turn.
- Putting the budget in the resolver, not the gateway, keeps blocked lines out of the event log. A gateway-side drop would leave a committed `message_sent` the room never heard, the S1 failure "sim believes it spoke".
- `policy_blocked` already exists in the `IntentViolation` union ([`intent.types.ts:44-54`](../../packages/shared/src/intent/intent.types.ts)); no shared type change.

## Rejected Alternatives

- **Extend `RateLimitGate` with room state** — it is typed `(agentId, intentType)`, per agent; and a `rateLimited` flag would suppress the fallback, the opposite of what is needed.
- **Block in the delivery gateway** — see Rationale; also hides the block from `intent_blocked` operator events the probes read.
- **Let the model decide with a "someone else is talking" prompt line** — unenforceable and costs a call per refusal.
- **One global "turn" token passed between actors** — kills the ambient bot-to-bot talk the scenarios exist for.

## Consequences

- `IntentResolver`'s constructor grows an optional argument; every existing `new IntentResolver(gate, registry)` call site compiles unchanged.
- The turn-taking scorecard rows (addressed reply latency, dog-pile rate, bot lines while a human types) read from `intent_blocked` events with `room_speech:*` details plus the frame log.
- An addressed agent that the arbiter delays, then the human leaves or the run pauses, can leave a committed-but-undelivered line; the gateway counts these (`undelivered_committed`) and the probe target is 0.
- Rule 3's cap on addressed replies (`max(3, addressees)`) is a seed; it is calibrated after the first real runs.

## Cross-links

[ADR-0016](./0016-pressure-discharge.md) (why a denied act leaves its pressure) · [ADR-0020](./0020-decide-generate-commit-and-focused-pulse.md) · [ADR-0022](./0022-guests-and-human-ingestion.md) · [`../embodiment.md`](../embodiment.md) section 8
