# ADR-0001: Per-Committed-Event Visibility Signal

**Status**: Accepted (LOCKED, 2026-08-25) — decision D-1, rationale inline in this ADR

## Context

US-004 requires the HTML receiver to keep the generator's per-event perspective
filter (`visibility.visibleToAgents`). No delivered signal can reproduce it:
`DeliveryMessage` is a reduced `{kind, agentId, content, replyToEventId?, salience}`
with no eventId, no pulseIndex, no visibility, and spectator events are pre-filtered
server-side. Without a new signal, a stream-fed receiver must either drop the POV
filter or widen `IDeliveryGateway` — the first was explicitly overridden by the user,
the second breaks the no-interface-change constraint (FR-005).

## Decision

Add a new additive `event_visibility` operator event, emitted by
`PulseScheduler.appendAndProject` once per **committed** event (all event types, not
only rendered ones) through the existing `emitOperatorEvent` channel, carrying
`{ eventId, eventType, actorId, channelId, visibleToAgents, content?, channelName? }`
with typed payload `EventVisibilityData` in the shared operator contract.

## Consequences

- Receivers can reproduce per-event perspective filtering and get the full per-pulse
  event-type distribution from the stream alone (the basis of SC-002 parity summaries).
- Stream volume grows by exactly one event per committed event — bounded per
  `docs/observability-stream.md`; additive and safely ignorable by existing consumers.
- Rejected alternatives: dropping the POV filter in the receiver (user override);
  widening `DeliveryMessage`/`IDeliveryGateway` (FR-005 violation); re-emitting the
  full committed-event payload (heavier than the render slice, duplicates content).