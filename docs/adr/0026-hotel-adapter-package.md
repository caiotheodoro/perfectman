# ADR-0026: `packages/hotel` as the Hotel Adapter Package

**Status**: Proposed (2026-11-06) — implements hotel-integration decisions D13 (Node sidecar plus server-owned actors plus an internal Director WS) and D26 (generic physical-world code goes upstream; `packages/hotel` is the sidecar with its own image). Decisions **D-97..D-100**. Spec: [`../plans/hotel-package.md`](../plans/hotel-package.md).

## Context

The workspace has five packages: `shared` <- `engine` <- `server` <- `eval`, plus `web` ([`pnpm-workspace.yaml`](../../pnpm-workspace.yaml)). The Discord gateway is the one existing transport adapter, and it lives inside `server` ([`packages/server/src/discord/`](../../packages/server/src/discord/); [`discord-gateway.ts:59-84`](../../packages/server/src/discord/discord-gateway.ts) queues sends and returns). The hotel adapter is different in kind: a long-lived process with its own sockets, clock, lifecycle and deployment target, whose only consumers are the hotel and its probes. The root `Dockerfile` builds `shared`, `engine` and `server` only and starts the HTTP runner ([`Dockerfile:33-35,65`](../../Dockerfile)).

## Decision

1. **A new workspace package `@perfectman/hotel` (D-97).** It depends on `shared`, `engine` and `server`; none of those depends on it. `eval` does not depend on it either: body probes live in `eval` and read a `BodyFrameLog` type defined in `shared`; the hotel package imports `eval`'s probes only as a dev dependency in its own tests.
2. **Placement rule (D-98).** Code that is true for any host with a grid goes upstream; code that encodes Tilehouse budgets or wire formats stays.

| Upstream (`shared` / `engine` / `server`) | `packages/hotel` |
| --- | --- |
| World and body types, `BodyFrameLog` | Director WS client, internal HTTP client |
| World reducer, `deriveZones`, perception `body` block, `validateBodyIntent` | `SpaceMirror` driver (wire frame to reducer action) |
| `body` in the intent packet, new event types | Embodiment planner `plan()`, `BodyExecutor`, pair choreography |
| `runPulse` options, split mode, `onConsult`, arbiter, tracker warn mode, bounded event store | `RunManager`, `WallClockPulseLoop`, `HotelGateway`, guest ingestion, LLM governor, circuit breaker |
| Body probes (`eval`) | Fake grid hotel (`src/testing/`), Dockerfile, process entrypoint |

3. **Its own image (D-99).** `packages/hotel/Dockerfile` builds `shared`, `engine`, `server`, `hotel` (filtered, topologically ordered like the root file) and runs `node packages/hotel/dist/main.js`. The root `Dockerfile` and `fly.toml` are not touched. Compose wiring lives with the hotel's deploy files.
4. **No public inbound surface (D-100).** Live run traffic is outbound only: the sidecar dials the hotel's Director listener (WebSocket plus internal HTTP, secret-authenticated). Authoring is the one inbound path (lead resolution R3): the browser calls the hotel's admin API, which calls an internal authoring HTTP listener on the sidecar over the compose network (unpublished port, same bearer secret, constant-time compare). It exposes validate, compile, draft, autolook and presets, wrapping `compileRunInputs` and `draftStory` in-process; the hotel runs these as jobs the browser polls, because Caddy cuts responses at 30 s. Besides that, the sidecar has only a loopback health endpoint for the container healthcheck. Wire details: `director-protocol.md` section 7 in the hotel repo.

## Rationale

- A separate package gives a separate image and keeps hotel concerns (sockets, a wall clock, a second entrypoint) out of `server`, which `eval` and the web runner consume.
- The rule in decision 2 is D26 stated operationally: anything a second host (another game, a Discord voice room) would reuse is upstream.
- Keeping live traffic outbound-only means no port is published and the Director link needs no inbound auth; the authoring listener is reachable only on the compose network and is authenticated like the internal HTTP surface. A long-lived multiplexed RPC over the Director socket was rejected: authoring calls take up to 90 s and would share head-of-line blocking and the 15 s liveness rules with run traffic.

## Rejected Alternatives

- **Put the adapter in `packages/server/src/hotel/`** (the Discord precedent) — `server` would gain a WebSocket client, the wall-clock loop and a second process entrypoint, and the hotel could not ship its own image.
- **Everything in `engine`/`shared`** — sockets and clocks in the pure layers.
- **Run the hotel in the existing web runner process** — one active run, SQLite, no wall clock ([ADR-0024](./0024-multi-run-wall-clock-loop-and-bounded-event-reads.md)).

## Consequences

- `vitest.workspace.ts` and the root `build` scripts gain the package; `pnpm -r build` order is `shared`, `engine`, `server`, `hotel`.
- New dependency review for the Director client: Node 22's global `WebSocket` (stable since 22.4.0, to be verified against the pinned `node:22-bookworm-slim` tag in Phase 1) is preferred; the `ws` package is the fallback if reconnect or ping control is insufficient.
- Docs-lint and the test hygiene gate (`audit-tests.mjs`) apply to the new package from its first commit.
- The compose file, `setup-server.sh` env and `deploy.sh` changes belong to the hotel repository and are specified by its docs.

## Cross-links

[ADR-0004](./0004-gateway-construction-metadata.md) (gateway construction metadata) · [ADR-0018](./0018-physical-space-model-and-embodiment.md) · [`../plans/discord-gateway.md`](../plans/discord-gateway.md) (closest precedent) · [`../plans/hotel-package.md`](../plans/hotel-package.md)
