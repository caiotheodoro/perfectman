# ADR-0018: Physical Space Model and Embodiment

**Status**: Accepted and implemented for the engine side (Phase 2 lane L3, 2026-11-06); the planner and the sidecar driver are `packages/hotel`. Implements D14 and D26. Decisions **D-63..D-66**.

## Context

Perfectman has no space. Agents decide whether to speak; where they are, who is near, who can hear them and what their body is doing do not exist. The hotel integration puts personas into walkable rooms (Tilehouse: 300 ms tick, one tile per tick, discrete gestures, a rate limiter on actions) where humans watch and talk to them.

Constraints carried in:

- The engine is pure and I/O-free. `runEngineStep(snapshot)` ([`run-engine-step.ts:74`](../../packages/engine/src/step/run-engine-step.ts)) takes an `EngineSnapshot` ([`engine.types.ts:41`](../../packages/shared/src/engine/engine.types.ts)) and returns a result; sockets, clocks and the grid belong to a host.
- Behavior without a space model must stay byte-identical. Eval, the web builder and the CLI never have a body.
- Small models degrade with large optional schemas, and Tilehouse allows 8 actions per 5 s per avatar. The model cannot be asked to drive the body at command level.
- Humans in the room judge "alive" by teleports, jitter, staring at walls and speech from out of earshot, all of which are cheap for a deterministic layer to prevent and expensive for a model to remember.

## Decision

1. **The body is hybrid (D-63).** The model may add an optional `body` block to its intent ([ADR-0019](./0019-body-intent-schema.md)): where to go, what posture, one gesture, one expression, who to face. A deterministic embodiment planner owns everything else: facing the speaker, proxemics from `RelationalState`, shouting on high arousal, fidgeting during silence, sitting when tired, anti-jitter, anti-clustering, pair choreography. The model never emits coordinates or raw commands, only handles (`p#` people, `z#` places, `f#` furniture, `r#` rooms) minted per render.
2. **Space state is a pure reducer in `shared` + `engine` (D-64).** Types live in `packages/shared/src/space/`; the reducer, `deriveZones`, the body-intent validator and the body-perception builder live in `packages/engine/src/`. A host adapter (the hotel) translates wire frames into reducer actions. The per-agent projection `SpaceView` rides an optional `EngineSnapshot.space?`; when it is absent every path behaves as today.
3. **Co-presence is the truth for who perceives what (D-65).** Each hotel room is a public channel `room:<id>` whose members are the actors inside it. Walking through a door is `ChannelRegistry.removeMember` then `addMember` ([`channel-registry.ts:39`](../../packages/server/src/simulation/channel-registry.ts)). Two actors within 2 tiles may form a huddle: a private channel delivered as whispers and suspended when they move apart. Hearing by distance is computed per listener at commit time ([ADR-0022](./0022-guests-and-human-ingestion.md), [ADR-0021](./0021-room-speech-arbiter.md)). Humans keep room-wide chat; only actors hear by distance (integration decision D29).
4. **The planner is pure but lives in `packages/hotel` (D-66).** Types, reducer, validator and perception are generic and go upstream (D26). The planner's budgets (4 commands per 5 s, gesture cooldowns, the 300 ms tick, Tilehouse gesture durations) are host-specific, so `plan(space, agentState, committedEvents, bodyIntent?, rng)` ships with the adapter ([ADR-0026](./0026-hotel-adapter-package.md)). A stale world (older than 5 s) yields no body commands.

## Rationale

- Hybrid keeps authorial control ("go to the bar, then say this") where the model is good and delegates continuity where it is bad. The planner's rules are all measurable by frame-log probes (teleport, jitter, facing rate; see `embodiment.md` section 10), which a model-driven body is not.
- A pure reducer makes the space replayable: recorded Director deltas through the same reducer reproduce the room for probes and for D39 replays, with no socket.
- Channels already model "who can see what" (`filterVisibleEventsForAgent`, [`filter-visible-events.ts:21`](../../packages/engine/src/visibility/filter-visible-events.ts)). Tying membership to occupancy reuses that machinery instead of adding a second visibility system.

## Rejected Alternatives

- **The model drives the body through tool calls** — one extra round trip per command, 8 commands per 5 s budget, and observed small-model schema degradation. Latency would also break the 5 s addressed-reply target.
- **A fully deterministic body with no `body` block** — cannot express intent-bound movement ("walk to Rafa, then speak"), and removes the authored-scenario lever.
- **Space model inside the sidecar only** — perception could not be built in the pure engine, and probes and replays would need the live socket.
- **A separate hearing/visibility system parallel to channels** — duplicates `visibleToAgents`, membership and the delivery projection.

## Consequences

- New: `PerceptionPacket.body?` ([`perception.types.ts:7`](../../packages/shared/src/perception/perception.types.ts)), `EngineSnapshot.space?`, `ActionIntent.body?`, event types `body_action_committed`, `body_arrived`, `moved_room`, `body_blocked`, `speech_deferred`, `paired_act_aborted` (the closed `EventType` union at [`event.types.ts:4`](../../packages/shared/src/event/event.types.ts) grows).
- `PulseScheduler.updateCurrentChannelAnchors` ([`pulse-scheduler.ts:793`](../../packages/server/src/simulation/pulse-scheduler.ts)) needs a `moved_room` case, otherwise an actor keeps resolving its default channel to the room it left.
- The types live in `packages/shared/src/space/`, not `world/`, so they do not collide with the unrelated goal-layer "world" (`packages/server/src/simulation/world/`, [ADR-0008](./0008-world-goal-layer.md)). The types are `SpaceModel` and `SpaceView`; the sidecar driver is `SpaceMirror` (lead resolution R1). "World" in this repo keeps its goal-layer meaning.
- A deterministic fake grid hotel behind `IBodyGateway` is required so mock runs and CI probes need no Tilehouse ([ADR-0026](./0026-hotel-adapter-package.md)).

## Implementation notes (Phase 2 L3)

- Reducer, `deriveZones`, pathing, `projectSpaceView` and the constants live in `packages/engine/src/space/`; the builder, renderer and compressor in `packages/engine/src/perception/`. The reducer is `applySpaceAction(model, action)` over `room_snapshot`, `room_delta`, `room_ping`, `agent_room`, `agent_body` and `authored_places`; it mutates the model in place and reports a gap with `resnapshot`.
- `runEngineStep` builds `perceptionPacket.body` and `bodyHandles` only when `snapshot.space` is present; without it the packet has no `body` key. `PulseScheduler` reads the view from a `SpaceMirror` (`PulseSchedulerConfig.spaceMirror`) once per decision, at wall-clock time.
- `RoomAdjacency` gained an optional `name` (the engine cannot name another room from the current room's view alone).
- `moved_room` is handled in `PulseScheduler.updateCurrentChannelAnchors`: the actor's default channel becomes the channel the event is committed on (the destination room). The host appends `moved_room` on the destination room's channel.
- The planner stays out of the server. The host receives each resolved intent through `onAgentCommitted(AgentCommitInfo)` (validated body, targets, deferral, the agent's `SpaceView`, committed events), which carries exactly the planner's inputs.

## Cross-links

[ADR-0019](./0019-body-intent-schema.md) (the `body` block) · [ADR-0020](./0020-decide-generate-commit-and-focused-pulse.md) (when the planner runs) · [ADR-0021](./0021-room-speech-arbiter.md) · [ADR-0022](./0022-guests-and-human-ingestion.md) · [`../embodiment.md`](../embodiment.md) · [`../plans/hotel-package.md`](../plans/hotel-package.md)
