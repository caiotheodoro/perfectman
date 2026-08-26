# ADR-0004: Runtime Metadata at Gateway Construction

**Status**: Accepted (LOCKED, 2026-08-25) — decision D-5, rationale inline in this ADR

## Context

The stream carries ids only, but receivers need human-readable agent names,
archetypes, and channel names (US-003 ACC-1). FR-004 fixes the injection point:
`buildConfiguredSimulation`, which is the single gateway construction site
(`createGateways`). The factory signature was `GatewayFactory = (cfg, debug) =>
IDeliveryGateway`, and all callers flow through `createGateways` plus one
`stdout-debug` fallback.

## Decision

`GatewayFactory` gains a third parameter — `GatewayRuntimeMetadata`
(`simulationId`, `simulationName`, `agents: Record<id,{name,archetype}>`,
`channels: Record<id,{name}>`) — built in `buildConfiguredSimulation` from the
config and passed via `createGateways(config, meta)`. Only the mock, stdout, and
html-snapshot factories consume it as an optional constructor parameter (FR-005);
the discord factory ignores it; the `stdout-debug` fallback passes nothing.

## Consequences

- Metadata reaches gateways at construction time (FR-004) without reshaping any
  event payload; the stream stays id-only for dynamic data.
- Behavior of existing gateways is unchanged — optional params only.
- New gateway types receive the metadata automatically via the factory map.