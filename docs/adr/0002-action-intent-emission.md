# ADR-0002: `action_intent` Operator Event

**Status**: Accepted (LOCKED, 2026-08-25) — decision D-3, rationale inline in this ADR

## Context

US-002 requires the LLM thinking payload — `intentType`, `visibleContent`,
`privateMotiveSummary`, `emotionDrivers`, `motivationDrivers` — in the operator
stream, and the payload must reflect the actual intent, never a fabricated or stale
one (US-002 ACC-2). The spec clarification also keeps `pulse_metrics` lean: the
intent payload gets a dedicated event, not a `pulse_metrics` extension. The e2e
recorder's `agentThinking` is known to carry last-known intents from earlier pulses
(`PersonaAwareRuntime.lastIntents` is never cleared), so it is not a usable source.

## Decision

The scheduler emits `action_intent` immediately after `intentResolver.resolve`
succeeds, in the same block that forwards the resolved runtime's operator events.
The payload reads the five FR-002 fields verbatim from `runtimeOutput.intent` —
including truthful fallback `no_op` intents (which `action-intent-step.ts` builds
in-band when `fallbackApplied`). Provider-failure (`runtimeOutput === null`) and
resolver-failure (`resolved === null`) emit nothing: there is no actual intent.

## Consequences

- The stream's thinking is strictly per-pulse and truthful by construction; parity
  and receivers must derive thinking from these events, never from recorder
  `agentThinking` wholesale (stale rows).
- `action_intent` is absent for uncalled agents in a pulse — a receiver relies on
  absence, not on a sentinel.
- New additive type in the shared operator contract (`ActionIntentOperatorData`).