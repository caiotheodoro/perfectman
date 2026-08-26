# ADR-0006: `html-snapshot` Gateway Config Variant

**Status**: Accepted (LOCKED, 2026-08-25) — decision D-7, rationale inline in this ADR

## Context

The receiver needs an artifact output path; per the spec assumption, the config
schema changes only where a receiver needs configuration, additively. The runtime
already exposes a flush hook — `SimulationRuntime.stop` calls
`delivery.onSimulationStopped(simulationId)` — and the CLI stop path (SIGINT/
SIGTERM → `runtime.stop`) feeds it, which matches the spec's stop-mid-pulse edge
case.

## Decision

A new additive `DeliveryGatewayConfig` variant `{ id, type: "html-snapshot",
outputPath }`: `parseGateways` requires `outputPath` via `requiredString`, and a
`GATEWAY_FACTORIES` entry constructs `HtmlSnapshotGateway(meta, outputPath)` —
the factory map is the single switch site for gateway types. The artifact flushes
on `onSimulationStopped`, partial frames included.

## Consequences

- Adding an `html-snapshot` gateway to any config produces the artifact on stop,
  including after a mid-pulse stop.
- A missing `outputPath` rejects at parse time in the established error style;
  an unwritable path surfaces as a shutdown error (honest flush).
- Rejected alternatives: a CLI flag (config is the established surface for gateway
  configuration) and per-pulse incremental writes (the spec's flush semantics).