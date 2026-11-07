# ADR-0019: The `body` Block in the Intent Packet

**Status**: Proposed (2026-11-06) — implements hotel-integration decision D14. Decisions **D-67..D-70**. Schema text: [`../embodiment.md`](../embodiment.md) section 6.

## Context

[ADR-0018](./0018-physical-space-model-and-embodiment.md) lets the model steer its body with one small optional block. The intent packet today is `ModelIntentPacketSchema` ([`intent-packet.schema.ts:16`](../../packages/shared/src/intent/intent-packet.schema.ts)): the single source of truth for the prompt's field contract (`modelIntentPacketFieldContract`) and for constrained decoding (`ModelIntentPacketJsonSchema`, derived with `zod-to-json-schema`). Three mechanical facts shape the change:

- `composeIntentPacket` copies packet fields into `ActionIntent` one by one ([`:198`](../../packages/shared/src/intent/intent-packet.schema.ts)); an unlisted field is silently dropped.
- `describePacketFieldType` ([`:102`](../../packages/shared/src/intent/intent-packet.schema.ts)) renders enums, arrays of objects (one level), numbers and booleans, and returns `"string"` for everything else. A nested object or a `discriminatedUnion` (JSON Schema `anyOf`) would be described to the model as a string.
- Handles are already the repo's way to keep the model away from raw ids: `eventHandles` (`e1`, `e2`) map to event ids per render ([`perception.types.ts:28`](../../packages/shared/src/perception/perception.types.ts)) and `IntentParser` resolves them.

## Decision

1. **One optional strict object (D-67).** `ModelIntentPacketSchema` gains `body: BodyIntentSchema.optional()`. `BodyIntentSchema` is `.strict()` with at most six optional parts: `move` (approach, go_to, follow, keep_distance, leave, stay), `posture`, `gesture`, `expression`, `face`, `order` (`move_then_speak` default, `speak_then_move`, `together`). A packet with no `body` is exactly today's packet.
2. **References are per-render handles (D-68).** Every target is `/^[pzfr]\d+$/` (people, places, furniture, rooms). The perception builder mints `bodyHandles` next to `eventHandles`; `IntentParser` resolves them to ids. An unknown or stale handle drops the `body` block (never the speech half of the intent) and the validator reports `unknown_ref` on the next pulse.
3. **The contract is derived, not hand-written (D-69).** `describePacketFieldType` gains an object branch and an `anyOf` branch so the prompt lists `body` fields with their enums and ranges, and `composeIntentPacket` copies `body` onto `ActionIntent.body?`. A drift test pins prompt/schema parity the way `intent-packet-field-contract.test.ts` does for `memoryWrites`.
4. **Validation lives outside the model boundary (D-70).** A pure `validateBodyIntent(space, agent, body)` returns `BlockedReason` codes (`unknown_ref`, `target_elsewhere`, `seat_taken`, `no_route`, `busy_moving`, `not_a_seat`, `room_unreachable`, `slow_down`, `too_far`, plus `stale_space`, `not_in_earshot`, `cooldown`). It never throws and never blocks the speech half. Codes are fed back next pulse as one natural-language "blocked" line in the `body` perception block. `no_op` with a `body` is a valid silent act.

## Rationale

- Handles keep coordinates and ids out of the prompt, so a hallucinated tile cannot exist and a stale reference is detectable.
- Parsing tolerantly (drop `body`, keep speech) matches the repo's controlled-fallback stance: a bad optional block must not turn a real line into a `no_op`. The existing doc on `describePacketFieldType` records that exactly this kind of mis-described field "silently degraded a real turn into a no_op".
- Deriving the contract from zod keeps constrained decoding, the prompt and the parser aligned by construction.

## Rejected Alternatives

- **A separate second LLM call for the body** — doubles latency and cost per action; body and speech are one decision.
- **Free-text movement ("go near the bar") parsed by the engine** — needs a language grammar in four languages; handles are exact.
- **Required `body` on every intent** — breaks every non-hotel suite and adds ~150 tokens of output pressure to turns that have no body.
- **Hand-written JSON Schema for `body`** — the drift class `ModelIntentPacketJsonSchema` was introduced to remove.

## Consequences

- `ActionIntent.body?` joins [`intent.types.ts`](../../packages/shared/src/intent/intent.types.ts); the intent resolver validates it and emits `body_action_committed` / `body_blocked`.
- Prompt size: the schema block must stay small. If the Phase 1 spike shows small models degrading, `move` is flattened to a single object (`kind`, `target?`, `band?`, `min?`) before any other cut. Spike result goes in `embodiment.md` section 11.
- The OpenAI-compatible provider runs json_schema non-strict today; `body` relies on that (optional properties are not allowed in strict mode). Verify per model in the Phase 1 spike.
- Speech deferral (`move_then_speak`) holds the already-generated intent outside the engine and re-submits it through `IntentResolver.resolve` on arrival, so the arbiter and rate gate still apply ([ADR-0021](./0021-room-speech-arbiter.md)).

## Cross-links

[ADR-0018](./0018-physical-space-model-and-embodiment.md) · [ADR-0002](./0002-action-intent-emission.md) · [`../embodiment.md`](../embodiment.md)
