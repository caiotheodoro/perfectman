# ADR-0022: Guests and Human Ingestion Through the Event Log

**Status**: Accepted and implemented on the runtime side (Phase 2 lane L3, 2026-11-06); sanitizing, addressing and hearing for humans are `packages/hotel`. Implements D22 and D29. Decisions **D-80..D-84**.

## Context

A human in a run's room is not an agent: no `AgentState`, no persona, no pulse, no channel membership. Their lines still have to reach the actors as events the engine understands. Participant classes used here: **Actor** (AI avatar), **Guest** (human in a default-mode run's home room), **Passer-by** (human in any other room that currently holds one of the run's actors), **Audience** (human in a cinematic run, watcher only, never ingested), **Admin** (steers through commands only).

Facts about today's code that constrain the path:

- `SimulationCommand.inject_intent` is declared ([`command-handlers.ts:13`](../../packages/server/src/simulation/command-handlers.ts)) but nothing dispatches it, and it carries an `ActionIntent`, which presumes the author is an agent with a motive summary, drivers and memory writes.
- `SimulationRuntime.getEventLog()` ([`:330`](../../packages/server/src/simulation/simulation-runtime.ts)) exposes `EventLog.append`. The scheduler picks appended events up on its next pulse because it reads `getAfter(sim, lastCommittedEventId)` ([`pulse-scheduler.ts:222`](../../packages/server/src/simulation/pulse-scheduler.ts)) and the full window ([`:230`](../../packages/server/src/simulation/pulse-scheduler.ts)); appends made outside `appendAndProject` skip the delivery, spectator and operator projections, so a human line is never echoed back to the hotel as actor speech.
- "Addressed" is read from the event payload: `mentionedAgentIds` containing the agent, or a `reply_sent` with `replyToActorId` ([`score-attention.ts:76-95`](../../packages/engine/src/attention/score-attention.ts)). The mention matcher is module-local to the resolver ([`intent-resolver.ts:97`](../../packages/server/src/simulation/intent-resolver.ts)) and skips ambiguous or one-letter names.
- Visibility: `visibleToAgents` empty means every channel member ([`filter-visible-events.ts:55`](../../packages/engine/src/visibility/filter-visible-events.ts)); an event with empty `visibleToAgents`, `visibleToSpectators: false` and reason `operator_only` is hidden from all agents ([`:46-52`](../../packages/engine/src/visibility/filter-visible-events.ts)).
- The in-memory repository stamps `pulseIndex: evt.pulseIndex ?? 0` on append ([`in-memory-stores.ts:38`](../../packages/server/src/simulation/in-memory-stores.ts)).

## Decision

1. **Humans enter as `message_sent` events appended to the event log (D-80).** The hotel adapter calls `runtime.getEventLog().append` for every `human_chat` frame from a room that contains at least one actor of the run. `actorId` is `h:<userId>`. Payload: `content` (clipped to 200 chars, the Tilehouse limit), `untrusted: true`, `senderKind: "guest" | "passerby"`, `senderName` (sanitized, [ADR-0023](./0023-untrusted-human-text-in-prompts.md)), `mentionedAgentIds` / `addresseeIds` (see 3), `hearing` (see 2), `speakerTile`, `mode` (`say` / `shout` / `whisper`). `pulseIndex` is the scheduler's current index, read through a new `SimulationRuntime.getPulseIndex(simulationId)`. `inject_intent` is not used and stays undispatched.
2. **Hearing is computed per listener at ingestion and at agent commit (D-81).** The adapter reads the space mirror and writes `visibleToAgents` (the actors that hear at all: say clear <= 6 tiles, garbled 7-10, shout the whole room, whisper the target plus bystanders <= 2 tiles who only notice) and `payload.hearing: { [agentId]: "clear" | "garbled" | "notice" }`. When no actor hears the line the event gets the `operator_only` shape (empty list, `visibleToSpectators: false`) because an empty `visibleToAgents` would mean "everyone" (lead resolution R10). The engine's visibility step redacts `content` for listeners whose level is not `clear` before anything downstream sees it (`embodiment.md` section 5). Actor lines get the same stamping at commit through a resolver hook.
3. **Addressing is resolved by the adapter, not the model (D-82).** The adapter fills `mentionedAgentIds` by name match (the resolver's matcher, exported) and, when nobody is named, by "the only other person within social band" (timing rule 1). `emotionalSalience` is `high` when addressed or shouted, else `medium`. The arbiter reads the same addressed set ([ADR-0021](./0021-room-speech-arbiter.md)); the same event requests a focused pulse for the addressed agents ([ADR-0020](./0020-decide-generate-commit-and-focused-pulse.md)).
4. **Guests are never channel members and never agents (D-83).** Only actors are in `ChannelRegistry`. Room membership of actors changes through `addMember` / `removeMember` and applies at the next pulse. Guests have no `RelationalState`; `deriveAddresseeIds` drops ids not in `agentNames` ([`intent-resolver.ts:177-181`](../../packages/server/src/simulation/intent-resolver.ts)), so existing accretion does not model guests. Remembering players across a run is the separate `scenario_player_memory` feature (Phase 3).
5. **Ingestion is rate-bounded and logged whole (D-84).** Tilehouse already limits human chat (5 lines per 5 s). The adapter additionally caps ingestion at 8 lines per 5 s per run; lines over the cap are still appended (replay completeness) as `operator_only` with no focused pulse. Admin commands (`:pm ...`) never pass through this path: the hotel intercepts them before chat, and guest text is never parsed for commands.

## Rationale

- The log is the single canonical write path ("only the event runtime commits durable facts"); an injected intent would require inventing a motive, drivers and an `AgentState` for someone who has none.
- Computing audibility from the space mirror at ingestion keeps the engine pure: it only sees a list and a level.
- Resolving addressing in code removes a model call and a failure mode from the most latency-sensitive path.

## Rejected Alternatives

- **Dispatch `inject_intent` for humans** — wrong type (needs an `ActionIntent` with a private motive), no dispatcher, and it would run through the resolver's rate gate and fallback as if the human were an agent.
- **Register guests as agents with a stub persona** — they would get pulses, state and LLM calls.
- **Deliver human lines to the engine as `operator_injection`** — that attention reason is for admin steering; D22 forbids guest text steering.
- **Send everything to every actor and let the model judge earshot** — violates D29 and costs tokens for lines nobody could hear.

## Consequences

- New runtime surface: `getPulseIndex`, an exported mention matcher, a resolver/commit hook for actor audibility stamping.
- Human lines appear in the replay log and in `chat_log` (hotel side) but not in the operator feed (no `emitEventVisibility`).
- The engine step gains a redaction map after `filterVisibleEventsForAgent` ([`run-engine-step.ts:91`](../../packages/engine/src/step/run-engine-step.ts)); an event with `hearing[agentId]` other than `clear` is passed with `content` removed.
- Humans may whisper to actors (owner decision D44). A whisper arrives as `human_chat` with `mode=whisper`, is ingested with the target as the only `clear` hearer and bystanders within 2 tiles at level `notice` ("X whispers to Y", no text), and the actor may whisper back through the same hearing rules. Both directions go to `chat_log` on the hotel side (D42).

## Implementation notes (Phase 2 L3)

- `SimulationRuntime.ingest(line: GuestLineInput)` (the frozen `GuestIngest`) appends an untrusted `message_sent` through `EventLog.append` with `pulseIndex` from `getPulseIndex`, clips content to 200 characters and never projects it to a gateway. The hotel feeds the arbiter itself (`getArbiter(simId).noteHumanLine / noteHumanTyping`).
- Membership: `registerRoomChannel(simId, { id: "room:<id>", name })` (the registry now accepts a fixed channel id), `addChannelMember` and `removeChannelMember` (mirrored to the delivery gateways); they apply at the next pulse.
- Actor lines are stamped at commit through a resolver hook: `payload.senderName`, `payload.mode`, `payload.hearing` and `visibleToAgents` from `computeActorAudibility(model, speaker, mode, whisperTo)` over the `SpaceMirror` (say clear to 6 tiles, garbled to 10; shout the room; whisper the target, bystanders within 2 tiles notice). A line nobody hears takes the `operator_only` shape.
- Redaction is `redactForListener` in `packages/engine/src/visibility/filter-visible-events.ts`, applied in `runEngineStep` right after the visibility filter only when `snapshot.space` is present: a `garbled` or `notice` listener loses `content` and the payload gains `heardAs`. A garbled line still reads in full for a listener it names.
- A whisper notice names the whisper target from `payload.whisperToName` when the host stamps it (sanitized like any name); the prompt otherwise says "someone".
- `parseMentionedAgentIds` is exported for the adapter's addressing.

## Cross-links

[ADR-0018](./0018-physical-space-model-and-embodiment.md) · [ADR-0021](./0021-room-speech-arbiter.md) · [ADR-0023](./0023-untrusted-human-text-in-prompts.md) · [ADR-0001](./0001-event-visibility-operator-event.md) · [`../plans/hotel-package.md`](../plans/hotel-package.md) section 12
