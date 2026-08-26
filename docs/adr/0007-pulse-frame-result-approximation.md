# ADR-0007: `PulseFrame.result` Stream-Derived Approximation

**Status**: Accepted (LOCKED, 2026-08-25) — decision D-9, rationale inline in this ADR

## Context

The `SimulationReplay` contract's `PulseFrame` carries a `PulseResult`, but the
stream never delivers scheduler counters — and FR-003 forbids shaping the stream
for a receiver's needs. The generator never reads `frame.result` (renderStory and
the agent panel read `committedEvents`, `agentStates`, `agentThinking` only), and
the parity normalizer ignores it, so the field is inert for rendering.

## Decision

The receiver approximates `PulseFrame.result` from stream data:
`eventsCommitted` = count of `event_visibility` events in that pulse;
`agentsCalled` = number of distinct `action_intent` agents in that pulse.
Under the current 1:1 emissions (every committed event emits `event_visibility`,
every resolved intent emits `action_intent`) the approximation equals the real
counters; failures would legitimately diverge and are documented in the parity test.

## Consequences

- The stream stays the single observability truth — no counter injection.
- The replay shape stays complete for any future consumer that does read
  `frame.result`; the approximation is honest and documented at the emission
  site and in the parity e2e.
- A future change to emission cardinality (e.g. filtering visibility events) must
  revisit the approximation and the parity assertion together.