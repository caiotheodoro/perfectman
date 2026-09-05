# ADR-0014: Private Motive As A Committed Event

**Status**: Accepted (LOCKED, 2026-09-04) — rationale and rejected alternatives inline in this ADR (decisions **D-46..D-49**).

**Numbering note**: written against the merged-tree ADRs 0001..0013; in-tree decision high-water mark **D-45** (ADR-0013). The D-46..D-49 range is this ADR's; if another unmerged slice claims the range first, renumber here and reconcile the inline D-refs.

## Context

Every LLM-resolved intent carries a `privateMotiveSummary` — the model-written private truth behind the act, required non-empty by the intent schema. Until this ADR that string reached the log in exactly two shapes: the `action_intent` operator event (ADR-0002, stream-only, never persisted with the committed events) and the payload of `no_op_recorded`/`repetition_blocked` (whole-event operator-only). The public acts — `message_sent`, `reply_sent`, `reaction_sent`, `channel_created` — committed `{content, ...}` and nothing else.

Measured on a real 32-pulse `hoc_fatia_que_nao_existe` run (`deepseek/deepseek-v4-flash`, 68 committed events): 2 events carried a motive, both engine-authored parse-failure strings. The eval judge and the narrator read committed events only, so every rubric axis that scores the private half (`motive_authenticity`, `memory_continuity`, `hidden_payoff`) was scored on visible text alone, and the narrator's `hiddenShift` had nothing private to trace to. Three prompt fixes aimed at those axes did not move them; the input they needed was never in the log.

Constraints carried into the decision: visibility is strictly per-event (`EventVisibility` on `SimulationEvent`; the agent-side operator-only gate keys on `visibilityReason === "operator_only"`, `filter-visible-events.ts`); ADR-0001's stream contract assumes a visible event is fully visible; `EventPayload` is opaque JSON in both repositories; the `private_motive_summary` event type already existed, was already blocked from agents (`AGENT_BLOCKED_TYPES`, perception `OPERATOR_EVENT_TYPES`), was already excluded from the world layer's organic signal history, and had a `SpectatorProjection` case — but nothing emitted it, and the projection whitelisted it as always-spectator-visible.

## Decision

1. **The motive is its own committed event, not a payload field (D-46).** `IntentResolver.resolve` appends one `private_motive_summary` per resolved intent, after the events it explains, with `sourceIntentId: intent.id` (the act's own `sourceIntentId`), `operator_only` visibility, payload `PrivateMotiveSummaryPayload = { summary, intentType, emotionDrivers, motivationDrivers, engineAuthored }`. Public act payloads are unchanged.
2. **Emission is uniform across outcomes (D-47).** Committed, fallback-committed, blocked and delayed intents all leave their motive; a `no_op` intent leaves both the `no_op_recorded` (which keeps `privateMotiveSummary` in its payload for existing readers) and the motive event. The original intent's motive is used even when a fallback was derived.
3. **`engineAuthored` is stamped at emission from one shared predicate (D-48).** `isEngineAuthoredMotive` / `ENGINE_MOTIVE_PREFIXES` live in `packages/server/src/agent/engine-motive.ts`, next to the producers of those strings; the narrator imports it instead of keeping its own list.
4. **Spectators see the motive only in omniscient mode (D-49).** `SpectatorProjection` returns `motive_reveal` for `private_motive_summary` only when `settings.omniscientSpectatorMode`; the type leaves the always-visible whitelist otherwise. `ActionIntentOperatorData` gains `intentId` so stream consumers can join the same way.

## Rationale

- **Own event over payload field (D-46):** every projection today reads named payload keys, so a `privateMotiveSummary` field on `message_sent` would not leak *by convention* — but it would put private data inside an event whose visibility says "visible to all channel members", inverting the invariant ADR-0001 relies on, and every future reader (memory formation, reflection surfaces, the html/Discord receivers) becomes a leak site by default. The event has exact in-codebase precedent: `memoryProposalEvents` commits `memory_written` alongside any intent, operator-only, keyed by `sourceIntentId`.
- **Uniform emission (D-47):** a blocked or delayed motive is precisely the private/public mismatch the spectator layer exists to narrate; joining by `sourceIntentId` rather than by pulse+agent also survives `intent_delayed` (commits later) and derived fallback intents (new id).
- **Shared predicate (D-48):** the narrator, the probes, the runner and the spectator projection all needed the same "is this a feeling or an error" rule; the list lives where `REPETITION_GUARD_MARKER` and `createFallback` live.
- **Spectator gate (D-49):** the pre-existing projection case plus the always-visible whitelist meant emitting the type would have posted every private motive to a plain spectator channel; `visibility-invariants.test.ts` asserted the opposite against an in-test stub, not the class.

## Rejected Alternatives

- **`privateMotiveSummary` on public act payloads** — leak-by-default for every future reader; breaks the per-event visibility invariant (D-46).
- **Eval-only: carry `action_intent` operator events into `ScenarioRunArtifact` and join by pulse/agent** — nothing for real `simulation` runs or the spectator story, and the join breaks on delays and derived fallbacks (D-46/D-47).
- **Emit only for committed acts** — hides exactly the blocked/delayed mismatches worth narrating (D-47).
- **Keep per-reader prefix lists** — three copies of the same convention already drifted between narrator, judge and probes (D-48).

## Consequences

- +1 committed event and +1 `event_visibility` per LLM-resolved intent; within the `docs/observability-stream.md` bounds by construction, the html-receiver parity distribution shifts accordingly.
- Two readers that silently treated bookkeeping as content are corrected in the same change: the scheduler's rolling `recentEventsWindow` (40 events) now excludes `operator_only` events before slicing, so agent-invisible rows no longer consume context slots; the world layer's `deriveDivergenceFromLog` measures over witnessable events only, so an agent's meaning-made divergence no longer grows with the number of agents in the room.
- The eval transcript renderer can now join motives to acts for the judge and narrator; `memory_continuity`/`hidden_payoff` become scorable on what the log actually holds.
- `motive_reveal` is live for omniscient spectators for the first time.
- Readers that render motives must consult `engineAuthored` (or the predicate); the `no_op_recorded` payload copy stays for backward compatibility and can be retired once no reader depends on it.

## Cross-links

- [ADR-0001](./0001-event-visibility-operator-event.md) — per-event visibility signal this decision preserves.
- [ADR-0002](./0002-action-intent-emission.md) — the stream-only `action_intent` this complements (now joinable via `intentId`).
- [ADR-0013](./0013-memory-formation-and-relational-accretion.md) — `memory_written` precedent for operator-only side events keyed by `sourceIntentId`.
- Code: `packages/server/src/simulation/intent-resolver.ts`, `packages/server/src/agent/engine-motive.ts`, `packages/server/src/simulation/projections/spectator-projection.ts`, `packages/shared/src/event/event.types.ts`.
- Tests: `intent-resolver-motive.test.ts`, `spectator-projection.test.ts` (gate), `engine-motive.test.ts`, engine `visibility.test.ts`.
