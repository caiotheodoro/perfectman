# ADR-0003: Shared Agent-State Serializer

**Status**: Accepted (LOCKED, 2026-08-25) — decision D-4, rationale inline in this ADR

## Context

US-001 ACC-3 / SC-002 demand byte parity between the stream's
`agent_state_snapshot` payloads and the e2e recorder's serialized `AgentState`.
The recorder's serializer lived in `__e2e__/simulation-recorder.ts`; production
code cannot import it. The in-memory repository stores and returns the same object
reference the scheduler persists, so both sides can serialize the identical object.

## Decision

`serializeAgentState` + `SerializedAgentState` live in production at
`packages/server/src/agent/agent-state-serializer.ts`; the `SimulationRecorder`
swaps its local copy for an import (behavior unchanged, public types re-exported).
Both producers — scheduler snapshot emission and recorder frames — share this one
implementation, making parity hold by construction.

## Consequences

- Stream/recorder parity cannot drift: any serializer change affects both sides
  equally, so a mismatch would surface in the parity e2e rather than silently.
- Enforces the test→prod boundary: `__e2e__` code is never imported by production.
- Future producers of serialized state must use this function, not inline their own.