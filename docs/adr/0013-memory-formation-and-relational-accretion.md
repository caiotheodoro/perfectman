# ADR-0013: Memory Formation And Relational Accretion

**Status**: Accepted (LOCKED, 2026-09-02) — rationale and rejected alternatives inline in this ADR (decisions **D-37..D-45**).

**Numbering note**: written against the merged-tree ADRs 0001..0012 (0012 duplicated: `0012-goal-layer-meaning-made-gate.md` and `0012-goal-registry-persistence.md`); in-tree decision high-water mark **D-36** (ADR-0012). The source run's decision log numbered its decisions run-locally D-1..D-10; D-1..D-9 map to **D-37..D-45** here. Run-local D-10 (two-PR merge sequencing) is not converted — sequencing decisions expire at merge. The D-37..D-45 range is this ADR's; if another unmerged slice claims the range first, renumber here and reconcile the inline D-refs.

## Context

A 63-pulse live deepseek run (PR #149 evidence branch) showed both mechanisms absent: `memories: []` and `relationalStates: {}` for every agent despite a 3-message exchange. Issues #136 and #138 (parent plan #119, decisions #126/#127) are the direct fixes.

**#136 — memory formation.** The action-intent prompt's `<output_contract>` listed the `memoryWrites` field but never asked the model to use it. Committed `memory_written` events (engine path only, from `stepResult.memoryProposals`, which `runEngineStep()` always leaves empty) never reached `agentState.memories`, and `write_memory` sat in every agent's permitted actions as a turn-consuming choice the issue wants retired ("memory is a side-channel on a normal action, not a turn-consuming choice").

**#138 — relational accretion.** `updateRelationalEmotions` runs every pulse but no-ops in practice: resolver event payloads carried no participant identifiers (so `isTarget` was false for every observer on message/reaction events), `RELATIONAL_UPDATE_RULES` had no `message_sent` entry, and `isTarget` ignored `invitedAgentIds` so a channel invitee accreted nothing.

Constraints carried into the decisions: `EventPayload` is a loose `Record<string, EventPayloadValue>` (payload additions need no shared schema change); every existing projection under `simulation/projections/` is a read-side view emitter; `rules/10-code-shape.md` forbids abstractions without a second caller; the issue mandates keeping `write_memory` schema/resolver plumbing while removing it from permitted actions.

## Decision

**1. Memory persistence is a scheduler-private method, not a projection class (D-37).** `applyMemoryProjection` lives inside `pulse-scheduler.ts`, consumes committed `memory_written` events, and pushes the payload-mapped `Memory` (id via `createId()`, `sourceEventIds: [event.id]`, commit-assigned timestamps — no wall clock) onto `stepResult.updatedAgentState.memories` in place, at the two agent-loop append sites. No repo upsert inside the hook: the same iteration's `persistAndSnapshot` is the single write point, so the same pulse's `agent_state_snapshot` carries the memory. This is the first projection-shaped step that mutates agent state instead of emitting an audience view — the deviation from the `projections/` precedent is deliberate and recorded here.

**2. Memory application consumes only returned committed events (D-38).** `appendAndProject` changes return type `number` → `CommittedEvent[]` (5 call sites take `.length`). A failed append returns `[]`, so a failed commit can never fabricate a memory.

**3. The mention parser is module-local; names arrive via `ResolveContext.agentNames` (D-39).** Exact, case-insensitive, boundary-aware display-name and `@handle` matching over `visibleContent`, against an **optional** `agentNames: Record<string, string>` (agentId → display name) that the scheduler builds once from `config.agents[].persona.name` and passes in the resolve ctx. An unwired map degrades to zero mentions parsed — same as pre-#138 behavior; the risk is accepted and owned by the eval bench.

**4. The co-presence bump is a data-only bystander rule (D-40).** A `message_sent` role=`bystander` entry in `RELATIONAL_UPDATE_RULES` (magnitude 0.3) rides the existing `targetIds` machinery (`{actor}` when no `personTargets`/mentions). No `channelMemberIds` payload stamping and no engine signature change: the visibility filter already bounds the observer set (private channels members-only; all active agents are seeded members of the sole public channel and `leave_channel` on it is blocked). A directed `message_sent` role=`target` entry (magnitude 0.5) accompanies it, ordered below `reply_sent`'s 1.0.

**5. Reaction registration rides intent-carried `personTargets` (D-41).** `buildReactionEvent` stamps `personTargets` (and the mention parser where content exists) exactly as the message/reply builders do. No `targetEventId`→actor resolution — the resolver has no event-repository access. Residual risk accepted: if the model omits `personTargets` on react, the reaction still does not register; observed via eval bench, not unit-asserted.

**6. `isTarget` consults `invitedAgentIds` and folds the singular key (D-42).** One comparison line folds `invitedAgentId` (`agent_invited`) into the consulted set alongside the plural `invitedAgentIds` (`channel_created`), removing a live plural/singular asymmetry. The fold touches `isTarget` only; the `agent_invited` exclusion-cascade bystander rule still resolves `affectedTargets` via the plural-only `targetIds` (pre-existing behavior, deliberately unchanged).

**7. AC-138-3 is invitee-side only (D-43).** "Accretes a relational entry for that invitee" reads as the invitee's entry about the creator (covered by D-42 via the pre-existing `channel_created` target rule). The creator's entry about the invitee would need a new actor-role rule for `channel_created`/`agent_invited` (none exists) — deferred to a follow-up if wanted.

**8. `mock-llm-provider.ts` stays `memoryWrites: []` (D-44).** Deterministic suites inject intents carrying `memoryWrites` through the resolver/scheduler seam; eval bench runs exercise memory formation end-to-end via `PersonaAwareMockProvider`'s seeded emission. Teaching the server mock to emit memories would change every mock-based suite's fixtures for no test need.

**9. The `write_memory` sweep removes only the always-available action (D-45).** Deleted: the entry in `computeAvailableActions` (count 11→10). Kept: `ALL_INTENT_TYPES` (the offline branch's contract is "list every type, blocked"), the shared schema/type union, `validate-intent`, the resolver plumbing (`memoryProposalEvents` guard, `case "write_memory"`), and the historical plan doc `dev3-domain-engine-integration.md:511` (documents the type union, which stays). Blocked ≠ permitted; widening the sweep would broaden the diff without serving AC-136-4.

## Rationale

- **Scheduler-private over projection class (D-37):** the conversion is ~20 lines with exactly one caller pair, both inside `executePulse`'s agent loop; in-place mutation of `updatedAgentState` has exact precedent (the `lastActionAt` stamp in the same file). A `projections/agent-memory-projection.ts` would need a `PulseSchedulerConfig` field plus wiring in `simulation-runtime`/`simulation-manager` for no second caller. A dedicated `agentStateRepo.upsert` inside the hook would double-write per turn and create a second persist point to keep consistent with `persistAndSnapshot`.
- **Returned committed events over a count delta (D-38):** a `eventsCommitted` before/after heuristic silently relies on repo-append atomicity; returning the committed list makes "only committed events become memories" explicit and testable.
- **Module-local parser over a module (D-39):** single caller pair (message + reply builders); the scheduler is the only place holding both agent ids and personas; the optional field keeps the 6+ existing `resolve` call sites compiling.
- **Visibility filter over member stamping (D-40):** resolver-stamped `channelMemberIds` plus an engine gate is an extra payload field and a special-case branch for a distinction the filter already approximates; rule magnitudes bound the approximation error (non-member viewers of public-channel messages receive a 0.3 bump).
- **Intent payload over event lookup (D-41):** the issue prescribes exactly this; the intent schema already allows `personTargets` on react and `computeAvailableActions` grants react reachable people. A scheduler-supplied lookup or new resolver dependency is a bigger seam than the issue asks for.
- **Singular fold (D-42):** plural alone satisfies AC-138-3 via `channel_created`; the fold is one line that removes an asymmetry rather than inventing behavior.
- **Invitee-side reading (D-43):** the issue's wording reads naturally invitee-side; creator-side would invent rule semantics the issue never specifies (dead code today — no actor rule consumes the extension).
- **Sweep boundary (D-45):** the issue says "leave the schema / resolver plumbing"; the offline branch lists every type as blocked by design, so changing it broadens the diff without changing what any agent may do.

## Rejected Alternatives

- **`projections/agent-memory-projection.ts` mirroring `spectator-projection.ts`** — single caller, no seam, 3 extra wiring points (D-37).
- **Repo upsert inside the memory hook** — double write per turn; second persist point (D-37).
- **Count-delta `eventsCommitted` heuristic** — silent reliance on append atomicity (D-38).
- **Required `agentNames` on `ResolveContext`** — breaks every existing resolver call site/test for no behavioral gain (D-39).
- **Standalone `mention-parser.ts`** — no second caller (D-39).
- **Resolver stamps `channelMemberIds`; engine gates bystander targets on it** — extra payload field + special-case branch for an already-approximated distinction (D-40).
- **`targetEventId`→original-actor resolution for reactions** — the resolver has no event-repo access; a scheduler-supplied lookup or new dependency is a bigger seam than the issue asks; re-flag as follow-up if eval shows reactions not registering (D-41).
- **Plural-only `isTarget` consult** — viable for AC-138-3; the fold is cheaper than the asymmetry it removes (D-42).
- **Creator-side relational entry via actor-role `affectedTargets` extension** — dead code today (no actor rule consumes it) (D-43).
- **Teaching the server mock to emit memories** — broadens mocked-run behavior and changes every mock fixture (D-44).
- **Removing `write_memory` from `ALL_INTENT_TYPES` too** — the offline branch's contract is "list every type, blocked"; blocked ≠ permitted (D-45).

## Consequences

- **The live memory path is now intent-side**: prompt criteria (one line in `renderOutputContract`'s Ensure list) → model emits `memoryWrites` on a normal action intent → resolver commits `memory_written` post-LLM-path → `applyMemoryProjection` → `agentState.memories` → `selectRelevantMemories` → the next prompt's "What you remember". The engine path (`EngineEventBuilder` from `stepResult.memoryProposals`) remains as redundant-but-harmless plumbing — cleanup is a separate issue, not folded in silently.
- **`agentState.memories` grows unbounded over long runs** (over-emission bounded only by prompt criteria); a cap was deliberately deferred — no speculative limits — and the rate is observed via eval bench artifacts.
- **Dormant paths activate**: populating `personTargets`/`mentionedAgentIds` switches on mention-based attention and involved-people derivation (`score-attention.ts`, `build-perception-packet.ts`, `interpret-programmatic-signals.ts`). Expected per plan; tuning explicitly out of scope. In the canned 4-persona e2e room this makes every agent LLM-attentive every pulse, which forced removal of the parity fixture's `staleFrames > 0` counter — the staleness axis ("receiver drops thinking rows whose intent the pulse lacks") is currently unowned until the follow-up assertion lands in `html-snapshot-gateway.test.ts`.
- **`templateVersion` hash moves with the prompt edit** (`1lzz3tz` → `1e65v2f` at implementation time); nothing pins the computed value.
- **`agentNames` is optional, so typecheck cannot catch a dropped wire** — a scheduler regression degrades mentions silently; a test asserting the scheduler→resolver wiring is owed (mutation-proven gap).
- **Payload absence ≡ empty** for the engine's `?? []` reads; identifiers are stamped only when non-empty, mirroring `buildReplyEvent`'s `replyToActorId` precedent.
- **The ownership map needs no row moves**: memory persistence stays Dev2 (`simulation/`), the mention parser stays Dev2 (`intent-resolver.ts`), `RELATIONAL_UPDATE_RULES` stays Dev3 (`shared/constants`). The master-contract's Key Type Flow does not yet show the intent-side memory path — the doc touch is flagged with proposed wording in this run's doc-report, deliberately not edited there.

## Cross-links

- Issues #136/#138 (parent plan #119; decisions #126/#127); run decision log D-1..D-9 → D-37..D-45 per the numbering note.
- [ADR-0001](./0001-event-visibility-operator-event.md) — `appendAndProject`'s per-committed-event `event_visibility` emission semantics are unchanged by D-38 (return type only).
- [ADR-0012](./0012-goal-registry-persistence.md) — `PulseScheduler` call sites of `appendAndProject`; numbering convention source.
- Contract: `docs/plans/master-contract.md` — Key Type Flow (intent-side memory path flagged for addition); Canonical Event Types unchanged (no new event types; payload fields ride the loose `EventPayload` record).
- Code: `packages/server/src/simulation/{pulse-scheduler,intent-resolver}.ts`, `packages/server/src/agent/action-intent-prompt-builder.ts`, `packages/engine/src/action/compute-available-actions.ts`, `packages/engine/src/emotion/update-relational-emotions.ts`, `packages/shared/src/constants/emotion-rules.ts`.
- Tests: `pulse-scheduler.test.ts` (memory persistence, both paths), `prompt-builder.test.ts` (emission criteria + memory render), `emotion-stack.test.ts` (rule ordering, invitee accretion, co-presence, reaction), `intent-resolver-relational.test.ts` (real-resolver → real-accretion regression).
