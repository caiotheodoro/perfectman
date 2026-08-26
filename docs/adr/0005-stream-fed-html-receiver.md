# ADR-0005: Stream-Fed HTML Receiver in Production

**Status**: Accepted (LOCKED, 2026-08-25) — decision D-6 in `.claude/_output/pipeline/decision-log.md`

## Context

US-004 turns the HTML artifact into a receiver of the enriched stream so a plain
CLI run (any provider) can produce it. The generator and the replay contract types
lived in `__e2e__/`; a production receiver importing them would create a
test→prod dependency, and the CLI can only load production code. FR-007 sanctions
relocation/wrapping, while the generator's visuals and data model are out of scope.

## Decision

The receiver is a production `HtmlSnapshotGateway implements IDeliveryGateway` in
`packages/server/src/delivery/html-snapshot-gateway.ts` — a thin adapter that
collects stream events (`agent_state_snapshot`, `action_intent`, `event_visibility`)
and channel calls, builds a `SimulationReplay`, and writes the artifact on
`onSimulationStopped`. The generator relocates verbatim to
`packages/server/src/html/snapshot-html-generator.ts` (content untouched), and the
replay contract types move to `packages/server/src/html/replay-types.ts`, imported
by recorder, receiver, and generator.

## Consequences

- The artifact is CLI-producible from delivered events + construction metadata
  (US-004 ACC-1/ACC-2); the e2e recorder stays the parity reference.
- The replay types become a real shared boundary: two producers (recorder,
  receiver), one consumer (generator).
- Production never imports `__e2e__`; the generator's content is unchanged, so
  recorder-path rendering is byte-identical before and after the move.